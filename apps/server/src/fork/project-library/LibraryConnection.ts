import { EnvironmentId, IsoDateTime } from "@t3tools/contracts";
import { LibraryComputerRegistration, LibraryError } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
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

const LibraryHostCredential = Schema.Struct({
  computer: Schema.optional(LibraryComputerRegistration),
  version: Schema.Literal(1),
  sourceEnvironmentId: EnvironmentId,
  libraryEnvironmentId: EnvironmentId,
  libraryUrl: Schema.String,
  sessionId: Schema.String,
  accessToken: Schema.RedactedFromValue(Schema.String),
  expiresAt: IsoDateTime,
});
export type LibraryHostCredential = typeof LibraryHostCredential.Type;
const decodeCredential = Schema.decodeEffect(Schema.fromJsonString(LibraryHostCredential));

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
  "This computer's sign-in to your Library is missing or expired. Reconnect this computer to your Library, then try again.";
export const LIBRARY_NOT_CONNECTED =
  "This computer is not connected to a Library. Connect it to your Library, then try again.";
export const LIBRARY_MISMATCH =
  "This computer is signed in to a different Library. Reconnect it to your Library, then try again.";

/** Reads this computer's Library configuration and sign-in once. Fails `invalid` on a bad URL. */
export const resolveLibraryConnection = Effect.gen(function* () {
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
  if (
    credential !== null &&
    (credential.sourceEnvironmentId !== sourceEnvironmentId ||
      Date.parse(credential.expiresAt) <= (yield* Clock.currentTimeMillis))
  )
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
    origin: base.origin,
    endpoint: (path: string) => new URL(path, base).toString(),
    send,
  };
  return remote;
});
