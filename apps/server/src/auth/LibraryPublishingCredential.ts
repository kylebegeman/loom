import { AuthLibraryPublishScope, AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
// fork: project-library
import * as Option from "effect/Option";
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
import { LibraryPublisherRenewal } from "@t3tools/contracts/fork";
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
});
const encodeCredential = Schema.encodeEffect(
  Schema.fromJsonString(LibraryPublishingCredentialFile),
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
export class LibraryPublishingCredential extends Context.Service<
  LibraryPublishingCredential,
  {
    // fork: project-library
    readonly renew: (
      token: string,
    ) => Effect.Effect<typeof LibraryPublisherRenewal.Type, LibraryPublishingCredentialError>;
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
  const crypto = yield* Crypto.Crypto;
  const config = yield* ServerConfig.ServerConfig;
  const identity = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const sessions = yield* SessionStore.SessionStore;
  // fork: project-library
  const renewalLock = yield* Semaphore.make(1);
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
      yield* crypto.digest("SHA-256", new TextEncoder().encode(token)).pipe(Effect.orDie),
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
  }, renewalLock.withPermit);
  return LibraryPublishingCredential.of({
    renew, // fork: project-library
    issue: Effect.fn("LibraryPublishingCredential.issue")(function* (input) {
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
      const sourceKey = Hex.encode(
        yield* crypto
          .digest("SHA-256", new TextEncoder().encode(input.sourceEnvironmentId))
          .pipe(Effect.orDie),
      ).slice(0, 32);
      const credentialFile = path.join(config.secretsDir, `library-publisher-${sourceKey}.json`);
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
          yield* fs.makeDirectory(config.secretsDir, { recursive: true, mode: 0o700 });
          yield* fs.writeFileString(
            credentialFile,
            yield* encodeCredential({
              version: 1,
              sourceEnvironmentId: input.sourceEnvironmentId,
              libraryEnvironmentId: yield* identity.getEnvironmentId,
              libraryUrl: url.toString().replace(/\/$/, ""),
              sessionId: session.sessionId,
              accessToken: session.token,
              expiresAt: DateTime.formatIso(session.expiresAt),
              issuedAt: DateTime.formatIso(yield* DateTime.now), // fork: project-library
            }),
            { flag: "wx", mode: 0o600 },
          );
          yield* Effect.scoped(fs.open(credentialFile).pipe(Effect.flatMap((file) => file.sync)));
          yield* Effect.scoped(
            fs.open(config.secretsDir).pipe(Effect.flatMap((file) => file.sync)),
          );
        }),
      );
      if (written._tag === "Failure") {
        yield* sessions.revoke(session.sessionId).pipe(Effect.ignore);
        return yield* new LibraryPublishingCredentialError({
          reason: "write",
          cause: written.failure,
        });
      }
      return { credentialFile, sessionId: session.sessionId, expiresAt: session.expiresAt };
    }),
  });
});
export const layer = Layer.effect(LibraryPublishingCredential, make);
