import { assert, describe, it } from "@effect/vitest";

import serverPackageJson from "../../apps/server/package.json" with { type: "json" };

import { selectCliRuntimeExternalDependencies } from "./cli-external-packages.ts";
import {
  LIBRARY_EMBEDDER_RUNTIME_PACKAGE,
  libraryEmbedderRuntimeRemovals,
  selectLibraryEmbedderRuntimeDependencies,
} from "./library-embedder-runtime.ts";

describe("selectLibraryEmbedderRuntimeDependencies", () => {
  it("stages the server's pinned runtime in the Linux archive only", () => {
    const version = serverPackageJson.dependencies[LIBRARY_EMBEDDER_RUNTIME_PACKAGE];
    assert.isString(version);
    assert.deepStrictEqual(
      selectLibraryEmbedderRuntimeDependencies("linux", serverPackageJson.dependencies),
      { [LIBRARY_EMBEDDER_RUNTIME_PACKAGE]: version },
    );
    assert.deepStrictEqual(
      selectLibraryEmbedderRuntimeDependencies("mac", serverPackageJson.dependencies),
      {},
    );
    assert.deepStrictEqual(
      selectLibraryEmbedderRuntimeDependencies("win", serverPackageJson.dependencies),
      {},
    );
  });

  it("stays out of the runtime externals the desktop app ships", () => {
    assert.notProperty(
      selectCliRuntimeExternalDependencies(serverPackageJson.dependencies),
      LIBRARY_EMBEDDER_RUNTIME_PACKAGE,
    );
  });
});

describe("libraryEmbedderRuntimeRemovals", () => {
  it("keeps the Node entry and its WebAssembly build, and removes each other tree once", () => {
    const listed = [
      "README.md",
      "dist",
      "dist/ort.all.min.js",
      "dist/ort-wasm-simd-threaded.jsep.wasm",
      "dist/ort-wasm-simd-threaded.mjs",
      "dist/ort-wasm-simd-threaded.wasm",
      "dist/ort.node.min.js",
      "dist/ort.node.min.js.map",
      "docs",
      "lib",
      "lib/index.ts",
      "lib/wasm",
      "lib/wasm/proxy.ts",
      "package.json",
      "types.d.ts",
    ];
    assert.deepStrictEqual(libraryEmbedderRuntimeRemovals(listed), [
      "README.md",
      "dist/ort-wasm-simd-threaded.jsep.wasm",
      "dist/ort.all.min.js",
      "dist/ort.node.min.js.map",
      "docs",
      "lib",
      "types.d.ts",
    ]);
  });
});
