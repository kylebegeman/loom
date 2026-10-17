// Node APIs measure the benchmark process, outside the application runtime.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodePerfHooks from "node:perf_hooks";

export interface BenchmarkCase {
  readonly id: string;
  readonly description: string;
  readonly workload: Readonly<Record<string, string | number | boolean | readonly number[]>>;
  readonly run: () => unknown;
  readonly verify: () => Promise<string>;
}

export function fingerprint(value: unknown): string {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function defineBenchmark<T>(input: {
  readonly id: string;
  readonly description: string;
  readonly workload: BenchmarkCase["workload"];
  readonly run: () => T;
  readonly check: (result: Awaited<T>) => string | Promise<string>;
}): BenchmarkCase {
  return {
    id: input.id,
    description: input.description,
    workload: input.workload,
    run: input.run,
    verify: async () => input.check(await input.run()),
  };
}

export const percentile = (sorted: readonly number[], fraction: number) => {
  if (sorted.length === 0) throw new Error("Cannot summarize empty samples");
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
};

export interface BenchmarkMeasurement {
  readonly id: string;
  readonly description: string;
  readonly workload: BenchmarkCase["workload"];
  readonly fingerprint: string;
  readonly samplesMs: readonly number[];
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly cpuMs: number;
  readonly observedHeapDeltaBytes: number;
  readonly observedRssDeltaBytes: number;
}

export async function measure(
  benchmark: BenchmarkCase,
  options: { readonly samples: number; readonly minTimeMs: number; readonly warmupMs: number },
): Promise<BenchmarkMeasurement> {
  const expected = await benchmark.verify();
  const warmupStart = NodePerfHooks.performance.now();
  for (let n = 0; n < 5 || NodePerfHooks.performance.now() - warmupStart < options.warmupMs; n++) {
    await benchmark.run();
    if (n >= 10_000) break;
  }
  const before = process.memoryUsage();
  const cpuStart = process.cpuUsage();
  const samplesMs: number[] = [];
  const start = NodePerfHooks.performance.now();
  do {
    const iteration = NodePerfHooks.performance.now();
    await benchmark.run();
    samplesMs.push(NodePerfHooks.performance.now() - iteration);
  } while (
    samplesMs.length < options.samples ||
    (NodePerfHooks.performance.now() - start < options.minTimeMs && samplesMs.length < 20_000)
  );
  const cpu = process.cpuUsage(cpuStart);
  const after = process.memoryUsage();
  const actual = await benchmark.verify();
  if (actual !== expected) throw new Error(`${benchmark.id}: output changed during measurement`);
  const sorted = samplesMs.toSorted((a, b) => a - b);
  return {
    id: benchmark.id,
    description: benchmark.description,
    workload: benchmark.workload,
    fingerprint: actual,
    samplesMs,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0]!,
    cpuMs: (cpu.user + cpu.system) / 1000,
    observedHeapDeltaBytes: after.heapUsed - before.heapUsed,
    observedRssDeltaBytes: after.rss - before.rss,
  };
}
