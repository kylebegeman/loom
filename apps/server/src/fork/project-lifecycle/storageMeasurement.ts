import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";
import { isNetworkPath } from "@t3tools/shared/path";

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
    const manifest = yield* decodePnpmModulesManifest(yield* Effect.try(() => parseYaml(text)));
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

export const STORAGE_ENTRY_LIMIT = 2_000_000;

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
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (current === skipped || options.exclude?.has(current)) continue;
      if (++entries > (options.limit ?? STORAGE_ENTRY_LIMIT)) return null;
      const linked = yield* fs.readLink(current).pipe(
        Effect.as(true),
        Effect.catchIf(
          (error) =>
            error.cause instanceof Error && "code" in error.cause && error.cause.code === "EINVAL",
          () => Effect.succeed(false),
        ),
      );
      if (linked) continue;
      if ((yield* fs.realPath(current)) !== current) return null;
      const stat = yield* fs.stat(current);
      if (stat.type === "File") {
        if (options.reclaimable && Option.getOrElse(stat.nlink, () => 1n) !== 1n) continue;
        const inode = Option.getOrNull(stat.ino);
        const key = inode === null ? current : `${stat.dev}:${inode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        bytes += Option.match(stat.blocks, {
          onNone: () => Number(stat.size),
          onSome: (blocks) => Number(blocks * 512n),
        });
      } else if (stat.type === "Directory") {
        const names = yield* fs.readDirectory(current);
        if (names.length + entries > (options.limit ?? STORAGE_ENTRY_LIMIT)) return null;
        for (const name of names) pending.push(path.join(current, name));
      }
    }
    return bytes;
  },
  Effect.timeout("30 seconds"),
  Effect.orElseSucceed(() => null),
);
