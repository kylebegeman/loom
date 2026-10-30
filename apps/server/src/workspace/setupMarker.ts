// @effect-diagnostics nodeBuiltinImport:off -- a synchronous digest keys state files, and only the native realpath reports on-disk spelling.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import { resolveBaseDir } from "../os-jank.ts";

/** Loom metadata about a checkout lives in T3 home, never beside the checkout in a user folder. */
export type Services = ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path;

export const PENDING_CONTENTS = "Workspace setup must complete before starting the agent.\n";

export const digestPath = (canonical: string) =>
  NodeCrypto.createHash("sha256").update(canonical).digest("hex");

// Effect's realPath keeps the requested letter case and Unicode form on case-insensitive volumes.
const onDiskSpelling = (real: string) =>
  Effect.tryPromise(() => NodeFSP.realpath(real)).pipe(Effect.orElseSucceed(() => real));

/**
 * Resolves links and on-disk spelling through the nearest existing ancestor, so a path keeps its
 * key before and after it exists, whichever case or Unicode form names it. A link at the path
 * itself stays unresolved, so callers can still refuse it.
 */
export const canonicalPath = Effect.fnUntraced(function* (target: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolved = path.resolve(target);
  const entry = yield* Effect.tryPromise(() => NodeFSP.lstat(resolved)).pipe(Effect.option);
  if (Option.isSome(entry) && !entry.value.isSymbolicLink()) {
    const real = yield* fs.realPath(resolved).pipe(Effect.option);
    if (Option.isSome(real)) return yield* onDiskSpelling(real.value);
  }
  const missing: Array<string> = [path.basename(resolved)];
  let ancestor = path.dirname(resolved);
  while (true) {
    const real = yield* fs.realPath(ancestor).pipe(Effect.option);
    if (Option.isSome(real))
      return path.join(yield* onDiskSpelling(real.value), ...missing.toReversed());
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return resolved;
    missing.push(path.basename(ancestor));
    ancestor = parent;
  }
});

/** Compares canonical paths; macOS and Windows volumes ignore case and Unicode form by default. */
export const foldsPathCase = (platform: NodeJS.Platform) =>
  platform === "darwin" || platform === "win32";

export const pathKey = (platform: NodeJS.Platform) => (canonical: string) =>
  foldsPathCase(platform) ? canonical.normalize("NFC").toLowerCase() : canonical;

/** The real T3 home, so paths built from it compare equal to their own realpath. */
export const stateDirectory = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  return yield* fs.realPath(stateDir).pipe(Effect.orElseSucceed(() => path.resolve(stateDir)));
});

/**
 * Legacy sidecars beside a checkout name no owner. Only the default install, which wrote them,
 * may migrate or delete them; a dev or test home seeded from its projects only reads them.
 */
export const ownsLegacyMetadata = Effect.fnUntraced(function* () {
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const install = yield* ServerConfig.deriveServerPaths(
    yield* resolveBaseDir(undefined),
    undefined,
  );
  const key = pathKey(yield* HostProcess.Platform);
  return key(yield* canonicalPath(stateDir)) === key(yield* canonicalPath(install.stateDir));
});

export const markerPath = Effect.fnUntraced(function* (cwd: string) {
  const path = yield* Path.Path;
  return path.join(
    yield* stateDirectory(),
    "workspace-markers",
    digestPath(yield* canonicalPath(cwd)),
  );
});

export const LEGACY_SUFFIX = ".t3-setup-pending";

/** Markers written before markers moved to T3 home. Read and cleared, never written. */
const legacyPath = Effect.fnUntraced(function* (cwd: string) {
  const path = yield* Path.Path;
  return `${path.resolve(cwd)}${LEGACY_SUFFIX}`;
});

const removeOwnedLegacy = Effect.fnUntraced(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  if (yield* ownsLegacyMetadata()) yield* fs.remove(yield* legacyPath(cwd), { force: true });
});

export const write = Effect.fn("SetupMarker.write")(function* (
  cwd: string,
  contents: string = PENDING_CONTENTS,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const marker = yield* markerPath(cwd);
  yield* fs.makeDirectory(path.dirname(marker), { recursive: true, mode: 0o700 });
  yield* fs.writeFileString(marker, contents, { mode: 0o600 });
  // The current marker supersedes the sibling, so a later read cannot fall back to stale recovery.
  yield* removeOwnedLegacy(cwd);
});

/** Counts another install's legacy marker too, so cleanup keeps a folder whose setup is unfinished. */
export const exists = Effect.fn("SetupMarker.exists")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(yield* markerPath(cwd))) || (yield* fs.exists(yield* legacyPath(cwd)));
});

/** Contents of the current marker, falling back to a legacy sibling this install owns. */
export const read = Effect.fn("SetupMarker.read")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  const markers = [yield* markerPath(cwd)];
  if (yield* ownsLegacyMetadata()) markers.push(yield* legacyPath(cwd));
  for (const marker of markers)
    if (yield* fs.exists(marker)) return Option.some(yield* fs.readFileString(marker));
  return Option.none<string>();
});

export const clear = Effect.fn("SetupMarker.clear")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(yield* markerPath(cwd), { force: true });
  yield* removeOwnedLegacy(cwd);
});
