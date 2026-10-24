import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";

/**
 * Every path in the legacy caches is also in the current one, and a build still using a legacy
 * file keeps it fresh, so a week without a write means no running build needs it. A build
 * downgraded after that rescans, and loses usage from transcripts already removed.
 */
export const LEGACY_SCAN_CACHE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Runs after the current cache saved, so a failed save never leaves usage with no cache. */
export const pruneLegacyUsageCaches = Effect.fn("UsageService.pruneLegacyScanCaches")(function* (
  fileSystem: FileSystem.FileSystem,
  path: Path.Path,
  stateDir: string,
  fileNames: ReadonlyArray<string>,
) {
  const cutoffMs = (yield* Clock.currentTimeMillis) - LEGACY_SCAN_CACHE_RETENTION_MS;
  for (const fileName of fileNames) {
    const filePath = path.join(stateDir, fileName);
    yield* fileSystem.stat(filePath).pipe(
      Effect.flatMap((info) =>
        Option.exists(info.mtime, (mtime) => mtime.getTime() < cutoffMs)
          ? fileSystem.remove(filePath)
          : Effect.void,
      ),
      Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not delete a legacy usage cache", { filePath, cause }),
      ),
    );
  }
});
