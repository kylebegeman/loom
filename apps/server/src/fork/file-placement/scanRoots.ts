import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

export const resolveScannerExclusionRoots = Effect.fn("AgentSessionScanner.resolveExclusionRoots")(
  function* (roots: ReadonlyArray<string>) {
    const fileSystem = yield* FileSystem.FileSystem;
    const resolved = yield* Effect.forEach(
      roots,
      (root) => fileSystem.realPath(root).pipe(Effect.orElseSucceed(() => root)),
      { concurrency: 4 },
    );
    return [...new Set([...roots, ...resolved])];
  },
);
