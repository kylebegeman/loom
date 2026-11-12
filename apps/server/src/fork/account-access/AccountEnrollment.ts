import { ReachService } from "../reach/ReachService.ts";
import { decodeEd25519PublicKey, keyFingerprint } from "@t3tools/shared/fork/directory";
import {
  ACCOUNT_ENROLLMENT_ACTIVATE,
  ACCOUNT_GATEWAY_FEATURE,
  AccountComputerCredential,
  type AccountComputerEnrollment,
  type AccountComputerEnrollmentProof,
  type AccountComputerEnrollmentRequest,
  LibraryError,
  LibraryInfo,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { LibraryPublishingCredential } from "../../auth/LibraryPublishingCredential.ts";
import { ServerConfig } from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { DirectoryReporter } from "../directory/DirectoryReporter.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { libraryComputerDirectory, writeLibraryCredential } from "../project-library/enrollment.ts";

const decodeInfo = Schema.decodeUnknownEffect(LibraryInfo);
const decodeCredential = Schema.decodeEffect(Schema.fromJsonString(AccountComputerCredential));
const encodeCredential = Schema.encodeEffect(Schema.fromJsonString(AccountComputerCredential));
const isLibraryError = Schema.is(LibraryError);
const refused = () =>
  new LibraryError({
    reason: "blocked",
    detail:
      "This enrollment does not match this computer and Library. Start adding the computer again.",
  });
const unavailable = () =>
  new LibraryError({
    reason: "io",
    detail:
      "Computer enrollment could not finish. Your saved work is unchanged. Retry to continue.",
  });
const libraryUrl = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        throw new Error("Invalid Library URL");
      return url;
    },
    catch: refused,
  });

export class AccountEnrollment extends Context.Service<
  AccountEnrollment,
  {
    readonly prepare: (
      input: AccountComputerEnrollmentRequest,
    ) => Effect.Effect<AccountComputerEnrollmentProof, LibraryError>;
    readonly approve: (
      input: AccountComputerEnrollmentProof,
      session: AuthenticatedSession,
    ) => Effect.Effect<AccountComputerEnrollment, LibraryError>;
    readonly install: (input: AccountComputerEnrollment) => Effect.Effect<void, LibraryError>;
  }
>()("t3/fork/account-access/AccountEnrollment") {}

const make = Effect.gen(function* () {
  const identity = yield* ServerEnvironmentIdentity;
  const reporter = yield* DirectoryReporter;
  const directory = yield* DirectoryService;
  const credentials = yield* LibraryPublishingCredential;
  const management = yield* LibraryManagement;
  const connection = yield* LibraryConnectionService;
  const publisher = yield* LibraryPublisher;
  const reach = yield* ReachService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const config = yield* ServerConfig;
  const home = yield* HostProcess.HomeDirectory;
  const configuredUrl = yield* Config.String("LOOM_LIBRARY_URL").pipe(Config.option);
  const configuredFile = yield* Config.String("LOOM_LIBRARY_CREDENTIAL_FILE").pipe(Config.option);
  const redirect = yield* Config.String("LOOM_IDENTITY_REDIRECT_URI").pipe(Config.option);
  const installLock = yield* Semaphore.make(1);
  const prepare = Effect.fn("AccountEnrollment.prepare")(function* (
    input: AccountComputerEnrollmentRequest,
  ) {
    yield* libraryUrl(input.libraryUrl);
    const current = yield* connection.current;
    if (
      current.kind === "authority" ||
      input.libraryEnvironmentId === (yield* identity.getEnvironmentId)
    )
      return yield* refused();
    if (
      current.kind === "remote" &&
      current.credential !== null &&
      current.credential.libraryEnvironmentId !== input.libraryEnvironmentId
    )
      return yield* refused();
    return {
      ...input,
      ...(yield* reporter.prepare(input.libraryUrl).pipe(Effect.mapError(refused))),
    };
  });
  const approve = Effect.fn("AccountEnrollment.approve")(function* (
    input: AccountComputerEnrollmentProof,
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session);
    const url = yield* libraryUrl(input.libraryUrl);
    const environmentId = yield* identity.getEnvironmentId;
    if (
      input.libraryEnvironmentId !== environmentId ||
      input.environmentId === environmentId ||
      Option.isNone(redirect) ||
      url.origin !== (yield* libraryUrl(redirect.value)).origin
    )
      return yield* refused();
    yield* directory.report({ environmentId: input.environmentId, request: input.request }).pipe(
      Effect.catchIf(
        (error) => error.reason === "stale-sequence",
        () => Effect.void,
      ),
      Effect.mapError(refused),
    );
    const pin = yield* directory.pinned(input.environmentId).pipe(Effect.mapError(unavailable));
    if (pin === null) return yield* refused();
    const delegation = yield* management.issue(
      { environmentId: input.environmentId, keyFingerprint: pin.keyFingerprint },
      session,
    );
    const requestId = `${input.requestId}:${pin.keyFingerprint}`;
    const credential = yield* credentials
      .enroll({ sourceEnvironmentId: input.environmentId, libraryUrl: input.libraryUrl, requestId })
      .pipe(Effect.mapError(unavailable));
    return { requestId, credential, management: delegation };
  });
  const install = Effect.fn("AccountEnrollment.install")(
    function* (input: AccountComputerEnrollment) {
      const credential = input.credential;
      const source = yield* identity.getEnvironmentId;
      const url = yield* libraryUrl(credential.libraryUrl);
      if (
        credential.sourceEnvironmentId !== source ||
        credential.libraryEnvironmentId === source ||
        credential.libraryEnvironmentId !== input.management.libraryEnvironmentId ||
        credential.sourceEnvironmentId !== input.management.sourceEnvironmentId ||
        Date.parse(credential.expiresAt) <= (yield* Clock.currentTimeMillis)
      )
        return yield* refused();
      if (
        Option.isSome(configuredUrl) &&
        (yield* libraryUrl(configuredUrl.value)).href !== url.href
      )
        return yield* refused();
      const current = yield* connection.current;
      if (current.kind === "authority") return yield* refused();
      const proof = yield* reporter.prepare(credential.libraryUrl).pipe(Effect.mapError(refused));
      const publicKey = decodeEd25519PublicKey(proof.request.publicKey);
      if (publicKey === null || keyFingerprint(publicKey) !== input.management.keyFingerprint)
        return yield* refused();
      const directory = libraryComputerDirectory(home, source);
      const external = path.join(directory, "publisher.json");
      const fallback = path.join(config.secretsDir, "library-publisher.json");
      const file = Option.isSome(configuredFile)
        ? configuredFile.value
        : (yield* fs.exists(external))
          ? external
          : (yield* fs.exists(fallback))
            ? fallback
            : external;
      if (yield* fs.exists(file)) {
        const previous = yield* fs
          .readFileString(file)
          .pipe(Effect.flatMap(decodeCredential), Effect.mapError(refused));
        if (
          previous.sourceEnvironmentId !== source ||
          previous.libraryEnvironmentId !== credential.libraryEnvironmentId ||
          (yield* libraryUrl(previous.libraryUrl)).href !== url.href ||
          (previous.issuedAt !== undefined &&
            credential.issuedAt !== undefined &&
            Date.parse(previous.issuedAt) > Date.parse(credential.issuedAt))
        )
          return yield* refused();
      }
      const response = yield* http
        .execute(
          HttpClientRequest.get(new URL("/api/loom/library/info", url).href).pipe(
            HttpClientRequest.bearerToken(credential.accessToken),
          ),
        )
        .pipe(Effect.timeout("20 seconds"), Effect.mapError(unavailable));
      if (response.status !== 200) return yield* refused();
      const info = yield* response.json.pipe(Effect.flatMap(decodeInfo), Effect.mapError(refused));
      if (
        !info.isAuthority ||
        info.environmentId !== credential.libraryEnvironmentId ||
        info.authorityId !== input.management.authorityId ||
        info.authorityEpoch !== input.management.authorityEpoch ||
        !info.features?.includes(ACCOUNT_GATEWAY_FEATURE)
      )
        return yield* refused();
      const contents = yield* encodeCredential(credential).pipe(Effect.mapError(refused));
      yield* writeLibraryCredential({ file, contents }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError(unavailable),
      );
      // Reload publishing before installing the delegation; the backend stays running.
      yield* publisher.info;
      yield* management.install(input.management);
      yield* reporter.requestReport;
      const activated = yield* connection
        .send(
          HttpClientRequest.post(ACCOUNT_ENROLLMENT_ACTIVATE).pipe(
            HttpClientRequest.bodyJsonUnsafe({ requestId: input.requestId }),
          ),
        )
        .pipe(Effect.mapError(unavailable));
      if (activated.status !== 204) return yield* unavailable();
      yield* reach.setEnabled(true).pipe(Effect.mapError(unavailable));
    },
    installLock.withPermit,
    Effect.mapError((error) => (isLibraryError(error) ? error : unavailable())),
  );
  return AccountEnrollment.of({ prepare, approve, install });
});
export const layer = Layer.effect(AccountEnrollment, make);
