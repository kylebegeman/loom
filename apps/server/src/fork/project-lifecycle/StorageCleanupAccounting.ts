import type { AdditionalStorageCleanupEntry } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { measureStoragePath } from "./storageMeasurement.ts";

export class StorageCleanupAccounting extends Context.Service<
  StorageCleanupAccounting,
  {
    readonly record: (
      input: Pick<AdditionalStorageCleanupEntry, "id" | "kind" | "path" | "bytes" | "reason">,
    ) => Effect.Effect<void>;
    readonly history: Effect.Effect<{
      readonly revision: number;
      readonly entries: ReadonlyArray<AdditionalStorageCleanupEntry>;
    }>;
  }
>()("t3/fork/project-lifecycle/StorageCleanupAccounting") {}

export const layer = Layer.sync(StorageCleanupAccounting, () => {
  const entries = new Map<string, AdditionalStorageCleanupEntry>();
  let revision = 0;
  return StorageCleanupAccounting.of({
    record: Effect.fn("StorageCleanupAccounting.record")(function* (input) {
      if (entries.has(input.id)) return;
      const at = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
      entries.set(input.id, {
        ...input,
        at,
        outcome: "removed",
        projectPath: null,
        threadId: null,
        threadTitle: null,
        files: null,
      });
      if (entries.size > 200) entries.delete(entries.keys().next().value!);
      revision++;
    }),
    history: Effect.sync(() => ({ revision, entries: [...entries.values()].reverse() })),
  });
});

/** Called inside the owner's removal lock, including any archive it creates or retains. */
export const accountStorageRemoval = Effect.fn("StorageCleanupAccounting.remove")(function* <
  A,
  E,
  R,
>(
  input: {
    readonly id: string;
    readonly kind: "library-copy" | "git-mirror";
    readonly path: string;
    readonly reason: string;
    readonly paths: () => Effect.Effect<ReadonlyArray<string>>;
  },
  operation: Effect.Effect<A, E, R>,
) {
  const accounting = yield* Effect.serviceOption(StorageCleanupAccounting);
  if (Option.isNone(accounting)) return yield* operation;
  const fs = yield* FileSystem.FileSystem;
  const measure = Effect.fn("StorageCleanupAccounting.measure")(
    function* () {
      const present: string[] = [];
      let bytes: number | null = 0;
      for (const target of new Set(yield* input.paths())) {
        if (!(yield* fs.exists(target))) continue;
        present.push(target);
        const size = yield* measureStoragePath(target, { reclaimable: true });
        bytes = bytes === null || size === null ? null : bytes + size;
      }
      return { bytes, present };
    },
    Effect.orElseSucceed(() => ({ bytes: null, present: [] as string[] })),
  );
  const before = yield* measure();
  const result = yield* operation;
  const after = yield* measure();
  if (before.present.some((target) => !after.present.includes(target))) {
    const bytes =
      before.bytes === null || after.bytes === null
        ? null
        : Math.max(0, before.bytes - after.bytes);
    if (bytes === null || bytes > 0)
      yield* accounting.value.record({
        ...input,
        id: `${input.id}:${before.present.join("\0")}`,
        bytes,
      });
  }
  return result;
});

export const makeStorageRemovalRecorder = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const accounting = yield* Effect.serviceOption(StorageCleanupAccounting);
  return <A, E, R>(
    input: Parameters<typeof accountStorageRemoval<A, E, R>>[0],
    operation: Effect.Effect<A, E, R>,
  ) =>
    Option.isNone(accounting)
      ? operation
      : accountStorageRemoval(input, operation).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.provideService(StorageCleanupAccounting, accounting.value),
        );
});
