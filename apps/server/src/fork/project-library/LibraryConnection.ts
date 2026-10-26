import { EnvironmentId, IsoDateTime } from "@t3tools/contracts";
import {
  LibraryComputerRegistration,
  LibraryError,
  LIBRARY_PUBLISHER_RENEW_ROUTE,
  LibraryPublisherRenewal,
  type LibrarySignInStatus,
} from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Redacted from "effect/Redacted";
import * as Semaphore from "effect/Semaphore";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";
import * as ServerConfig from "../../config.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import { libraryComputerDirectory } from "./enrollment.ts";
import * as BackgroundChecks from "../background-checks/BackgroundChecks.ts";

const LibraryHostCredential = Schema.Struct({
  computer: Schema.optional(LibraryComputerRegistration),
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String,
  sessionId: Schema.String,
  accessToken: Schema.RedactedFromValue(Schema.String),
  expiresAt: IsoDateTime,
  issuedAt: Schema.optional(IsoDateTime),
  renewedAt: Schema.optional(IsoDateTime),
});
export type LibraryHostCredential = typeof LibraryHostCredential.Type;
const decodeCredential = Schema.decodeEffect(Schema.fromJsonString(LibraryHostCredential));
const decodeJson = Schema.decodeSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

/**
 * How this computer reaches its Library. `none` has no Library configured, `unavailable` has a
 * sign-in that is unreadable, expired or for another computer or Library, and `authority` is the
 * Library itself.
 */
export type LibraryConnection =
  | { readonly kind: "none" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "authority" }
  | {
      readonly kind: "remote";
      readonly credential: LibraryHostCredential | null;
      readonly credentialFile?: string;
      readonly credentialAvailable?: boolean;
      /** The Library URL's origin, which directory reports name as their audience. */
      readonly origin: string;
      readonly endpoint: (path: string) => string;
      /** Sends with the publisher bearer token. Fails `blocked` without one, `io` on transport. */
      readonly send: (
        request: HttpClientRequest.HttpClientRequest,
      ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LibraryError>;
    };

const NONE: LibraryConnection = { kind: "none" };
const UNAVAILABLE: LibraryConnection = { kind: "unavailable" };
const AUTHORITY: LibraryConnection = { kind: "authority" };

export const LIBRARY_SIGN_IN_MISSING =
  "This computer's sign-in to your Library is missing or expired. Open Settings > Connections on this computer. Ask your Library administrator to replace its publisher credential, then try again. Loom reloads it automatically.";
export const LIBRARY_NOT_CONNECTED =
  "This computer is not connected to a Library. Connect it to your Library, then try again.";
export const LIBRARY_MISMATCH =
  "This computer is signed in to a different Library. Reconnect it to your Library, then try again.";

/** Reads only private host configuration. Credential bytes never enter error causes. */
export const readLibraryConnection = Effect.gen(function* () {
  const localAuthority = yield* Config.Boolean("LOOM_LIBRARY_AUTHORITY").pipe(
    Config.withDefault(false),
  );
  const configuredUrl = yield* Config.String("LOOM_LIBRARY_URL").pipe(Config.option);
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const configuredCredentialFile = yield* Config.String("LOOM_LIBRARY_CREDENTIAL_FILE").pipe(
    Config.option,
  );
  const sourceEnvironmentId = yield* (yield* ServerEnvironmentIdentity).getEnvironmentId;
  const computerDirectory = libraryComputerDirectory(
    yield* HostProcess.HomeDirectory,
    sourceEnvironmentId,
  );
  const externalCredentialFile = path.join(computerDirectory, "publisher.json");
  const defaultCredentialFile = (yield* fs.exists(externalCredentialFile))
    ? externalCredentialFile
    : path.join(config.secretsDir, "library-publisher.json");
  const credentialFile = Option.isSome(configuredCredentialFile)
    ? configuredCredentialFile
    : (yield* fs.exists(defaultCredentialFile))
      ? Option.some(defaultCredentialFile)
      : Option.none();
  if (
    !localAuthority &&
    Option.isNone(credentialFile) &&
    (Option.isNone(configuredUrl) || configuredUrl.value.trim() === "")
  ) {
    return NONE;
  }
  if (localAuthority) return AUTHORITY;
  const credentialResult = Option.isNone(credentialFile)
    ? null
    : yield* Effect.gen(function* () {
        const stat = yield* fs.stat(credentialFile.value);
        if ((stat.mode & 0o077) !== 0 || Number(stat.size) > 16 * 1024)
          return yield* new LibraryError({ reason: "invalid" });
        return yield* decodeCredential(yield* fs.readFileString(credentialFile.value));
      }).pipe(
        Effect.mapError(() => new LibraryError({ reason: "blocked" })),
        Effect.result,
      );
  if (credentialResult !== null && credentialResult._tag === "Failure") return UNAVAILABLE;
  const credential = credentialResult === null ? null : credentialResult.success;
  if (credential !== null && credential.sourceEnvironmentId !== sourceEnvironmentId)
    return UNAVAILABLE;
  const selectedUrl =
    Option.isSome(configuredUrl) && configuredUrl.value.trim() !== ""
      ? configuredUrl.value
      : credential?.libraryUrl;
  if (selectedUrl === undefined) return yield* new LibraryError({ reason: "invalid" });
  const base = yield* Effect.try({
    try: () => new URL(selectedUrl),
    catch: () => new LibraryError({ reason: "invalid" }),
  });
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    return yield* new LibraryError({ reason: "invalid" });
  if (
    credential !== null &&
    base.toString() !==
      (yield* Effect.try({
        try: () => new URL(credential.libraryUrl).toString(),
        catch: () => new LibraryError({ reason: "invalid" }),
      }))
  )
    return UNAVAILABLE;
  const token =
    credential === null
      ? yield* Config.Redacted("LOOM_LIBRARY_TOKEN").pipe(Config.option)
      : Option.some(credential.accessToken);
  const http = yield* HttpClient.HttpClient;
  const send = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
    if (
      Option.isNone(token) ||
      (credential !== null && Date.parse(credential.expiresAt) <= (yield* Clock.currentTimeMillis))
    )
      return yield* new LibraryError({ reason: "blocked", detail: LIBRARY_SIGN_IN_MISSING });
    // HTTP failures can hold a request containing its token. Do not retain that cause.
    return yield* http.execute(request.pipe(HttpClientRequest.bearerToken(token.value))).pipe(
      Effect.timeout("3 minutes"),
      Effect.mapError(() => new LibraryError({ reason: "io" })),
    );
  });
  const remote: LibraryConnection = {
    kind: "remote",
    credential,
    credentialAvailable: Option.isSome(token),
    ...(Option.isSome(credentialFile) ? { credentialFile: credentialFile.value } : {}),
    origin: base.origin,
    endpoint: (path: string) => new URL(path, base).toString(),
    send,
  };
  return remote;
});

const DAY_MS = 24 * 60 * 60_000;
const RETRY_MS = 10 * 60_000;

/** Older enrollment files omit issuedAt; their signed session payload already records it. */
const renewalTime = (credential: LibraryHostCredential) => {
  const expires = Date.parse(credential.expiresAt);
  let issued = credential.issuedAt === undefined ? NaN : Date.parse(credential.issuedAt);
  if (!Number.isFinite(issued)) {
    try {
      const claims: unknown = decodeJson(
        Buffer.from(Redacted.value(credential.accessToken).split(".")[0]!, "base64url").toString(
          "utf8",
        ),
      );
      if (
        typeof claims === "object" &&
        claims !== null &&
        "iat" in claims &&
        typeof claims.iat === "number"
      )
        issued = claims.iat;
    } catch {
      /* Legacy opaque tokens use the issuer's default lifetime. */
    }
  }
  if (!Number.isFinite(issued) || issued >= expires) issued = expires - 30 * DAY_MS;
  return issued + ((expires - issued) * 2) / 3;
};

export class LibraryConnectionService extends Context.Service<
  LibraryConnectionService,
  {
    readonly current: Effect.Effect<LibraryConnection>;
    readonly status: Effect.Effect<LibrarySignInStatus>;
    /** Relative Library paths are resolved only after reloading the current credential. */
    readonly send: (
      request: HttpClientRequest.HttpClientRequest,
    ) => Effect.Effect<HttpClientResponse.HttpClientResponse, LibraryError>;
  }
>()("t3/fork/project-library/LibraryConnection/LibraryConnectionService") {}

const UNSUPPORTED_REPAIR =
  "Update Loom on your Library to renew this computer's sign-in automatically. Its current sign-in is kept until it expires.";
const RETRYING_REPAIR =
  "Loom could not renew this computer's Library sign-in. Check the Library connection and that its private credential file is writable. Loom will retry.";
const UNSAVED_REPAIR =
  "Loom renewed this computer's Library sign-in but could not save its private credential file. Make the file writable. Loom will retry saving it.";

const make = Effect.gen(function* () {
  const context = yield* Effect.context<Effect.Services<typeof readLibraryConnection>>();
  const read = readLibraryConnection.pipe(
    Effect.provide(context),
    Effect.orElseSucceed(() => UNAVAILABLE),
  );
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const lock = yield* Semaphore.make(1);
  const checks = yield* BackgroundChecks.recorder;
  let retryAt = 0;
  let lastSession: string | null = null;
  let renewal: LibrarySignInStatus["renewal"] = "automatic";
  // Keep a received successor until it is durably saved. A transient disk failure must not
  // send the revoked predecessor again or rotate another successor.
  let pending: { file: string; previous: string; contents: string } | null = null;
  const save = Effect.fn("LibraryConnection.saveSuccessor")(function* () {
    if (pending === null) return;
    const next = pending;
    const disk = yield* read;
    if (disk.kind !== "remote" || disk.credential?.sessionId !== next.previous) {
      pending = null;
      return;
    }
    yield* Effect.scoped(
      Effect.gen(function* () {
        const dir = path.dirname(next.file);
        const temporary = yield* Effect.acquireRelease(
          fs.makeTempDirectory({ directory: dir, prefix: ".publisher-" }),
          (name) => fs.remove(name, { recursive: true }).pipe(Effect.ignore),
        );
        const file = path.join(temporary, "publisher.json");
        yield* fs.writeFileString(file, next.contents, { mode: 0o600, flag: "wx" });
        yield* Effect.scoped(fs.open(file).pipe(Effect.flatMap((handle) => handle.sync)));
        yield* fs.rename(file, next.file);
        yield* Effect.scoped(fs.open(dir).pipe(Effect.flatMap((handle) => handle.sync)));
      }),
    );
    pending = null;
  });
  const attempt = Effect.fn("LibraryConnection.renew")(function* (
    connection: Extract<LibraryConnection, { kind: "remote" }>,
    credential: LibraryHostCredential,
    file: string,
    now: number,
  ) {
    const result = yield* connection
      .send(HttpClientRequest.post(connection.endpoint(LIBRARY_PUBLISHER_RENEW_ROUTE)))
      .pipe(Effect.timeout("20 seconds"), Effect.result);
    if (result._tag === "Failure") {
      renewal = "retrying";
      return connection;
    }
    const response = result.success;
    if (
      response.status === 404 ||
      response.status === 405 ||
      /^text\/html\b/i.test(response.headers["content-type"] ?? "")
    ) {
      if (renewal !== "unsupported") yield* Effect.logWarning(UNSUPPORTED_REPAIR);
      renewal = "unsupported";
      return connection;
    }
    const next =
      response.status === 200
        ? yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(LibraryPublisherRenewal)),
            Effect.option,
          )
        : Option.none();
    if (
      Option.isNone(next) ||
      Date.parse(next.value.expiresAt) <= now ||
      next.value.sessionId === credential.sessionId
    ) {
      renewal = "retrying";
      return connection;
    }
    const contents = yield* encodeJson({
      ...credential,
      ...next.value,
      renewedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
    }).pipe(Effect.option);
    if (Option.isNone(contents)) {
      renewal = "retrying";
      return UNAVAILABLE;
    }
    pending = {
      file,
      previous: credential.sessionId,
      contents: contents.value + "\n",
    };
    const written = yield* save().pipe(Effect.result);
    renewal = written._tag === "Failure" ? "retrying" : "automatic";
    return written._tag === "Failure" ? UNAVAILABLE : yield* read;
  });
  const refresh = lock.withPermit(
    Effect.gen(function* () {
      if (pending !== null) {
        const written = yield* save().pipe(Effect.result);
        if (written._tag === "Failure") {
          renewal = "retrying";
          yield* checks.fail("library-renewal", UNSAVED_REPAIR);
          return UNAVAILABLE;
        }
      }
      const connection = yield* read;
      if (connection.kind !== "remote" || connection.credential === null) {
        yield* checks.clear("library-renewal");
        return connection;
      }
      const credential = connection.credential;
      const now = yield* Clock.currentTimeMillis;
      if (lastSession !== credential.sessionId) {
        lastSession = credential.sessionId;
        retryAt = 0;
        renewal = "automatic";
        yield* checks.clear("library-renewal");
      }
      if (Date.parse(credential.expiresAt) <= now) return connection;
      if (now < renewalTime(credential) || now < retryAt || connection.credentialFile === undefined)
        return connection;
      retryAt = now + RETRY_MS;
      // An attempt leaves its outcome in `renewal`
      return yield* attempt(connection, credential, connection.credentialFile, now).pipe(
        Effect.tap(() =>
          renewal === "automatic"
            ? checks.clear("library-renewal")
            : checks.fail(
                "library-renewal",
                renewal === "unsupported" ? UNSUPPORTED_REPAIR : RETRYING_REPAIR,
              ),
        ),
      );
    }),
  );
  const current = Effect.gen(function* () {
    const connection = yield* refresh;
    return connection.kind === "remote" &&
      connection.credential !== null &&
      Date.parse(connection.credential.expiresAt) <= (yield* Clock.currentTimeMillis)
      ? UNAVAILABLE
      : connection;
  });
  const status = Effect.gen(function* () {
    const connection = yield* refresh;
    const empty = {
      expiresAt: null,
      renewsAt: null,
      renewal: "unavailable" as const,
      repair: null,
    };
    if (connection.kind === "authority" || connection.kind === "none")
      return { ...empty, state: connection.kind };
    if (
      connection.kind === "remote" &&
      connection.credential === null &&
      connection.credentialAvailable
    )
      return { ...empty, state: "ready" as const };
    if (connection.kind !== "remote" || connection.credential === null)
      return {
        ...empty,
        state: "unavailable" as const,
        renewal: pending === null ? empty.renewal : ("retrying" as const),
        repair: pending === null ? LIBRARY_SIGN_IN_MISSING : UNSAVED_REPAIR,
      };
    const now = yield* Clock.currentTimeMillis;
    const credential = connection.credential;
    const expires = Date.parse(credential.expiresAt);
    const due = renewalTime(credential);
    const state =
      expires <= now
        ? ("expired" as const)
        : due <= now
          ? ("expiring" as const)
          : ("ready" as const);
    return {
      state,
      expiresAt: credential.expiresAt,
      renewsAt: DateTime.formatIso(DateTime.makeUnsafe(due)),
      renewal,
      renewedAt: credential.renewedAt ?? null,
      repair:
        state === "expired"
          ? LIBRARY_SIGN_IN_MISSING
          : renewal === "unsupported"
            ? "Update Loom on your Library to enable automatic sign-in renewal before this date."
            : renewal === "retrying"
              ? RETRYING_REPAIR
              : null,
    };
  });
  const send = Effect.fn("LibraryConnection.send")(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const connection = yield* current;
    if (connection.kind !== "remote")
      return yield* new LibraryError({ reason: "blocked", detail: LIBRARY_SIGN_IN_MISSING });
    // Refuse absolute URLs outside the configured Library, including after a host config repair.
    const target = new URL(request.url, connection.origin);
    if (target.origin !== connection.origin)
      return yield* new LibraryError({ reason: "blocked", detail: LIBRARY_MISMATCH });
    return yield* connection.send(HttpClientRequest.setUrl(request, target.toString()));
  });
  return LibraryConnectionService.of({ current, status, send });
});
export const layer = Layer.effect(LibraryConnectionService, make);
export const resolveLibraryConnection = Effect.flatMap(
  LibraryConnectionService,
  (service) => service.current,
);
