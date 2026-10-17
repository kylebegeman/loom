// This standalone benchmark CLI owns process execution, artifacts and wall-clock metadata.
// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";
import type { BenchmarkMeasurement } from "./harness.ts";
import { readBaseline, summarizePairedSweeps, summarizeSweeps } from "./report.ts";
import { currentSourceDigests, resolveSourceReference } from "./sourceReference.ts";

const root = NodeURL.fileURLToPath(new URL("../../", import.meta.url));
const { values } = NodeUtil.parseArgs({
  options: {
    output: { type: "string" },
    baseline: { type: "string" },
    "compare-ref": { type: "string" },
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
    `Usage: node benchmarks/loom/run.ts --output .t3/benchmarks/baseline.json\n       node benchmarks/loom/run.ts --output .t3/benchmarks/after.json --baseline .t3/benchmarks/baseline.json [--check]\n       node benchmarks/loom/run.ts --output .t3/benchmarks/paired.json --compare-ref <commit> [--check]\nOptions: --sweeps 3 --samples 21 --min-time-ms 250 --filter pcb.\n--compare-ref alternates original/current source in fresh processes and also\nwrites a sibling <name>.reference.json report. Shared runtime dependencies must be unchanged.\n--check requires a matching baseline and >=20% lower median on each target,\nwith <=15% regression on other workloads. Timing gates are opt-in.\n`,
  );
  process.exit(0);
}
if (!values.output) throw new Error("--output is required; see --help");
if (values.baseline && values["compare-ref"])
  throw new Error("Choose --baseline or --compare-ref, not both");
if (values.check && !values.baseline && !values["compare-ref"])
  throw new Error("--check requires --baseline or --compare-ref");
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
const reference = values["compare-ref"]
  ? resolveSourceReference(root, values["compare-ref"])
  : null;
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
  loadAtStart: NodeOS.loadavg(),
  freeMemoryAtStartBytes: NodeOS.freemem(),
  sourceDigests: currentSourceDigests(root),
};
const savedBaseline = values.baseline
  ? readBaseline(
      JSON.parse(await NodeFSP.readFile(NodePath.resolve(values.baseline), "utf8")),
      metadata,
    )
  : null;
const scratch = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-benchmark-"));
const sweeps: BenchmarkMeasurement[][] = [];
const referenceSweeps: BenchmarkMeasurement[][] = [];
const runOrder: {
  round: number;
  source: "reference" | "current";
  startedAt: string;
  finishedAt: string;
  loadBefore: number[];
  loadAfter: number[];
}[] = [];
const executeSweep = (round: number, source: "reference" | "current") => {
  process.stdout.write(`Sweep ${round + 1}/${sweepCount} (${source})\n`);
  const output = NodePath.join(scratch, `${round}-${source}.json`);
  const auditOutput = NodePath.join(scratch, `${round}-${source}-sources.json`);
  const startedAt = new Date().toISOString();
  const loadBefore = NodeOS.loadavg();
  const result = NodeChildProcess.spawnSync(
    NodePath.join(root, "node_modules/.bin/vp"),
    [
      "test",
      "run",
      "benchmarks/loom/benchmarks.test.ts",
      "--config",
      "benchmarks/loom/vite.config.ts",
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
        LOOM_PERF_REFERENCE: source === "reference" ? reference!.revision : "",
        LOOM_PERF_REFERENCE_AUDIT_OUTPUT: source === "reference" ? auditOutput : "",
      },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Sweep ${round + 1} (${source}) failed (${result.status ?? result.signal})`);
  runOrder.push({
    round: round + 1,
    source,
    startedAt,
    finishedAt: new Date().toISOString(),
    loadBefore,
    loadAfter: NodeOS.loadavg(),
  });
  return { output, auditOutput };
};
try {
  for (let sweep = 0; sweep < sweepCount; sweep++) {
    const order: readonly ("reference" | "current")[] = !reference
      ? ["current"]
      : sweep % 2 === 0
        ? ["reference", "current"]
        : ["current", "reference"];
    for (const source of order) {
      const { output, auditOutput } = executeSweep(sweep, source);
      const measurements = JSON.parse(
        await NodeFSP.readFile(output, "utf8"),
      ) as BenchmarkMeasurement[];
      if (source === "reference") {
        NodeAssert.deepEqual(
          JSON.parse(await NodeFSP.readFile(auditOutput, "utf8")),
          { revision: reference!.revision, digests: reference!.digests },
          "Every reference target must have loaded the exact original source",
        );
        referenceSweeps.push(measurements);
      } else sweeps.push(measurements);
    }
  }
  NodeAssert.deepEqual(
    currentSourceDigests(root),
    metadata.sourceDigests,
    "Benchmark target source changed during measurement",
  );
} finally {
  await NodeFSP.rm(scratch, { recursive: true, force: true });
}
const options = { sweeps: sweepCount, samples, minTimeMs, filter: values.filter };
const comparison = reference
  ? {
      method: "alternating-reference-current",
      referenceRevision: reference.revision,
      benchmarkRevision: metadata.revision,
      runOrder,
    }
  : null;
const referenceReport = reference
  ? {
      schemaVersion: 1,
      metadata: {
        ...metadata,
        revision: reference.revision,
        harnessRevision: metadata.revision,
        sourceDigests: reference.digests,
      },
      options,
      comparison,
      measurements: summarizeSweeps(referenceSweeps, null),
      sweeps: referenceSweeps,
    }
  : null;
const baseline = referenceReport ? readBaseline(referenceReport, metadata) : savedBaseline;
const measurements =
  referenceReport && baseline
    ? summarizePairedSweeps(sweeps, referenceSweeps, baseline)
    : summarizeSweeps(sweeps, baseline, values.filter !== "");
const report = { schemaVersion: 1, metadata, options, comparison, measurements, sweeps };
const output = NodePath.resolve(values.output);
await NodeFSP.mkdir(NodePath.dirname(output), { recursive: true });
if (referenceReport) {
  const parsed = NodePath.parse(output);
  const referenceOutput = NodePath.join(
    parsed.dir,
    `${parsed.name}.reference${parsed.ext || ".json"}`,
  );
  await NodeFSP.writeFile(referenceOutput, JSON.stringify(referenceReport, null, 2) + "\n");
  process.stdout.write(`Saved reference ${referenceOutput}\n`);
}
await NodeFSP.writeFile(output, JSON.stringify(report, null, 2) + "\n");
for (const item of measurements) {
  const comparisonText =
    item.reductionPct === null
      ? ""
      : `; ${Math.abs(item.reductionPct).toFixed(1)}% ${item.reductionPct < 0 ? "higher" : "lower"}${item.passed ? "" : " (below goal)"}`;
  const pairedText =
    "pairedReductionPct" in item && typeof item.pairedReductionPct === "number"
      ? `; paired median ${Math.abs(item.pairedReductionPct).toFixed(1)}% ${item.pairedReductionPct < 0 ? "higher" : "lower"}`
      : "";
  process.stdout.write(
    `${item.id}: ${item.medianMs.toFixed(3)} ms median, ${item.p95Ms.toFixed(3)} ms p95${comparisonText}${pairedText}\n`,
  );
}
process.stdout.write(`Saved ${output}\n`);
if (values.check && measurements.some((item) => item.passed === false)) process.exitCode = 1;
