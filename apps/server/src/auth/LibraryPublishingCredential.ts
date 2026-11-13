import { writeLibraryCredential } from "../fork/project-library/enrollment.ts"; // fork: project-library
import { AuthLibraryPublishScope, AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
// fork: project-library
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
// fork: project-library
import * as Semaphore from "effect/Semaphore";
import { AccountComputerCredential, LibraryPublisherRenewal } from "@t3tools/contracts/fork";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as SessionStore from "./SessionStore.ts";

export const LibraryPublishingCredentialFile = Schema.Struct({
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String,
  sessionId: AuthSessionId,
  accessToken: Schema.String,
  expiresAt: Schema.String,
  issuedAt: Schema.optional(Schema.String), // fork: project-library
  predecessors: Schema.optional(Schema.Array(AuthSessionId)),
});
const encodeCredential = Schema.encodeEffect(
  Schema.fromJsonString(LibraryPublishingCredentialFile),
);
const decodeEnrollment = Schema.decodeEffect(Schema.fromJsonString(AccountComputerCredential));
const decodeActivationReceipt = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      ...AccountComputerCredential.fields,
      predecessors: Schema.optional(Schema.Array(AuthSessionId)),
    }),
  ),
);

export class LibraryPublishingCredentialError extends Schema.TaggedError<LibraryPublishingCredentialError>()(
  "LibraryPublishingCredentialError",
  {
    reason: Schema.Literals(["invalid", "exists", "write", "issue"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "exists"
      ? "A publisher credential file already exists for this computer. Revoke it before replacing it."
      : "The Library publishing credential could not be saved.";
  }
}
type EnrollmentInput = {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly libraryUrl: string;
  readonly requestId: string;
};

export class LibraryPublishingCredential extends Context.Service<
  LibraryPublishingCredential,
  {
    // fork: project-library
    readonly renew: (
      token: string,
    ) => Effect.Effect<typeof LibraryPublisherRenewal.Type, LibraryPublishingCredentialError>;
    readonly activate: (input: {
      readonly requestId: string;
      readonly token: string;
    }) => Effect.Effect<void, LibraryPublishingCredentialError>;
    readonly checkEnrollment: (
      input: EnrollmentInput,
    ) => Effect.Effect<void, LibraryPublishingCredentialError>;
    readonly enroll: (
      input: EnrollmentInput,
    ) => Effect.Effect<AccountComputerCredential, LibraryPublishingCredentialError>;
    readonly revokeForComputer: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<void, LibraryPublishingCredentialError>;
    readonly issue: (input: {
      readonly sourceEnvironmentId: EnvironmentId;
      readonly libraryUrl: string;
      readonly ttl?: Duration.Duration;
    }) => Effect.Effect<
      {
        readonly credentialFile: string;
        readonly sessionId: AuthSessionId;
        readonly expiresAt: DateTime.DateTime;
      },
      LibraryPublishingCredentialError
    >;
  }
>()("t3/auth/LibraryPublishingCredential") {}
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Digest.Digest;
  const config = yield* ServerConfig.ServerConfig;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const sessions = yield* SessionStore.SessionStore;
  // fork: project-library
  const credentialLock = yield* Semaphore.make(1);
  const RenewalReceipt = Schema.Struct({
    predecessor: AuthSessionId,
    retryUntil: Schema.Number,
    successor: LibraryPublisherRenewal,
  });
  const receiptJson = Schema.fromJsonString(RenewalReceipt);
  const finishRenewal = Effect.fn("LibraryPublishingCredential.finishRenewal")(function* (
    receipt: typeof RenewalReceipt.Type,
  ) {
    // A cached response never restores a successor the operator has since revoked.
    yield* sessions
      .verify(receipt.successor.accessToken)
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "invalid" })));
    yield* sessions
      .revoke(receipt.predecessor)
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "issue" })));
    return receipt.successor;
  });
  const renew = Effect.fn("LibraryPublishingCredential.renew")(function* (token: string) {
    const now = yield* DateTime.now;
    const key = Hex.encode(
      yield* crypto.digest(Digest.sha256, new TextEncoder().encode(token)).pipe(Effect.orDie),
    );
    const receiptPath = path.join(config.secretsDir, `library-renewal-${key}.json`);
    const cached = yield* fs
      .readFileString(receiptPath)
      .pipe(Effect.flatMap(Schema.decodeEffect(receiptJson)), Effect.option);
    if (Option.isSome(cached) && cached.value.retryUntil > now.epochMilliseconds)
      return yield* finishRenewal(cached.value);
    const current = yield* sessions
      .verify(token)
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "invalid" })));
    if (
      current.method !== "bearer-access-token" ||
      !current.subject.startsWith("loom-host:") ||
      current.subject === "loom-host:" ||
      current.scopes.length !== 1 ||
      current.scopes[0] !== AuthLibraryPublishScope
    )
      return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
    const issuedAt = DateTime.formatIso(yield* DateTime.now);
    // Save the reply before revoking the predecessor so a lost reply or authority restart can replay it.
    const successor = yield* sessions
      .issue({
        subject: current.subject,
        method: current.method,
        client: current.client,
        scopes: [AuthLibraryPublishScope],
        ttl: Duration.days(30),
      })
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "issue" })));
    const receipt = {
      predecessor: current.sessionId,
      retryUntil: Math.min(
        now.epochMilliseconds + Duration.toMillis(Duration.minutes(15)),
        current.expiresAt?.epochMilliseconds ?? now.epochMilliseconds,
      ),
      successor: {
        sessionId: successor.sessionId,
        accessToken: successor.token,
        issuedAt,
        expiresAt: DateTime.formatIso(successor.expiresAt),
      },
    };
    const written = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* fs.makeDirectory(config.secretsDir, { recursive: true, mode: 0o700 });
        const directory = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ directory: config.secretsDir, prefix: ".renewal-" }),
          (dir) => fs.remove(dir, { recursive: true }).pipe(Effect.ignore),
        );
        const file = path.join(directory, "receipt.json");
        yield* fs.writeFileString(file, yield* Schema.encodeEffect(receiptJson)(receipt), {
          mode: 0o600,
          flag: "wx",
        });
        yield* Effect.scoped(fs.open(file).pipe(Effect.flatMap((handle) => handle.sync)));
        yield* fs.rename(file, receiptPath);
        yield* Effect.scoped(
          fs.open(config.secretsDir).pipe(Effect.flatMap((handle) => handle.sync)),
        );
      }),
    ).pipe(Effect.result);
    if (written._tag === "Failure") {
      yield* sessions.revoke(successor.sessionId).pipe(Effect.ignore);
      return yield* new LibraryPublishingCredentialError({ reason: "write" });
    }
    return yield* finishRenewal(receipt);
  }, credentialLock.withPermit);
  const credentialFileFor = Effect.fn("LibraryPublishingCredential.credentialFileFor")(
    function* (input: {
      readonly sourceEnvironmentId: EnvironmentId;
      readonly requestId?: string;
    }) {
      const sourceKey = Hex.encode(
        yield* crypto.digest(Digest.sha256, new TextEncoder().encode(input.sourceEnvironmentId)),
      ).slice(0, 32);
      const requestKey =
        input.requestId === undefined
          ? ""
          : `-${Hex.encode(yield* crypto.digest(Digest.sha256, new TextEncoder().encode(input.requestId))).slice(0, 32)}`;
      return path.join(config.secretsDir, `library-publisher-${sourceKey}${requestKey}.json`);
    },
    Effect.orDie,
  );
  const issue = Effect.fn("LibraryPublishingCredential.issue")(function* (
    input: Parameters<LibraryPublishingCredential["Service"]["issue"]>[0] & {
      readonly requestId?: string;
    },
  ) {
    const url = yield* Effect.try({
      try: () => new URL(input.libraryUrl),
      catch: (cause) => new LibraryPublishingCredentialError({ reason: "invalid", cause }),
    });
    const ttl = input.ttl ?? Duration.days(30);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      Duration.toMillis(ttl) <= 0 ||
      Duration.toMillis(ttl) > Duration.toMillis(Duration.days(90))
    )
      return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
    const credentialFile = yield* credentialFileFor(input);
    if (
      yield* fs
        .exists(credentialFile)
        .pipe(
          Effect.mapError(
            (cause) => new LibraryPublishingCredentialError({ reason: "write", cause }),
          ),
        )
    )
      return yield* new LibraryPublishingCredentialError({ reason: "exists" });
    const predecessors =
      input.requestId === undefined
        ? undefined
        : (yield* sessions
            .listActive()
            .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "issue" }))))
            .filter((session) => session.subject === `loom-host:${input.sourceEnvironmentId}`)
            .map((session) => session.sessionId);
    const session = yield* sessions
      .issue({
        subject: `loom-host:${input.sourceEnvironmentId}`,
        method: "bearer-access-token",
        scopes: [AuthLibraryPublishScope],
        ttl,
        client: { deviceType: "bot", label: "Loom Library publisher" },
      })
      .pipe(
        Effect.mapError(
          (cause) => new LibraryPublishingCredentialError({ reason: "issue", cause }),
        ),
      );
    const written = yield* Effect.result(
      Effect.gen(function* () {
        const contents = yield* encodeCredential({
          version: 1,
          sourceEnvironmentId: input.sourceEnvironmentId,
          libraryEnvironmentId: yield* identity.getEnvironmentId,
          libraryUrl: url.toString().replace(/\/$/, ""),
          sessionId: session.sessionId,
          accessToken: session.token,
          expiresAt: DateTime.formatIso(session.expiresAt),
          issuedAt: DateTime.formatIso(yield* DateTime.now), // fork: project-library
          ...(predecessors === undefined ? {} : { predecessors }),
        });
        yield* writeLibraryCredential({ file: credentialFile, contents, exclusive: true }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        );
      }),
    );
    if (written._tag === "Failure") {
      const published = yield* fs.readFileString(credentialFile).pipe(
        Effect.flatMap(decodeEnrollment),
        Effect.map((credential) => credential.sessionId === session.sessionId),
        Effect.orElseSucceed(() => false),
      );
      // A complete receipt can retry its sync; revoking it would poison the saved operation.
      if (!published) yield* sessions.revoke(session.sessionId).pipe(Effect.ignore);
      return yield* new LibraryPublishingCredentialError({ reason: "write" });
    }
    return { credentialFile, sessionId: session.sessionId, expiresAt: session.expiresAt };
  });
  const readEnrollment = Effect.fn("LibraryPublishingCredential.readEnrollment")(function* (
    input: EnrollmentInput,
    credentialFile: string,
  ) {
    const credential = yield* Effect.gen(function* () {
      const stat = yield* fs.stat(credentialFile);
      if ((stat.mode & 0o077) !== 0 || Number(stat.size) > 16 * 1024)
        return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
      return yield* decodeEnrollment(yield* fs.readFileString(credentialFile));
    }).pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "write" })));
    const requestedUrl = yield* Effect.try({
      try: () => new URL(input.libraryUrl).toString().replace(/\/$/u, ""),
      catch: () => new LibraryPublishingCredentialError({ reason: "invalid" }),
    });
    if (
      credential.sourceEnvironmentId !== input.sourceEnvironmentId ||
      credential.libraryEnvironmentId !== (yield* identity.getEnvironmentId) ||
      credential.libraryUrl !== requestedUrl
    )
      return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
    const session = yield* sessions
      .verify(Redacted.value(credential.accessToken))
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "invalid" })));
    if (
      session.sessionId !== credential.sessionId ||
      session.subject !== `loom-host:${input.sourceEnvironmentId}` ||
      session.scopes.length !== 1 ||
      session.scopes[0] !== AuthLibraryPublishScope
    )
      return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
    return credential;
  });
  const checkEnrollment = Effect.fn("LibraryPublishingCredential.checkEnrollment")(function* (
    input: EnrollmentInput,
  ) {
    const credentialFile = yield* credentialFileFor(input);
    const exists = yield* fs
      .exists(credentialFile)
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "write" })));
    if (exists) yield* readEnrollment(input, credentialFile);
  }, credentialLock.withPermit);
  const enroll: LibraryPublishingCredential["Service"]["enroll"] = Effect.fn(
    "LibraryPublishingCredential.enroll",
  )(function* (input) {
    const credentialFile = yield* credentialFileFor(input);
    if (
      !(yield* fs
        .exists(credentialFile)
        .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "write" }))))
    )
      yield* issue(input);
    const credential = yield* readEnrollment(input, credentialFile);
    yield* Effect.scoped(fs.open(credentialFile).pipe(Effect.flatMap((file) => file.sync))).pipe(
      Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "write" })),
    );
    yield* Effect.scoped(
      fs.open(path.dirname(credentialFile)).pipe(Effect.flatMap((file) => file.sync)),
    ).pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "write" })));
    return credential;
  }, credentialLock.withPermit);
  const activate: LibraryPublishingCredential["Service"]["activate"] = Effect.fn(
    "LibraryPublishingCredential.activate",
  )(function* (input) {
    const current = yield* sessions
      .verify(input.token)
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "invalid" })));
    if (
      !current.subject.startsWith("loom-host:") ||
      current.scopes.length !== 1 ||
      current.scopes[0] !== AuthLibraryPublishScope
    )
      return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
    const credentialFile = yield* credentialFileFor({
      sourceEnvironmentId: EnvironmentId.make(current.subject.slice("loom-host:".length)),
      requestId: input.requestId,
    });
    const credential = yield* fs.readFileString(credentialFile).pipe(
      Effect.flatMap(decodeActivationReceipt),
      Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "invalid" })),
    );
    if (credential.sessionId !== current.sessionId || credential.issuedAt === undefined)
      return yield* new LibraryPublishingCredentialError({ reason: "invalid" });
    const active = yield* sessions
      .listActive()
      .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "issue" })));
    for (const session of active) {
      if (
        session.sessionId !== current.sessionId &&
        session.subject === current.subject &&
        credential.predecessors?.includes(session.sessionId)
      )
        yield* sessions
          .revoke(session.sessionId)
          .pipe(Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "issue" })));
    }
  }, credentialLock.withPermit);
  const revokeForComputer = Effect.fn("LibraryPublishingCredential.revokeForComputer")(
    function* (environmentId: EnvironmentId) {
      const active = yield* sessions.listActive();
      for (const session of active) {
        if (session.subject === `loom-host:${environmentId}`)
          yield* sessions.revoke(session.sessionId);
      }
    },
    credentialLock.withPermit,
    Effect.mapError(() => new LibraryPublishingCredentialError({ reason: "issue" })),
  );

  return LibraryPublishingCredential.of({
    renew,
    issue,
    enroll,
    activate,
    revokeForComputer,
    checkEnrollment,
  });
});
export const layer = Layer.effect(LibraryPublishingCredential, make);
