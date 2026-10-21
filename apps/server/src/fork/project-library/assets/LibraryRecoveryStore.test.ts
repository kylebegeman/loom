import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { HttpClient, HttpClientResponse, FetchHttpClient } from "effect/http";
import * as ServerConfig from "../../../config.ts";
import { layerMemory } from "../../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../../persistence/migrations.ts";
import { LibraryAssetMigrations } from "./migrations.ts";
import * as Recovery from "./LibraryRecoveryStore.ts";
const source = EnvironmentId.make("recovery-host");
const bytes = new TextEncoder().encode("archive with Git objects and project manifest");
const manifest = {
  version: 1 as const,
  projectId: "aspectavy",
  projectRevision: 1,
  copyId: "copy-ios",
  environmentId: source,
  title: "AspectAvy",
  rootBasename: "aspectavy",
  manifestFile: "loom-working-copy.json" as const,
};
const run = <A, E, R>(
  use: (store: Recovery.LibraryRecoveryStore["Service"], sha256: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(LibraryAssetMigrations);
    const store = yield* Recovery.LibraryRecoveryStore.pipe(
      Effect.provide(Recovery.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    );
    const sha256 = Hex.encode(yield* (yield* Crypto.Crypto).digest("SHA-256", bytes));
    return yield* use(store, sha256);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerMemory,
        ServerConfig.layerTest(process.cwd(), { prefix: "library-recovery-test-" }),
        Layer.succeed(HostProcess.Environment, {}),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );
const input = (sha256: string) => ({
  sourceEnvironmentId: source,
  copyId: manifest.copyId,
  sha256,
  byteLength: bytes.length,
  manifest,
  body: Stream.make(bytes.slice(0, 10), bytes.slice(10)),
});
describe("verified recovery archives", () => {
  it.effect("preserves streamed archive bytes and immutable recovery metadata", () =>
    run((store, sha256) =>
      Effect.gen(function* () {
        const saved = yield* store.put(input(sha256));
        expect(saved.sha256).toBe(sha256);
        const config = yield* ServerConfig.ServerConfig;
        const canonical = (yield* Path.Path).join(
          config.stateDir,
          "project-library",
          "recovery",
          sha256,
        );
        expect((yield* (yield* FileSystem.FileSystem).stat(canonical)).mode & 0o777).toBe(0o600);
        expect((yield* store.get(source, manifest.copyId, sha256)).manifest).toEqual(manifest);
        expect((yield* store.verify(source, manifest.copyId, sha256)).byteLength).toBe(
          bytes.length,
        );
        const conflict = yield* store
          .put({ ...input(sha256), manifest: { ...manifest, title: "Changed" } })
          .pipe(Effect.flip);
        expect(conflict.reason).toBe("request-conflict");
      }),
    ),
  );
  it.effect("rejects truncated, wrong digest and wrong source archives before acknowledgment", () =>
    run((store, sha256) =>
      Effect.gen(function* () {
        expect(
          (yield* store
            .put({ ...input(sha256), body: Stream.make(bytes.slice(0, 10)) })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
        expect((yield* store.put(input("0".repeat(64))).pipe(Effect.flip)).reason).toBe("invalid");
        expect(
          (yield* store
            .put({ ...input(sha256), sourceEnvironmentId: EnvironmentId.make("another-host") })
            .pipe(Effect.flip)).reason,
        ).toBe("invalid");
        expect((yield* store.get(source, manifest.copyId, sha256).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
      }),
    ),
  );
  it.effect("detects damaged recovery files before offering download", () =>
    run((store, sha256) =>
      Effect.gen(function* () {
        yield* store.put(input(sha256));
        const config = yield* ServerConfig.ServerConfig;
        yield* (yield* FileSystem.FileSystem).writeFileString(
          (yield* Path.Path).join(config.stateDir, "project-library", "recovery", sha256),
          "damaged",
        );
        expect((yield* store.get(source, manifest.copyId, sha256).pipe(Effect.flip)).reason).toBe(
          "invalid",
        );
      }),
    ),
  );
});

it.effect("verifies B2 streamed readback before registering a recovery receipt", () =>
  run((_, sha256) =>
    Effect.gen(function* () {
      const environment = {
        LOOM_ASSETS_BACKEND: "b2",
        LOOM_B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
        LOOM_B2_REGION: "us-west-004",
        LOOM_B2_ASSET_BUCKET: "fixture-recovery",
        LOOM_B2_KEY_ID: "fixture-key",
        LOOM_B2_APPLICATION_KEY: "fixture-secret",
      };
      let corrupt = false;
      const methods: string[] = [];
      const http = HttpClient.make((request) =>
        Effect.gen(function* () {
          methods.push(request.method);
          if (request.method === "PUT") {
            expect(request.body._tag).toBe("Stream");
            if (request.body._tag === "Stream")
              yield* request.body.stream.pipe(Stream.runDrain, Effect.orDie);
          }
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              request.method === "GET"
                ? corrupt
                  ? new TextEncoder().encode("damaged")
                  : bytes
                : null,
            ),
          );
        }),
      );
      const store = yield* Recovery.LibraryRecoveryStore.pipe(
        Effect.provide(Recovery.layer),
        Effect.provideService(HostProcess.Environment, environment),
        Effect.provideService(HttpClient.HttpClient, http),
      );
      yield* store.put(input(sha256));
      expect(methods).toEqual(["PUT", "GET"]);
      corrupt = true;
      expect((yield* store.verify(source, manifest.copyId, sha256).pipe(Effect.flip)).reason).toBe(
        "invalid",
      );
      expect(
        (yield* store
          .put({
            ...input(sha256),
            copyId: "damaged-copy",
            manifest: { ...manifest, copyId: "damaged-copy" },
          })
          .pipe(Effect.flip)).reason,
      ).toBe("invalid");
      expect((yield* store.get(source, "damaged-copy", sha256).pipe(Effect.flip)).reason).toBe(
        "not-found",
      );
    }),
  ),
);
