import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";
import { isNetworkPath } from "@t3tools/shared/path";

class StorageMeasurementOperationError extends Schema.TaggedError<StorageMeasurementOperationError>()(
  "StorageMeasurementOperationError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Storage Measurement operation failed.";
  }
}

// pnpm 11 writes this file as JSON, older versions as YAML.
const decodePnpmModulesManifest = Schema.decodeUnknownEffect(
  Schema.Struct({
    storeDir: Schema.String,
    virtualStoreDir: Schema.optional(Schema.String),
  }),
);

const sharedPnpmVirtualStore = Effect.fn("ProjectStorage.sharedPnpmVirtualStore")(
  function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const nodeModules = path.join(root, "node_modules");
    const text = yield* fs.readFileString(path.join(nodeModules, ".modules.yaml"));
    const manifest = yield* decodePnpmModulesManifest(
      yield* Effect.try({
        try: () => parseYaml(text),
        catch: (cause) => new StorageMeasurementOperationError({ cause }),
      }),
    );
    if (isNetworkPath(manifest.storeDir) || isNetworkPath(manifest.virtualStoreDir ?? ""))
      return null;
    const virtual = path.resolve(nodeModules, manifest.virtualStoreDir ?? ".pnpm");
    const [storeStat, virtualStat] = yield* Effect.all([
      fs.stat(manifest.storeDir),
      fs.stat(virtual),
    ]);
    return storeStat.dev === virtualStat.dev ? virtual : null;
  },
  Effect.orElseSucceed(() => null),
);

const STORAGE_ENTRY_LIMIT = 2_000_000;

/** Allocation estimates never follow links or cross a separately counted root. */
export const measureStoragePath = Effect.fn("ProjectStorage.measurePath")(
  function* (
    target: string,
    options: {
      readonly exclude?: ReadonlySet<string>;
      readonly seen?: Set<string>;
      readonly reclaimable?: boolean;
      readonly limit?: number;
    } = {},
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    if (isNetworkPath(target) || !path.isAbsolute(target) || path.dirname(target) === target)
      return null;
    const root = yield* fs.realPath(target);
    const skipped = options.reclaimable ? yield* sharedPnpmVirtualStore(root) : null;
    const pending = [root];
    const seen = options.seen ?? new Set<string>();
    let entries = 0;
    let bytes = 0;
    const limit = options.limit ?? STORAGE_ENTRY_LIMIT;
    while (pending.length > 0) {
      const inspected = yield* Effect.forEach(
        pending.splice(-8),
        // Untraced: this runs once per entry, and a tree can hold millions.
        Effect.fnUntraced(function* (current) {
          if (current === skipped || options.exclude?.has(current))
            return { current, counted: false, file: null, names: [] };
          const stat = yield* fs.lstat(current);
          if (stat.type === "SymbolicLink")
            return { current, counted: true, file: null, names: [] };
          if ((yield* fs.realPath(current)) !== current) return null;
          if (stat.type === "Directory")
            return { current, counted: true, file: null, names: yield* fs.readDirectory(current) };
          if (
            stat.type !== "File" ||
            (options.reclaimable && Option.getOrElse(stat.nlink, () => 1n) !== 1n)
          )
            return { current, counted: true, file: null, names: [] };
          return { current, counted: true, file: stat, names: [] };
        }),
        { concurrency: "unbounded" },
      );
      for (const result of inspected) {
        if (result === null) return null;
        if (!result.counted) continue;
        if (++entries > limit) return null;
        const stat = result.file;
        if (stat !== null) {
          const inode = Option.getOrNull(stat.ino);
          const key = inode === null ? result.current : `${stat.dev}:${inode}`;
          if (seen.has(key)) continue;
          seen.add(key);
          bytes += Option.match(stat.blocks, {
            onNone: () => Number(stat.size),
            onSome: (blocks) => Number(blocks * 512n),
          });
        }
        if (result.names.length + entries > limit) return null;
        for (const name of result.names) pending.push(path.join(result.current, name));
      }
    }
    return bytes;
  },
  Effect.timeout("30 seconds"),
  Effect.orElseSucceed(() => null),
);
