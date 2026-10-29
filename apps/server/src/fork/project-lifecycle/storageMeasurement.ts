import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

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
    const root = yield* fs.realPath(target);
    const pending = [root];
    const seen = options.seen ?? new Set<string>();
    let entries = 0;
    let bytes = 0;
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (options.exclude?.has(current)) continue;
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
