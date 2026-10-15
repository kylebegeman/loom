import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as Ref from "effect/Ref";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerConfig from "../../../config.ts";
import * as Objects from "./LibraryObjectStore.ts";
const environment = {
  LOOM_ASSETS_BACKEND: "b2",
  LOOM_B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  LOOM_B2_REGION: "us-west-004",
  LOOM_B2_ASSET_BUCKET: "loom-assets-test",
  LOOM_B2_KEY_ID: "fixture-key",
  LOOM_B2_APPLICATION_KEY: "fixture-secret",
};
const bytes = new TextEncoder().encode("durable bytes");
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "b2-object-test-" })),
    Effect.provideService(HostProcess.Environment, environment),
    Effect.provide(NodeServices.layer),
  );
const fixture = Effect.fnUntraced(function* (
  putStatus: number,
  getStatus: number,
  storedBytes: Uint8Array,
) {
  const requests = yield* Ref.make<string[]>([]);
  const digest = yield* Objects.assetDigest(yield* Crypto.Crypto, bytes);
  const http = HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Ref.update(requests, (values) => [...values, request.method]);
      expect(new URL(request.url).pathname).toBe(
        `/loom-assets-test/objects/${digest.slice(0, 2)}/${digest}`,
      );
      expect(request.headers.authorization).toBeUndefined();
      return HttpClientResponse.fromWeb(
        request,
        new Response(request.method === "GET" ? storedBytes : null, {
          status: request.method === "GET" ? getStatus : putStatus,
        }),
      );
    }),
  );
  const store = yield* Objects.LibraryObjectStore.pipe(
    Effect.provide(Objects.layer),
    Effect.provideService(HttpClient.HttpClient, http),
  );
  return { store, requests, digest };
});
describe("private B2 durable object transport", () => {
  it.effect("acknowledges an upload only after fetching and hashing stored bytes", () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture(200, 200, bytes);
        yield* f.store.put(f.digest, bytes, "text/plain");
        expect(yield* Ref.get(f.requests)).toEqual(["PUT", "GET"]);
      }),
    ),
  );
  it.effect("rejects unavailable uploads and corrupt remote data", () =>
    run(
      Effect.gen(function* () {
        const failed = yield* fixture(503, 200, bytes);
        expect(
          (yield* failed.store.put(failed.digest, bytes, "text/plain").pipe(Effect.flip)).reason,
        ).toBe("io");
        expect(yield* Ref.get(failed.requests)).toEqual(["PUT"]);
        const damaged = yield* fixture(200, 200, new TextEncoder().encode("corrupted"));
        expect(
          (yield* damaged.store.put(damaged.digest, bytes, "text/plain").pipe(Effect.flip)).reason,
        ).toBe("invalid");
        const unavailable = yield* fixture(200, 404, bytes);
        expect((yield* unavailable.store.get(unavailable.digest).pipe(Effect.flip)).reason).toBe(
          "io",
        );
      }),
    ),
  );
  it.effect("rejects incomplete B2 configuration at construction", () =>
    run(
      Effect.gen(function* () {
        const http = HttpClient.make(() =>
          Effect.die("Invalid configuration must not make requests"),
        );
        const failure = yield* Objects.LibraryObjectStore.pipe(
          Effect.provide(Objects.layer),
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.provideService(HostProcess.Environment, { LOOM_ASSETS_BACKEND: "b2" }),
          Effect.flip,
        );
        expect(failure.reason).toBe("invalid");
      }),
    ),
  );
});
