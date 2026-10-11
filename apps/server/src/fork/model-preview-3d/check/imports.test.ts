// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import { expect, it } from "vite-plus/test";
const main = new Set([
  "report.ts",
  "printChecker.ts",
  "workerHost.ts",
  "readFiles.ts",
  "bench.ts",
  "coordinator.ts",
]);
it("keeps the worker dependency graph free of schemas and host runtime services", async () => {
  const directory = new URL("./", import.meta.url),
    files = (await NodeFSP.readdir(directory)).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !main.has(f),
    );
  const seen = new Set<string>();
  const inspect = async (url: URL): Promise<void> => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = await NodeFSP.readFile(url, "utf8");
    const runtime = [
      ...source.matchAll(/^(?:import|export)(?!\s+type\b)[^;]*?from\s+["']([^"']+)["'];/gm),
    ].map((m) => m[1]!);
    for (const specifier of runtime) {
      if (specifier === "node:worker_threads" && url.pathname.endsWith("/model-check-worker.ts"))
        continue;
      if (specifier === "@t3tools/contracts/fork/model-check-limits") {
        await inspect(
          new URL("../../../../../../packages/contracts/src/fork/model-check-limits.ts", directory),
        );
        continue;
      }
      expect(specifier, url.pathname).toMatch(/^\.\.?\/.*\.ts$/);
      const dependency = new URL(specifier, url);
      expect(main.has(dependency.pathname.split("/").at(-1)!), url.pathname).toBe(false);
      await inspect(dependency);
    }
  };
  for (const file of files) await inspect(new URL(file, directory));
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
