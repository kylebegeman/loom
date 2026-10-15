import { AuthLibraryPublishScope, AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
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
  return LibraryPublishingCredential.of({
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
