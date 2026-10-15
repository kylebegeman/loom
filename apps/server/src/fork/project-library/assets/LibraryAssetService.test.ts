import { it, expect } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { FetchHttpClient } from "effect/http";
import * as ServerConfig from "../../../config.ts";
import { layerMemory } from "../../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../../persistence/migrations.ts";
import { LibraryAssetMigrations } from "./migrations.ts";
import * as Assets from "./LibraryAssetService.ts";
const source = EnvironmentId.make("asset-source-host");
const input = {
  sourceEnvironmentId: source,
  attachmentId: "attachment-1",
  filename: "example.txt",
  contentType: "text/plain",
  bytes: new TextEncoder().encode("saved conversation asset"),
};
const layer = Assets.layer.pipe(Layer.provide(FetchHttpClient.layer));
const withAssets = <A, E, R>(
  use: (service: Assets.LibraryAssetService["Service"]) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(LibraryAssetMigrations);
    const assets = yield* Assets.LibraryAssetService.pipe(Effect.provide(layer));
    return yield* use(assets);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        layerMemory,
        ServerConfig.layerTest(process.cwd(), { prefix: "library-assets-test-" }),
        Layer.succeed(HostProcess.Environment, { LOOM_ASSETS_BACKEND: "local" }),
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );
it.effect("preserves bytes and makes retrying an upload idempotent", () =>
  withAssets((assets) =>
    Effect.gen(function* () {
      const first = yield* assets.put(input);
      const retried = yield* assets.put(input);
      expect(retried).toEqual(first);
      expect(first.bytes).toBe(input.bytes.length);
      expect(Array.from(yield* assets.read(first))).toEqual(Array.from(input.bytes));
      expect(yield* assets.find(source, input.attachmentId)).toEqual(first);
    }),
  ),
);
it.effect("rejects replacing an attachment ID with different bytes", () =>
  withAssets((assets) =>
    Effect.gen(function* () {
      const first = yield* assets.put(input);
      const failure = yield* assets
        .put({ ...input, bytes: new TextEncoder().encode("replacement") })
        .pipe(Effect.flip);
      expect(failure.reason).toBe("request-conflict");
      expect(Array.from(yield* assets.read(first))).toEqual(Array.from(input.bytes));
    }),
  ),
);
it.effect("detects damaged stored bytes before serving them", () =>
  withAssets((assets) =>
    Effect.gen(function* () {
      const first = yield* assets.put(input);
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      yield* fs.writeFileString(
        path.join(config.stateDir, "project-library", "objects", first.digest),
        "damaged",
      );
      const failure = yield* assets.read(first).pipe(Effect.flip);
      expect(failure.reason).toBe("invalid");
    }),
  ),
);
