import * as HostProcess from "@t3tools/shared/HostProcess";
import {
  REACH_IDENTITY_DEFAULT_MAX_SESSION_AGE_SECONDS,
  ReachError,
  ReachIdentityMaxSessionAge,
  ReachPrepared,
  type ReachApplyIdentityInput,
} from "@t3tools/contracts/fork";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../../config.ts";

const HostIdentityFile = Schema.Struct({
  version: Schema.Literal(1),
  prepared: ReachPrepared,
  allowedSubjects: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096)),
  requirePasskey: Schema.Boolean,
  /** Files saved before the field get the default, so their computers renew sign-ins too. */
  maxSessionAgeSeconds: ReachIdentityMaxSessionAge.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(REACH_IDENTITY_DEFAULT_MAX_SESSION_AGE_SECONDS)),
  ),
});
const codec = Schema.fromJsonString(HostIdentityFile);
const isReachError = Schema.is(ReachError);
export class HostIdentityRestart extends Context.Service<
  HostIdentityRestart,
  {
    readonly request: Effect.Effect<void>;
  }
>()("t3/fork/reach/HostIdentity/HostIdentityRestart") {}

const read = Effect.fn("HostIdentity.read")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join((yield* ServerConfig.ServerConfig).secretsDir, "reach-identity.json");
    if (!(yield* fs.exists(file))) return null;
    const stat = yield* fs.stat(file);
    if (stat.type !== "File" || (stat.mode & 0o077) !== 0 || stat.size > 16n * 1024n)
      return yield* new ReachError({ reason: "storage" });
    return yield* fs.readFileString(file).pipe(Effect.flatMap(Schema.decodeEffect(codec)));
  },
  Effect.mapError(() => new ReachError({ reason: "storage" })),
);

export const applyHostIdentity = Effect.fn("HostIdentity.apply")(
  function* (prepared: ReachPrepared | null, input: ReachApplyIdentityInput) {
    const restart = yield* Effect.serviceOption(HostIdentityRestart);
    if (prepared === null || Option.isNone(restart))
      return yield* new ReachError({ reason: "unavailable" });
    const env = yield* HostProcess.Environment;
    const saved = yield* read();
    const allowedSubjects =
      input.allowedSubjects?.trim() ||
      env.LOOM_IDENTITY_ALLOWED_SUBJECTS?.trim() ||
      saved?.allowedSubjects;
    if (
      !allowedSubjects ||
      allowedSubjects.split(",").some((subject) => subject.trim() === "" || subject.trim() === "*")
    )
      return yield* new ReachError({ reason: "identity-allowlist" });
    for (const value of [prepared.issuer, prepared.resource]) {
      const url = yield* Effect.try(() => new URL(value)).pipe(
        Effect.mapError(() => new ReachError({ reason: "unavailable" })),
      );
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
        return yield* new ReachError({ reason: "unavailable" });
    }
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = (yield* ServerConfig.ServerConfig).secretsDir;
    const contents = yield* Schema.encodeEffect(codec)({
      version: 1,
      prepared,
      allowedSubjects,
      requirePasskey: input.requirePasskey,
      maxSessionAgeSeconds:
        input.maxSessionAgeSeconds ??
        saved?.maxSessionAgeSeconds ??
        REACH_IDENTITY_DEFAULT_MAX_SESSION_AGE_SECONDS,
    });
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
        const temporary = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ directory, prefix: ".identity-" }),
          (dir) => fs.remove(dir, { recursive: true }).pipe(Effect.ignore),
        );
        const file = path.join(temporary, "identity.json");
        yield* fs.writeFileString(file, contents, { flag: "wx", mode: 0o600 });
        yield* Effect.scoped(fs.open(file).pipe(Effect.flatMap((handle) => handle.sync)));
        yield* fs.rename(file, path.join(directory, "reach-identity.json"));
        yield* Effect.scoped(fs.open(directory).pipe(Effect.flatMap((handle) => handle.sync)));
      }),
    );
    yield* restart.value.request;
  },
  Effect.mapError((error) => (isReachError(error) ? error : new ReachError({ reason: "storage" }))),
);

/** Relaunches the backend layers after their finalizers finish, keeping the desktop launcher alive. */
export const withHostIdentity = Effect.fn("HostIdentity.withHostIdentity")(function* <A, E, R>(
  run: Effect.Effect<A, E, R>,
) {
  const processEnvironment = yield* HostProcess.Environment;
  for (;;) {
    // A damaged saved identity must not keep the server from starting; Reach reports it as missing.
    const saved = yield* read().pipe(
      Effect.catch((error) =>
        Effect.logWarning("Ignoring the saved Reach identity", { reason: error.reason }).pipe(
          Effect.as(null),
        ),
      ),
    );
    const defaults: NodeJS.ProcessEnv =
      saved === null
        ? {}
        : {
            LOOM_IDENTITY_ISSUER: saved.prepared.issuer,
            LOOM_IDENTITY_NATIVE_CLIENT_ID: saved.prepared.nativeClientId,
            LOOM_IDENTITY_AUDIENCE: saved.prepared.resource,
            LOOM_IDENTITY_RESOURCE: saved.prepared.resource,
            ...(saved.prepared.desktopRedirectUri === undefined
              ? {}
              : { LOOM_IDENTITY_DESKTOP_REDIRECT_URI: saved.prepared.desktopRedirectUri }),
            LOOM_IDENTITY_ALLOWED_SUBJECTS: saved.allowedSubjects,
            LOOM_IDENTITY_MAX_SESSION_AGE: String(saved.maxSessionAgeSeconds),
            ...(saved.requirePasskey ? { LOOM_IDENTITY_REQUIRE_PASSKEY: "true" } : {}),
          };
    const environment = { ...defaults, ...processEnvironment };
    const restarted = yield* Effect.scoped(
      Effect.gen(function* () {
        const signal = yield* Deferred.make<void>();
        const scope = yield* Effect.scope;
        // Give the authenticated mutation's reply time to leave before closing its socket.
        const request = Deferred.succeed(signal, undefined).pipe(
          Effect.delay("1 second"),
          Effect.forkIn(scope),
          Effect.asVoid,
        );
        return yield* Effect.raceFirst(
          run.pipe(Effect.as(false), Effect.provideService(HostIdentityRestart, { request })),
          Deferred.await(signal).pipe(Effect.as(true)),
        );
      }).pipe(
        Effect.provideService(HostProcess.Environment, environment),
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({
            env: Object.fromEntries(
              Object.entries(environment).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
          }),
        ),
      ),
    );
    if (!restarted) return;
  }
});
