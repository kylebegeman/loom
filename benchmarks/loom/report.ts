import { percentile, type BenchmarkMeasurement } from "./harness.ts";

export const TARGET_IDS: ReadonlySet<string> = new Set([
  "pcb.netlist.1000",
  "pcb.drawing.1024.dense",
  "model.snap.fan.4096",
  "model.grid.box.49152",
  "graph.search.broad.100k",
  "graph.summary.100k",
  "library.history.rewrite.8000",
]);

export interface BenchmarkHardware {
  readonly cpu: string;
  readonly node: string;
  readonly platform: string;
  readonly arch: string;
}
export interface BaselineMeasurement {
  readonly id: string;
  readonly fingerprint: string;
  readonly workload: BenchmarkMeasurement["workload"];
  readonly medianMs: number;
}
export interface BaselineReport {
  readonly schemaVersion: number;
  readonly metadata: BenchmarkHardware;
  readonly measurements: readonly BaselineMeasurement[];
}

const requiredReductionPct = (target: boolean) => (target ? 20 : -15);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function readBaseline(value: unknown, hardware: BenchmarkHardware): BaselineReport {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.metadata) ||
    !Array.isArray(value.measurements)
  )
    throw new Error("Invalid baseline report schema");
  for (const key of ["cpu", "node", "platform", "arch"] as const)
    if (value.metadata[key] !== hardware[key])
      throw new Error(`Baseline ${key} must match this process`);
  const measurements = value.measurements.map((item: unknown): BaselineMeasurement => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.fingerprint !== "string" ||
      !isRecord(item.workload) ||
      typeof item.medianMs !== "number" ||
      !Number.isFinite(item.medianMs) ||
      item.medianMs <= 0
    )
      throw new Error("Invalid baseline measurement");
    for (const field of Object.values(item.workload))
      if (
        !(
          typeof field === "string" ||
          typeof field === "boolean" ||
          (typeof field === "number" && Number.isFinite(field)) ||
          (Array.isArray(field) &&
            field.every((entry: unknown) => typeof entry === "number" && Number.isFinite(entry)))
        )
      )
        throw new Error("Invalid baseline workload");
    return {
      id: item.id,
      fingerprint: item.fingerprint,
      workload: item.workload as BenchmarkMeasurement["workload"],
      medianMs: item.medianMs,
    };
  });
  if (
    measurements.length === 0 ||
    new Set(measurements.map((item) => item.id)).size !== measurements.length
  )
    throw new Error("Baseline must contain unique, nonempty measurements");
  return { schemaVersion: 1, metadata: hardware, measurements };
}

export function summarizeSweeps(
  sweeps: readonly (readonly BenchmarkMeasurement[])[],
  baseline: BaselineReport | null,
  allowSubset = false,
) {
  const firstSweep = sweeps[0];
  if (!firstSweep?.length) throw new Error("At least one nonempty sweep is required");
  const ids = firstSweep.map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Benchmark IDs must be unique");
  for (const sweep of sweeps)
    if (sweep.length !== ids.length || sweep.some((item, i) => item.id !== ids[i]))
      throw new Error("Each sweep must contain the same workloads in the same order");
  if (baseline && !allowSubset && baseline.measurements.length !== ids.length)
    throw new Error("Full comparison must include all baseline workloads");
  return firstSweep.map((first, i) => {
    const rounds = sweeps.map((sweep) => {
      const round = sweep[i]!;
      if (
        round.fingerprint !== first.fingerprint ||
        JSON.stringify(round.workload) !== JSON.stringify(first.workload)
      )
        throw new Error(`${first.id}: inconsistent workload or output across sweeps`);
      return round;
    });
    const medianMs = percentile(
      rounds.map((round) => round.medianMs).toSorted((a, b) => a - b),
      0.5,
    );
    const previous = baseline?.measurements.find((item) => item.id === first.id);
    if (baseline && !previous) throw new Error(`${first.id}: absent from baseline`);
    if (
      previous &&
      (previous.fingerprint !== first.fingerprint ||
        JSON.stringify(previous.workload) !== JSON.stringify(first.workload))
    )
      throw new Error(`${first.id}: output or fixture differs from baseline`);
    const reductionPct = previous ? (1 - medianMs / previous.medianMs) * 100 : null;
    const target = TARGET_IDS.has(first.id);
    return {
      id: first.id,
      description: first.description,
      workload: first.workload,
      fingerprint: first.fingerprint,
      medianMs,
      p95Ms: percentile(
        rounds.flatMap((round) => [...round.samplesMs]).toSorted((a, b) => a - b),
        0.95,
      ),
      sweepMediansMs: rounds.map((round) => round.medianMs),
      reductionPct,
      target,
      passed: reductionPct === null ? null : reductionPct >= requiredReductionPct(target),
    };
  });
}

export function summarizePairedSweeps(
  currentSweeps: readonly (readonly BenchmarkMeasurement[])[],
  referenceSweeps: readonly (readonly BenchmarkMeasurement[])[],
  baseline: BaselineReport,
) {
  if (currentSweeps.length === 0 || currentSweeps.length !== referenceSweeps.length)
    throw new Error("Paired comparisons require the same nonempty round count");
  for (const [round, current] of currentSweeps.entries()) {
    const reference = referenceSweeps[round]!;
    if (
      current.length !== reference.length ||
      current.some((item, i) => item.id !== reference[i]!.id)
    )
      throw new Error("Each paired round must contain the same workloads in the same order");
  }
  const referenceSummary = summarizeSweeps(referenceSweeps, baseline);
  for (const item of referenceSummary)
    if (
      item.medianMs !== baseline.measurements.find((previous) => previous.id === item.id)!.medianMs
    )
      throw new Error(`${item.id}: baseline median differs from the reference sweeps`);
  return summarizeSweeps(currentSweeps, baseline).map((item, i) => {
    const pairedReductionsPct = currentSweeps.map(
      (sweep, round) => (1 - sweep[i]!.medianMs / referenceSweeps[round]![i]!.medianMs) * 100,
    );
    const pairedReductionPct = percentile(
      pairedReductionsPct.toSorted((a, b) => a - b),
      0.5,
    );
    return {
      ...item,
      pairedReductionsPct,
      pairedReductionPct,
      passed: item.passed === true && pairedReductionPct >= requiredReductionPct(item.target),
    };
  });
}
