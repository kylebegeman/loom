// Benchmark artifacts are filesystem output from a test framework boundary.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { test } from "vite-plus/test";
import { measure, type BenchmarkCase, type BenchmarkMeasurement } from "./harness.ts";

// Timing is opt-in: regular tests must not assert hardware-dependent latency.
test.skipIf(process.env.LOOM_PERF_RUN !== "1")(
  "Loom performance workloads",
  async () => {
    const { pcbBenchmarks } = await import("./pcb.ts");
    const { modelBenchmarks } = await import("./model.ts");
    const { makeGraphBenchmarks } = await import("./graph.ts");
    const { makeLibraryBenchmarks } = await import("./library.ts");
    const library = await makeLibraryBenchmarks();
    const filter = process.env.LOOM_PERF_FILTER ?? "";
    const cases: BenchmarkCase[] = [
      ...pcbBenchmarks,
      ...modelBenchmarks,
      ...makeGraphBenchmarks(),
      ...library.cases,
    ].filter((benchmark) => benchmark.id.includes(filter));
    try {
      if (cases.length === 0) throw new Error(`No benchmark matches ${filter}`);
      if (new Set(cases.map((benchmark) => benchmark.id)).size !== cases.length)
        throw new Error("Benchmark IDs must be unique");
      const measurements: BenchmarkMeasurement[] = [];
      for (const benchmark of cases) {
        const measurement = await measure(benchmark, {
          samples: Number(process.env.LOOM_PERF_SAMPLES ?? 21),
          minTimeMs: Number(process.env.LOOM_PERF_MIN_TIME_MS ?? 250),
          warmupMs: 100,
        });
        measurements.push(measurement);
        process.stdout.write(
          `${measurement.id}: median ${measurement.medianMs.toFixed(3)} ms; p95 ${measurement.p95Ms.toFixed(3)} ms\n`,
        );
      }
      const output = process.env.LOOM_PERF_OUTPUT;
      if (!output) throw new Error("LOOM_PERF_OUTPUT is required");
      await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
      await NodeFSP.writeFile(output, JSON.stringify(measurements));
    } finally {
      await library.close();
    }
  },
  600_000,
);
