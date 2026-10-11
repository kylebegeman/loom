// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import { expect, it } from "vite-plus/test";
const main = new Set(["report.ts", "printChecker.ts", "workerHost.ts", "readFiles.ts", "bench.ts"]);
it("keeps worker modules free of runtime dependencies outside their pure siblings", async () => {
  const directory = new URL("./", import.meta.url),
    files = (await NodeFSP.readdir(directory)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !main.has(f),
    );
  for (const file of files) {
    const source = await NodeFSP.readFile(new URL(file, directory), "utf8");
    const runtime = [
      ...source.matchAll(/^import(?!\s+type\b)[^;]*?from\s+["']([^"']+)["'];/gm),
    ].map((m) => m[1]!);
    expect(
      runtime.filter(
        (path) =>
          !/^\.\/[^/]+\.ts$/.test(path) &&
          !(file === "model-check-worker.ts" && path === "node:worker_threads"),
      ),
      file,
    ).toEqual([]);
  }
  for (const file of ["printChecker.ts", "workerHost.ts"]) {
    const source = await NodeFSP.readFile(new URL(file, directory), "utf8");
    expect(
      [
        ...source.matchAll(
          /^import(?!\s+type\b)[^;]*?from\s+["']\.\/(mesh|topology|grid|printChecks|readStl|readObj|read3mf|readGltf|protocol)\.ts["'];/gm,
        ),
      ],
      file,
    ).toEqual([]);
  }
});
