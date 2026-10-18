import {
  VaultError,
  VaultBrokerClaim,
  VaultBrokerChallengeRequest,
  VaultBrokerHeartbeat,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultBrokers from "./VaultBrokers.ts";

const handler = (operation: "claim" | "challenge" | "heartbeat") =>
  withForkRuntime(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json")
        return HttpServerResponse.empty({ status: 415 });
      const length = request.headers["content-length"];
      if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > 16_384))
        return HttpServerResponse.empty({ status: 413 });
      const body = yield* request.json.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(16)),
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      );
      const service = yield* VaultBrokers.VaultBrokers;
      const decode = <A, I>(schema: Schema.Codec<A, I>) =>
        Schema.decodeUnknownEffect(schema)(body).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
      const result =
        operation === "claim"
          ? yield* service.claim(yield* decode(VaultBrokerClaim))
          : operation === "challenge"
            ? yield* service.challenge(yield* decode(VaultBrokerChallengeRequest))
            : yield* service.heartbeat(yield* decode(VaultBrokerHeartbeat));
      return HttpServerResponse.jsonUnsafe(result, { headers: { "cache-control": "no-store" } });
    }),
  ).pipe(
    Effect.catchTags({
      VaultError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { reason: error.reason },
            {
              status:
                error.reason === "invalid-input"
                  ? 400
                  : error.reason === "denied"
                    ? 403
                    : error.reason === "conflict"
                      ? 409
                      : 503,
              headers: { "cache-control": "no-store" },
            },
          ),
        ),
      VaultBrokerError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { reason: error.reason },
            {
              status:
                error.reason === "capacity"
                  ? 429
                  : error.reason === "approval-pending"
                    ? 409
                    : error.reason === "expired"
                      ? 410
                      : 403,
              headers: { "cache-control": "no-store" },
            },
          ),
        ),
    }),
  );
export const VaultBrokerHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const route = (operation: "claim" | "challenge" | "heartbeat") =>
      HttpRouter.add(
        "POST",
        `/api/loom/vault-brokers/${operation}`,
        handler(operation).pipe(Effect.provideService(ForkRuntime, runtime)),
      );
    return Layer.mergeAll(route("claim"), route("challenge"), route("heartbeat"));
  }),
);
