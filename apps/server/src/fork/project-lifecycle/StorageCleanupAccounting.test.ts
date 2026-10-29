import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import {
  accountStorageRemoval,
  StorageCleanupAccounting,
  layer,
} from "./StorageCleanupAccounting.ts";

describe("confirmed storage cleanup accounting", () => {
  it.effect("counts only confirmed removals and subtracts retained recovery files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped().pipe(Effect.flatMap(fs.realPath));
      const target = `${root}/copy`,
        archive = `${root}/archive`;
      yield* fs.writeFileString(target, "synthetic storage".repeat(8192));
      const input = {
        id: "release",
        kind: "library-copy" as const,
        path: target,
        reason: "Released",
        paths: () => Effect.succeed([target, archive]),
      };
      yield* Effect.result(accountStorageRemoval(input, Effect.fail("blocked")));
      const account = yield* StorageCleanupAccounting;
      expect((yield* account.history).entries).toHaveLength(0);
      yield* accountStorageRemoval(
        input,
        fs.writeFileString(archive, "recovery").pipe(Effect.andThen(fs.remove(target))),
      );
      const first = yield* account.history;
      expect(first.entries).toHaveLength(1);
      expect(first.entries[0]?.bytes).toBeGreaterThan(0);
      yield* accountStorageRemoval(input, Effect.void);
      expect((yield* account.history).entries).toEqual(first.entries);
      yield* accountStorageRemoval(input, fs.remove(archive));
      expect((yield* account.history).entries).toHaveLength(2);
      yield* fs.writeFileString(target, "partial deletion".repeat(1024));
      yield* Effect.result(
        accountStorageRemoval(
          { ...input, id: "partial" },
          fs.remove(target).pipe(Effect.andThen(Effect.fail("receipt failed"))),
        ),
      );
      expect((yield* account.history).entries[0]).toMatchObject({
        kind: "library-copy",
        outcome: "failed",
      });
      expect((yield* account.history).entries[0]?.bytes).toBeGreaterThan(0);
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(layer, NodeServices.layer))),
  );
});
