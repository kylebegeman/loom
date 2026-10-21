import { VaultError, type VaultCoreStatus } from "@t3tools/contracts/fork";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

export class OpenBaoStore extends Context.Service<
  OpenBaoStore,
  {
    readonly status: Effect.Effect<VaultCoreStatus>;
    readonly read: (key: string) => Effect.Effect<
      {
        readonly value: Redacted.Redacted<unknown>;
        readonly version: number;
      } | null,
      VaultError
    >;
    readonly write: (
      key: string,
      value: Redacted.Redacted<unknown>,
      expectedVersion: number,
    ) => Effect.Effect<number, VaultError>;
    readonly keys: (prefix: string) => Effect.Effect<ReadonlyArray<string>, VaultError>;
  }
>()("t3/fork/vault/OpenBaoStore") {}

// OpenBao limits JSON complexity by string count, including repeated object keys.
// A versioned JSON payload keeps bounded policy/audit registries below that engine limit.
const StoredValue = Schema.Struct({
  loomVaultEncoding: Schema.Literal("json-v1"),
  payload: Schema.fromJsonString(Schema.Unknown),
});
const encodeValue = Schema.encodeEffect(StoredValue),
  decodeValue = Schema.decodeUnknownOption(StoredValue);
const ReadResponse = Schema.Struct({
  data: Schema.Struct({
    data: Schema.RedactedFromValue(Schema.Unknown),
    metadata: Schema.Struct({ version: Schema.Int.check(Schema.isGreaterThan(0)) }),
  }),
});
const WriteResponse = Schema.Struct({
  data: Schema.Struct({ version: Schema.Int.check(Schema.isGreaterThan(0)) }),
});
const ListResponse = Schema.Struct({
  data: Schema.Struct({
    keys: Schema.Array(Schema.String).check(Schema.isMaxLength(4096)),
  }),
});
const HealthResponse = Schema.Struct({ initialized: Schema.Boolean, sealed: Schema.Boolean });
const ConfigResponse = Schema.Struct({
  data: Schema.Struct({ cas_required: Schema.Literal(true) }),
});
const ErrorResponse = Schema.Struct({ errors: Schema.Array(Schema.String) });
const decodeMissing = Schema.decodeUnknownOption(
  Schema.Struct({ errors: Schema.optionalKey(Schema.Array(Schema.Never)) }),
  { onExcessProperty: "error" },
);
const decodeRead = Schema.decodeUnknownOption(ReadResponse);
const decodeWrite = Schema.decodeUnknownOption(WriteResponse);
const decodeKeys = Schema.decodeUnknownOption(ListResponse);
const decodeHealth = Schema.decodeUnknownOption(HealthResponse);
const decodeConfig = Schema.decodeUnknownOption(ConfigResponse);
const decodeError = Schema.decodeUnknownOption(ErrorResponse);
const encodeWrite = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      options: Schema.Struct({ cas: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
      data: Schema.Unknown,
    }),
  ),
);

function originFor(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && loopback) ? url.origin : null;
  } catch {
    return null;
  }
}
const validKey = (key: string) =>
  key.length <= 1024 && key.split("/").every((part) => /^[a-zA-Z0-9_-]+$/.test(part));

const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const platform = yield* HostProcess.Platform;
  const fs = yield* FileSystem.FileSystem;
  const http = yield* HttpClient.HttpClient;
  const rawOrigin = env.LOOM_VAULT_OPENBAO_URL?.trim();
  const tokenFile = env.LOOM_VAULT_OPENBAO_TOKEN_FILE?.trim();
  const mount = env.LOOM_VAULT_OPENBAO_MOUNT?.trim() || "loom";
  const origin = originFor(rawOrigin);
  const configured = Boolean(rawOrigin || tokenFile);
  const validConfiguration = Boolean(origin && tokenFile && validKey(mount));
  const requestOptions = Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" });
  const maxBody = Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.mebibytes(9));

  const execute = Effect.fn("OpenBaoStore.request")(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    if (!validConfiguration) return yield* new VaultError({ reason: "configuration" });
    const stat = yield* fs
      .stat(tokenFile!)
      .pipe(Effect.mapError(() => new VaultError({ reason: "configuration" })));
    if (
      stat.type !== "File" ||
      ByteSize.toBigInt(stat.size) > 16384n ||
      (platform !== "win32" && (stat.mode & 0o077) !== 0)
    ) {
      return yield* new VaultError({ reason: "configuration" });
    }
    const token = yield* fs
      .readFileString(tokenFile!)
      .pipe(Effect.mapError(() => new VaultError({ reason: "configuration" })));
    if (!token.trim() || /\s/.test(token.trim()))
      return yield* new VaultError({ reason: "configuration" });
    return yield* http
      .execute(request.pipe(HttpClientRequest.bearerToken(Redacted.make(token.trim()))))
      .pipe(
        requestOptions,
        Effect.timeout("15 seconds"),
        Effect.mapError(() => new VaultError({ reason: "unavailable" })),
      );
  });
  const json = (response: HttpClientResponse.HttpClientResponse) =>
    response.json.pipe(
      maxBody,
      Effect.timeout("15 seconds"),
      Effect.mapError(() => new VaultError({ reason: "invalid-response" })),
    );
  const check = Effect.fnUntraced(function* (response: HttpClientResponse.HttpClientResponse) {
    if (response.status === 401 || response.status === 403)
      return yield* new VaultError({ reason: "denied" });
    if (response.status >= 500) return yield* new VaultError({ reason: "unavailable" });
    if (response.status < 200 || response.status >= 300)
      return yield* new VaultError({ reason: "invalid-response" });
  });
  return OpenBaoStore.of({
    status: Effect.gen(function* () {
      const state = (value: VaultCoreStatus["state"]): VaultCoreStatus => ({
        backend: "openbao",
        state: value,
        origin,
      });
      if (!configured) return state("unconfigured");
      if (!validConfiguration) return state("misconfigured");
      const response = yield* execute(
        HttpClientRequest.get(`${origin}/v1/sys/health`).pipe(
          HttpClientRequest.setUrlParam("standbyok", "true"),
          HttpClientRequest.setUrlParam("perfstandbyok", "true"),
        ),
      );
      if (response.status === 401 || response.status === 403) yield* check(response);
      const health = decodeHealth(yield* json(response));
      if (Option.isNone(health)) return yield* new VaultError({ reason: "invalid-response" });
      if (!health.value.initialized || health.value.sealed) return state("locked");
      yield* check(response);
      const configuration = yield* execute(HttpClientRequest.get(`${origin}/v1/${mount}/config`));
      if (configuration.status === 404) return state("misconfigured");
      yield* check(configuration);
      if (Option.isNone(decodeConfig(yield* json(configuration)))) return state("misconfigured");
      return state("ready");
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed({
          backend: "openbao" as const,
          state:
            error.reason === "denied"
              ? ("denied" as const)
              : error.reason === "configuration"
                ? ("misconfigured" as const)
                : ("unavailable" as const),
          origin,
        }),
      ),
    ),
    read: Effect.fn("OpenBaoStore.read")(function* (key) {
      if (!validKey(key)) return yield* new VaultError({ reason: "invalid-input" });
      const response = yield* execute(HttpClientRequest.get(`${origin}/v1/${mount}/data/${key}`));
      if (response.status === 404) {
        // KV v2 returns 404 with metadata for deleted versions; absence must not reset a ledger.
        if (Option.isNone(decodeMissing(yield* json(response))))
          return yield* new VaultError({ reason: "invalid-response" });
        return null;
      }
      yield* check(response);
      const decoded = decodeRead(yield* json(response));
      if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-response" });
      let value = decoded.value.data.data;
      const raw = Redacted.value(value);
      if (
        raw !== null &&
        typeof raw === "object" &&
        Object.prototype.hasOwnProperty.call(raw, "loomVaultEncoding")
      ) {
        const envelope = decodeValue(raw);
        if (Option.isNone(envelope)) return yield* new VaultError({ reason: "invalid-response" });
        value = Redacted.make(envelope.value.payload);
      }
      return { value, version: decoded.value.data.metadata.version };
    }),
    write: Effect.fn("OpenBaoStore.write")(function* (key, value, expectedVersion) {
      if (!validKey(key) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
        return yield* new VaultError({ reason: "invalid-input" });
      }
      const serialized = yield* encodeWrite({
        options: { cas: expectedVersion },
        data: yield* encodeValue({
          loomVaultEncoding: "json-v1",
          payload: Redacted.value(value),
        }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" }))),
      }).pipe(Effect.mapError(() => new VaultError({ reason: "invalid-input" })));
      const bytes = new TextEncoder().encode(serialized);
      if (bytes.length > 8 * 1024 * 1024) return yield* new VaultError({ reason: "invalid-input" });
      // A streaming body's inspection contains only its type and length, never secret JSON.
      const request = HttpClientRequest.post(`${origin}/v1/${mount}/data/${key}`).pipe(
        HttpClientRequest.setBody(
          HttpBody.stream(Stream.succeed(bytes), "application/json", bytes.length),
        ),
      );
      const response = yield* execute(request);
      if (response.status === 400) {
        const decoded = decodeError(yield* json(response));
        if (
          Option.isSome(decoded) &&
          decoded.value.errors.some((error) => error.includes("check-and-set"))
        ) {
          return yield* new VaultError({ reason: "conflict" });
        }
      }
      yield* check(response);
      const decoded = decodeWrite(yield* json(response));
      if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-response" });
      return decoded.value.data.version;
    }),
    keys: Effect.fn("OpenBaoStore.keys")(function* (prefix) {
      if (!validKey(prefix)) return yield* new VaultError({ reason: "invalid-input" });
      const response = yield* execute(
        HttpClientRequest.get(`${origin}/v1/${mount}/metadata/${prefix}`).pipe(
          HttpClientRequest.setUrlParam("list", "true"),
        ),
      );
      if (response.status === 404) return [];
      yield* check(response);
      const decoded = decodeKeys(yield* json(response));
      if (Option.isNone(decoded)) return yield* new VaultError({ reason: "invalid-response" });
      if (decoded.value.data.keys.some((key) => !/^[a-zA-Z0-9_-]+$/.test(key))) {
        return yield* new VaultError({ reason: "invalid-response" });
      }
      return decoded.value.data.keys;
    }),
  });
});
export const layer = Layer.effect(OpenBaoStore, make);
