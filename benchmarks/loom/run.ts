// This standalone benchmark CLI owns process execution, artifacts and wall-clock metadata.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { BenchmarkMeasurement } from "./harness.ts";
import { readBaseline, summarizeSweeps } from "./report.ts";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const { values } = NodeUtil.parseArgs({
  options: {
    output: { type: "string" },
    baseline: { type: "string" },
    sweeps: { type: "string", default: "3" },
    samples: { type: "string", default: "21" },
    "min-time-ms": { type: "string", default: "250" },
    filter: { type: "string", default: "" },
    check: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  process.stdout.write(
    `Usage: node benchmarks/loom/run.ts --output .t3/benchmarks/baseline.json\n       node benchmarks/loom/run.ts --output .t3/benchmarks/after.json --baseline .t3/benchmarks/baseline.json [--check]\nOptions: --sweeps 3 --samples 21 --min-time-ms 250 --filter pcb.\n--check requires a matching baseline and >=20% lower median on each target,\nwith <=15% regression on other workloads. Timing gates are opt-in.\n`,
  );
  process.exit(0);
}
if (!values.output) throw new Error("--output is required; see --help");
if (values.check && !values.baseline) throw new Error("--check requires --baseline");
const positiveInteger = (label: string, value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${label} must be a positive integer`);
  return parsed;
};
const sweepCount = positiveInteger("sweeps", values.sweeps);
const samples = positiveInteger("samples", values.samples);
const minTimeMs = positiveInteger("min-time-ms", values["min-time-ms"]);
const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const metadata = {
  capturedAt: new Date().toISOString(),
  revision: git("rev-parse", "HEAD"),
  dirtyFiles: git("status", "--porcelain").split("\n").filter(Boolean),
  node: process.version,
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The benchmark CLI records actual host metadata to reject incompatible comparisons.
  platform: NodeOS.platform(),
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The benchmark CLI records actual host metadata to reject incompatible comparisons.
  arch: NodeOS.arch(),
  cpu: NodeOS.cpus()[0]?.model ?? "unknown",
  logicalCpus: NodeOS.cpus().length,
  memoryBytes: NodeOS.totalmem(),
};
const baseline = values.baseline
  ? readBaseline(
      JSON.parse(await NodeFSP.readFile(NodePath.resolve(values.baseline), "utf8")),
      metadata,
    )
  : null;
const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-benchmark-"));
const sweeps: BenchmarkMeasurement[][] = [];
try {
  for (let sweep = 0; sweep < sweepCount; sweep++) {
    process.stdout.write(`Sweep ${sweep + 1}/${sweepCount}\n`);
    const output = NodePath.join(scratch, `${sweep}.json`);
    const result = NodeChildProcess.spawnSync(
      NodePath.join(root, "node_modules/.bin/vp"),
      [
        "test",
        "run",
        "benchmarks/loom/benchmarks.test.ts",
        "--no-file-parallelism",
        "--maxWorkers",
        "1",
      ],
      {
        cwd: root,
        stdio: "inherit",
        env: {
          ...process.env,
          LOOM_PERF_RUN: "1",
          LOOM_PERF_OUTPUT: output,
          LOOM_PERF_FILTER: values.filter,
          LOOM_PERF_SAMPLES: String(samples),
          LOOM_PERF_MIN_TIME_MS: String(minTimeMs),
        },
      },
    );
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Sweep ${sweep + 1} failed (${result.status ?? result.signal})`);
    sweeps.push(JSON.parse(await NodeFSP.readFile(output, "utf8")) as BenchmarkMeasurement[]);
  }
} finally {
  await NodeFSP.rm(scratch, { recursive: true, force: true });
}

const measurements = summarizeSweeps(sweeps, baseline, values.filter !== "");
const report = {
  schemaVersion: 1 as const,
  metadata,
  options: { sweeps: sweepCount, samples, minTimeMs, filter: values.filter },
  measurements,
  sweeps,
};
const output = NodePath.resolve(values.output);
await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
await NodeFSP.writeFile(output, JSON.stringify(report, null, 2) + "\n");
for (const item of measurements) {
  const comparison =
    item.reductionPct === null
      ? ""
      : `; ${item.reductionPct.toFixed(1)}% lower${item.passed ? "" : " (below goal)"}`;
  process.stdout.write(
    `${item.id}: ${item.medianMs.toFixed(3)} ms median, ${item.p95Ms.toFixed(3)} ms p95${comparison}\n`,
  );
}
process.stdout.write(`Saved ${output}\n`);
if (values.check && measurements.some((item) => item.passed === false)) process.exitCode = 1;
