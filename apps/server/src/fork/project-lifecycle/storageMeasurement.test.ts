import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { measureStoragePath } from "./storageMeasurement.ts";

describe("storage allocation measurement", () => {
  it.effect("deduplicates hardlinks and excludes nested ownership without following symlinks", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      yield* fs.makeDirectory(`${root}/nested`);
      yield* fs.writeFileString(`${root}/file`, "synthetic storage".repeat(1024));
      yield* fs.link(`${root}/file`, `${root}/linked`);
      yield* fs.writeFileString(`${root}/nested/file`, "other storage".repeat(1024));
      yield* fs.symlink(`${root}/nested`, `${root}/outside`);
      const seen = new Set<string>();
      const own = yield* measureStoragePath(root, { exclude: new Set([`${root}/nested`]), seen });
      const single = yield* measureStoragePath(`${root}/file`);
      expect(own).toBe(single);
      expect(own).toBeGreaterThan(0);
      expect(yield* measureStoragePath(`${root}/linked`, { seen })).toBe(0);
      expect(
        yield* measureStoragePath(root, {
          reclaimable: true,
          exclude: new Set([`${root}/nested`]),
        }),
      ).toBe(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("returns unknown for missing paths and a bounded walk", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      yield* fs.writeFileString(`${root}/one`, "one");
      yield* fs.writeFileString(`${root}/two`, "two");
      expect(yield* measureStoragePath(`${root}/missing`)).toBeNull();
      expect(yield* measureStoragePath(root, { limit: 1 })).toBeNull();
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
