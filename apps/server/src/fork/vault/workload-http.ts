import {
  VaultError,
  VaultSshExecute,
  VaultWorkloadChallengeRequest,
  VaultWorkloadProof,
} from "@t3tools/contracts/fork";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
import * as VaultSsh from "./VaultSsh.ts";

const handler = (operation: "challenge" | "check" | "release" | "ssh-exec") =>
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
      const service = yield* VaultWorkloads.VaultWorkloads;
      const decode = <A, I>(schema: Schema.Codec<A, I>) =>
        Schema.decodeUnknownEffect(schema)(body).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
      const result =
        operation === "ssh-exec"
          ? yield* Effect.flatMap(VaultSsh.VaultSsh, (ssh) =>
              decode(VaultSshExecute).pipe(Effect.flatMap((input) => ssh.execute(input))),
            )
          : operation === "challenge"
            ? yield* service.challenge(yield* decode(VaultWorkloadChallengeRequest))
            : operation === "check"
              ? yield* service.check(yield* decode(VaultWorkloadProof))
              : yield* service.release(yield* decode(VaultWorkloadProof));
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
      VaultSshError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { reason: error.reason },
            {
              status:
                error.reason === "capacity"
                  ? 429
                  : error.reason === "invalid-operation" || error.reason === "invalid-key"
                    ? 400
                    : error.reason === "timeout"
                      ? 504
                      : 502,
              headers: { "cache-control": "no-store" },
            },
          ),
        ),
      VaultWorkloadError: (error) =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { reason: error.reason },
            {
              status:
                error.reason === "unavailable"
                  ? 503
                  : error.reason === "capacity"
                    ? 429
                    : error.reason === "host-offline"
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
export const VaultWorkloadHttpRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const route = (operation: "challenge" | "check" | "release" | "ssh-exec") =>
      HttpRouter.add(
        "POST",
        `/api/loom/vault-brokers/workloads/${operation}`,
        handler(operation).pipe(Effect.provideService(ForkRuntime, runtime)),
      );
    return Layer.mergeAll(route("challenge"), route("check"), route("release"), route("ssh-exec"));
  }),
);
