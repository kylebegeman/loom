import {
  VaultError,
  VaultBrokerError,
  VaultWorkloadError,
  VaultSshError,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

type Failure = VaultError | VaultBrokerError | VaultWorkloadError | VaultSshError;
type Operation =
  | "claim"
  | "challenge"
  | "heartbeat"
  | "workloads/challenge"
  | "workloads/ssh-exec"
  | "workloads/check"
  | "workloads/release";
export const brokerOrigin = (input: string) => {
  try {
    const url = new URL(input),
      loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" || (url.protocol === "http:" && loopback))
      ? url.origin
      : null;
  } catch {
    return null;
  }
};
export class BrokerHttpClient extends Context.Service<
  BrokerHttpClient,
  {
    readonly post: <A, I>(
      origin: string,
      operation: Operation,
      input: unknown,
      schema: Schema.Codec<A, I>,
    ) => Effect.Effect<A, Failure>;
  }
>()("t3/fork/vault/BrokerHttpClient") {}
const encodeBody = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeBrokerFailure = Schema.decodeUnknownOption(
  Schema.Struct({ reason: VaultBrokerError.fields.reason }),
);
const decodeWorkloadFailure = Schema.decodeUnknownOption(
  Schema.Struct({ reason: VaultWorkloadError.fields.reason }),
);
const decodeVaultFailure = Schema.decodeUnknownOption(
  Schema.Struct({ reason: VaultError.fields.reason }),
);
const decodeSshFailure = Schema.decodeUnknownOption(
  Schema.Struct({ reason: VaultSshError.fields.reason }),
);
const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  return BrokerHttpClient.of({
    post: Effect.fnUntraced(function* <A, I>(
      origin: string,
      operation: Operation,
      input: unknown,
      schema: Schema.Codec<A, I>,
    ) {
      if (!brokerOrigin(origin)) return yield* new VaultBrokerError({ reason: "configuration" });
      const body = yield* encodeBody(input).pipe(
        Effect.mapError(() => new VaultBrokerError({ reason: "configuration" })),
      );
      const response = yield* http
        .execute(
          HttpClientRequest.post(`${origin}/api/loom/vault-brokers/${operation}`).pipe(
            HttpClientRequest.bodyText(body, "application/json"),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.timeout("15 seconds"),
          Effect.mapError(() => new VaultBrokerError({ reason: "unavailable" })),
        );
      const value = yield* response.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(16)),
        Effect.timeout("15 seconds"),
        Effect.mapError(() => new VaultBrokerError({ reason: "unavailable" })),
      );
      if (response.status !== 200) {
        if (operation === "workloads/ssh-exec") {
          const ssh = decodeSshFailure(value);
          if (Option.isSome(ssh)) return yield* new VaultSshError(ssh.value);
        }
        if (operation.startsWith("workloads/")) {
          const workload = decodeWorkloadFailure(value);
          if (Option.isSome(workload)) return yield* new VaultWorkloadError(workload.value);
        }
        const broker = decodeBrokerFailure(value);
        if (Option.isSome(broker)) return yield* new VaultBrokerError(broker.value);
        const vault = decodeVaultFailure(value);
        if (Option.isSome(vault)) return yield* new VaultError(vault.value);
        return yield* new VaultBrokerError({ reason: "unavailable" });
      }
      return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
        Effect.mapError(() => new VaultBrokerError({ reason: "invalid-proof" })),
      );
    }),
  });
});
export const layer = Layer.effect(BrokerHttpClient, make);
