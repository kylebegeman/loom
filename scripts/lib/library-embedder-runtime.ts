/**
 * Semantic search's runtime (apps/server/src/fork/project-library/LibraryEmbedder.ts), loaded through
 * `createRequire` so the bundle leaves it alone. Only Libraries load it, and they run the Linux
 * archive, so only that archive stages it; WebAssembly and JavaScript serve every Linux platform.
 */
export const LIBRARY_EMBEDDER_RUNTIME_PACKAGE = "onnxruntime-web";

/**
 * The Node entry point and the one WebAssembly build it loads. The rest of the package (139 MB)
 * is browser builds, sourcemaps, and TypeScript sources.
 */
export const LIBRARY_EMBEDDER_RUNTIME_FILES = [
  "package.json",
  "dist/ort.node.min.js",
  "dist/ort-wasm-simd-threaded.mjs",
  "dist/ort-wasm-simd-threaded.wasm",
] as const;

/** The embedder runtime as a stage dependency, at the server's pinned version, for `platform`. */
export function selectLibraryEmbedderRuntimeDependencies(
  platform: "mac" | "linux" | "win",
  serverDependencies: Readonly<Record<string, string>>,
): Record<string, string> {
  const version = serverDependencies[LIBRARY_EMBEDDER_RUNTIME_PACKAGE];
  return platform === "linux" && version !== undefined
    ? { [LIBRARY_EMBEDDER_RUNTIME_PACKAGE]: version }
    : {};
}

/**
 * What to remove from the installed package, given every path below it (as
 * `FileSystem.readDirectory(dir, { recursive: true })` lists them, with `/` separators). Keeps the
 * runtime files and the directories that hold them, and names a removed directory once, not its contents.
 */
export function libraryEmbedderRuntimeRemovals(
  paths: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const isKept = (path: string) =>
    LIBRARY_EMBEDDER_RUNTIME_FILES.some((kept) => kept === path || kept.startsWith(`${path}/`));
  const removals = paths.filter((path) => !isKept(path)).sort();
  return removals.filter(
    (path) => !removals.some((other) => other !== path && path.startsWith(`${other}/`)),
  );
}
