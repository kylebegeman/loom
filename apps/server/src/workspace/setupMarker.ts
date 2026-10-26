// @effect-diagnostics nodeBuiltinImport:off -- a synchronous digest keys state files without another service.
import * as NodeCrypto from "node:crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";

/** Loom metadata about a checkout lives in T3 home, never beside the checkout in a user folder. */
export type Services = ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path;

export const PENDING_CONTENTS = "Workspace setup must complete before starting the agent.\n";

export const digestPath = (canonical: string) =>
  NodeCrypto.createHash("sha256").update(canonical).digest("hex");

/** Resolves links through the nearest existing ancestor, so a path keeps its key before and after it exists. */
export const canonicalPath = Effect.fnUntraced(function* (target: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolved = path.resolve(target);
  const missing: Array<string> = [path.basename(resolved)];
  let ancestor = path.dirname(resolved);
  while (true) {
    const real = yield* fs.realPath(ancestor).pipe(Effect.option);
    if (Option.isSome(real)) return path.join(real.value, ...missing.toReversed());
    const parent = path.dirname(ancestor);
    if (parent === ancestor) return resolved;
    missing.push(path.basename(ancestor));
    ancestor = parent;
  }
});

/** The real T3 home, so paths built from it compare equal to their own realpath. */
export const stateDirectory = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  return yield* fs.realPath(stateDir).pipe(Effect.orElseSucceed(() => path.resolve(stateDir)));
});

export const markerPath = Effect.fnUntraced(function* (cwd: string) {
  const path = yield* Path.Path;
  return path.join(
    yield* stateDirectory(),
    "workspace-markers",
    digestPath(yield* canonicalPath(cwd)),
  );
});

/** Markers written before markers moved to T3 home. Read and cleared, never written. */
const legacyPath = Effect.fnUntraced(function* (cwd: string) {
  const path = yield* Path.Path;
  return `${path.resolve(cwd)}.t3-setup-pending`;
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
});

export const exists = Effect.fn("SetupMarker.exists")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.exists(yield* markerPath(cwd))) || (yield* fs.exists(yield* legacyPath(cwd)));
});

/** Contents of the current marker, falling back to a legacy sibling. */
export const read = Effect.fn("SetupMarker.read")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  for (const marker of [yield* markerPath(cwd), yield* legacyPath(cwd)])
    if (yield* fs.exists(marker)) return Option.some(yield* fs.readFileString(marker));
  return Option.none<string>();
});

export const clear = Effect.fn("SetupMarker.clear")(function* (cwd: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(yield* markerPath(cwd), { force: true });
  yield* fs.remove(yield* legacyPath(cwd), { force: true });
});
