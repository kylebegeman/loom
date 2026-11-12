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
  ACCOUNT_COMPUTER_ADMIN_SCOPES,
  type AccountComputerStatus,
  type AccountComputerRemoval,
} from "@t3tools/contracts/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
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
import { identityOwnershipSubject } from "../../auth/identityPolicy.ts";
import { LibraryPublishingCredential } from "../../auth/LibraryPublishingCredential.ts";
import { ServerConfig } from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { DirectoryReporter } from "../directory/DirectoryReporter.ts";
import { DirectoryService } from "../directory/DirectoryService.ts";
import { LibraryConnectionService } from "../project-library/LibraryConnection.ts";
import { LibraryManagement } from "../project-library/LibraryManagement.ts";
import { LibraryPublisher } from "../project-library/LibraryPublisher.ts";
import { libraryComputerDirectory, writeLibraryCredential } from "../project-library/enrollment.ts";
import {
  ReachStore,
  freshComputer,
  type ReachStoredComputer,
} from "../reach/library/ReachStore.ts";
import { ReachProvisioner } from "../reach/library/ReachProvisioner.ts";

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

const computerStatus = (
  environmentId: EnvironmentId,
  computer: ReachStoredComputer,
  label?: string,
): AccountComputerStatus => ({
  environmentId,
  membershipRevision: computer.account?.approvedAt ?? null,
  label: label ?? computer.account?.label ?? computer.hostname ?? environmentId,
  state: computer.account?.state ?? "active",
  publishingEnded: computer.account?.publishingEnded ?? false,
  routeRemoved: computer.account?.routeRemoved ?? false,
  directoryRemoved: computer.account?.directoryRemoved ?? false,
  detail: computer.account?.detail ?? null,
});
const closedRequest = () =>
  new LibraryError({
    reason: "request-conflict",
    detail: "This computer enrollment has ended. Start adding it again with a new request.",
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
      expectedEpoch?: number,
    ) => Effect.Effect<AccountComputerEnrollment, LibraryError>;
    readonly install: (input: AccountComputerEnrollment) => Effect.Effect<void, LibraryError>;
    readonly epoch: (environmentId: EnvironmentId) => Effect.Effect<number, LibraryError>;
    readonly computers: (
      session: AuthenticatedSession,
    ) => Effect.Effect<ReadonlyArray<AccountComputerStatus>, LibraryError>;
    readonly remove: (
      input: AccountComputerRemoval,
      session: AuthenticatedSession,
    ) => Effect.Effect<AccountComputerStatus, LibraryError>;
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
  const store = yield* ReachStore;
  const provisioner = yield* ReachProvisioner;
  const environment = yield* HostProcess.Environment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const config = yield* ServerConfig;
  const home = yield* HostProcess.HomeDirectory;
  const configuredUrl = yield* Config.String("LOOM_LIBRARY_URL").pipe(Config.option);
  const configuredFile = yield* Config.String("LOOM_LIBRARY_CREDENTIAL_FILE").pipe(Config.option);
  const redirect = yield* Config.String("LOOM_IDENTITY_REDIRECT_URI").pipe(Config.option);
  const installLock = yield* Semaphore.make(1);
  const membershipLock = yield* Semaphore.make(1);
  const epoch = Effect.fn("AccountEnrollment.epoch")(function* (environmentId: EnvironmentId) {
    const state = yield* store.read.pipe(Effect.mapError(unavailable));
    return state.computers[environmentId]?.account?.epoch ?? 0;
  });
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
    expectedEpoch?: number,
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
    const state = yield* store.read.pipe(Effect.mapError(unavailable));
    const previous = state.computers[input.environmentId];
    const ownerSubject = identityOwnershipSubject(session.subject, environment);
    const publicKey = decodeEd25519PublicKey(input.request.publicKey);
    if (publicKey === null) return yield* refused();
    const requestId = `${input.requestId}:${keyFingerprint(publicKey)}`;
    if (expectedEpoch !== undefined && expectedEpoch !== (previous?.account?.epoch ?? 0))
      return yield* closedRequest();
    if (previous?.account !== undefined && previous.account.ownerSubject !== ownerSubject)
      return yield* refused();
    if (previous?.account?.state === "removing")
      return yield* new LibraryError({
        reason: "blocked",
        detail: "This computer is being removed. Finish its cleanup before adding it again.",
      });
    if (previous?.account?.state === "removed" && previous.account.requestId === requestId)
      return yield* closedRequest();
    yield* credentials
      .checkEnrollment({
        sourceEnvironmentId: input.environmentId,
        libraryUrl: input.libraryUrl,
        requestId,
      })
      .pipe(
        Effect.mapError((error) => (error.reason === "invalid" ? closedRequest() : unavailable())),
      );
    yield* directory.report({ environmentId: input.environmentId, request: input.request }).pipe(
      Effect.catchIf(
        (error) => error.reason === "stale-sequence",
        () => Effect.void,
      ),
      Effect.mapError(refused),
    );
    const pin = yield* directory.pinned(input.environmentId).pipe(Effect.mapError(unavailable));
    if (pin === null) return yield* refused();
    const now = yield* Clock.currentTimeMillis;
    const approvedAt =
      previous?.account?.state === "active"
        ? previous.account.approvedAt
        : Math.max(now, (previous?.account?.approvedAt ?? 0) + 1);
    const delegation = yield* management.issue(
      { environmentId: input.environmentId, keyFingerprint: pin.keyFingerprint },
      session,
    );
    const credential = yield* credentials
      .enroll({ sourceEnvironmentId: input.environmentId, libraryUrl: input.libraryUrl, requestId })
      .pipe(
        Effect.mapError((error) =>
          error.reason === "invalid"
            ? new LibraryError({
                reason: "request-conflict",
                detail:
                  "This setup request has expired or ended. Add this computer again to start a new request.",
              })
            : unavailable(),
        ),
      );
    yield* store
      .update((current) => ({
        ...current,
        computers: {
          ...current.computers,
          [input.environmentId]: {
            ...(current.computers[input.environmentId] ??
              freshComputer(DateTime.formatIso(DateTime.makeUnsafe(now)))),
            keyFingerprint: pin.keyFingerprint,
            account: {
              label: pin.label ?? input.environmentId,
              authorityId: delegation.authorityId,
              authorityEpoch: delegation.authorityEpoch,
              ownerSubject,
              requestId,
              approvedAt,
              epoch: previous?.account?.epoch ?? 0,
              removedAt: previous?.account?.removedAt ?? null,
              removalRequestId: previous?.account?.removalRequestId ?? null,
              state: "active",
              publishingEnded: false,
              routeRemoved: false,
              directoryRemoved: false,
              detail: null,
            },
          },
        },
      }))
      .pipe(Effect.mapError(unavailable));
    return {
      requestId,
      credential: {
        ...credential,
        account: {
          authorityId: delegation.authorityId,
          authorityEpoch: delegation.authorityEpoch,
        },
      },
      management: delegation,
    };
  }, membershipLock.withPermit);

  const computers = Effect.fn("AccountEnrollment.computers")(function* (
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session, "read");
    const ownId = yield* identity.getEnvironmentId;
    const ownerSubject = identityOwnershipSubject(session.subject, environment);
    const state = yield* store.read.pipe(Effect.mapError(unavailable));
    const listing = yield* directory.list.pipe(Effect.mapError(unavailable));
    const labels = new Map(listing.environments.map((entry) => [entry.environmentId, entry.label]));
    const ids = new Set([
      ...labels.keys(),
      ...Object.keys(state.computers).map((id) => id as EnvironmentId),
    ]);
    return Array.from(ids)
      .flatMap((environmentId) => {
        if (environmentId === ownId) return [];
        const record = state.computers[environmentId];
        if (record?.account !== undefined && record.account.ownerSubject !== ownerSubject)
          return [];
        if (record?.account === undefined && !labels.has(environmentId)) return [];
        return [
          computerStatus(environmentId, record ?? freshComputer(""), labels.get(environmentId)),
        ];
      })
      .sort(
        (left, right) =>
          left.label.localeCompare(right.label) ||
          left.environmentId.localeCompare(right.environmentId),
      );
  });
  const updateMembership = Effect.fn("AccountEnrollment.updateMembership")(function* (
    environmentId: EnvironmentId,
    change: (
      account: NonNullable<ReachStoredComputer["account"]>,
    ) => NonNullable<ReachStoredComputer["account"]>,
  ) {
    const state = yield* store
      .update((current) => {
        const computer = current.computers[environmentId];
        return computer?.account === undefined
          ? current
          : {
              ...current,
              computers: {
                ...current.computers,
                [environmentId]: { ...computer, account: change(computer.account) },
              },
            };
      })
      .pipe(Effect.mapError(unavailable));
    const result = state.computers[environmentId];
    if (result === undefined || result.account === undefined) return yield* unavailable();
    return result;
  });
  const remove = Effect.fn("AccountEnrollment.remove")(function* (
    input: AccountComputerRemoval,
    session: AuthenticatedSession,
  ) {
    yield* management.authorizeEnrollment(session);
    if (!ACCOUNT_COMPUTER_ADMIN_SCOPES.every((scope) => session.scopes.includes(scope)))
      return yield* refused();
    if (input.environmentId === (yield* identity.getEnvironmentId)) return yield* refused();
    const ownerSubject = identityOwnershipSubject(session.subject, environment);
    const state = yield* store.read.pipe(Effect.mapError(unavailable));
    const computer = state.computers[input.environmentId];
    const pin = yield* directory.pinned(input.environmentId).pipe(Effect.mapError(unavailable));
    if (computer?.account === undefined && pin === null)
      return yield* new LibraryError({ reason: "not-found" });
    if (computer?.account !== undefined && computer.account.ownerSubject !== ownerSubject)
      return yield* refused();
    if (
      computer?.account?.state === "active" &&
      computer.account.removalRequestId === input.requestId
    )
      return yield* closedRequest();
    if (computer?.account?.state === "removed")
      return computerStatus(input.environmentId, computer);
    if (computer?.account?.state !== "removing") {
      if ((computer?.account?.approvedAt ?? null) !== input.membershipRevision)
        return yield* closedRequest();
      const now = yield* Clock.currentTimeMillis;
      const current = computer ?? freshComputer(DateTime.formatIso(DateTime.makeUnsafe(now)));
      const next: ReachStoredComputer = {
        ...current,
        account: {
          ...current.account,
          label: current.account?.label ?? pin?.label ?? input.environmentId,
          ownerSubject,
          requestId: current.account?.requestId ?? `legacy:${input.environmentId}`,
          approvedAt: current.account?.approvedAt ?? 0,
          epoch: (current.account?.epoch ?? 0) + 1,
          removedAt: now,
          removalRequestId: input.requestId,
          state: "removing",
          publishingEnded: false,
          routeRemoved: false,
          directoryRemoved: false,
          detail: null,
        },
      };
      yield* store
        .update((current) => ({
          ...current,
          computers: {
            ...current.computers,
            [input.environmentId]: {
              ...(current.computers[input.environmentId] ??
                freshComputer(DateTime.formatIso(DateTime.makeUnsafe(now)))),
              account: next.account!,
            },
          },
        }))
        .pipe(Effect.mapError(unavailable));
    }
    const result = yield* Effect.gen(function* () {
      yield* credentials.revokeForComputer(input.environmentId).pipe(Effect.mapError(unavailable));
      yield* updateMembership(input.environmentId, (account) => ({
        ...account,
        publishingEnded: true,
        detail: null,
      }));
      const retired = yield* provisioner
        .retire({ environmentId: input.environmentId, endIdentity: true })
        .pipe(
          Effect.mapError((error) => new LibraryError({ reason: "io", detail: error.message })),
        );
      if (
        retired.state !== "removed" ||
        retired.identity !== null ||
        retired.leftoverDnsRecordId !== null ||
        (retired.leftoverZones?.length ?? 0) > 0
      )
        return yield* new LibraryError({
          reason: "io",
          detail:
            "Account access has ended. Some remote resources still need cleanup; retry when the Library’s services are available.",
        });
      yield* updateMembership(input.environmentId, (account) => ({
        ...account,
        routeRemoved: true,
      }));
      yield* directory.forget({ kind: "environment", environmentId: input.environmentId }).pipe(
        Effect.catchIf(
          (error) => error.reason === "not-found",
          () => Effect.void,
        ),
        Effect.mapError(unavailable),
      );
      return yield* updateMembership(input.environmentId, (account) => ({
        ...account,
        state: "removed",
        directoryRemoved: true,
        detail: null,
      }));
    }).pipe(Effect.result);
    if (result._tag === "Success") return computerStatus(input.environmentId, result.success);
    const failed = yield* updateMembership(input.environmentId, (account) => ({
      ...account,
      detail: result.failure.message,
    }));
    return computerStatus(input.environmentId, failed);
  }, membershipLock.withPermit);
  const install = Effect.fn("AccountEnrollment.install")(
    function* (input: AccountComputerEnrollment) {
      const credential = input.credential;
      const source = yield* identity.getEnvironmentId;
      if (
        credential.account !== undefined &&
        (credential.account.authorityId !== input.management.authorityId ||
          credential.account.authorityEpoch !== input.management.authorityEpoch)
      )
        return yield* refused();

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
  return AccountEnrollment.of({ prepare, approve, install, epoch, computers, remove });
});
export const layer = Layer.effect(AccountEnrollment, make);
