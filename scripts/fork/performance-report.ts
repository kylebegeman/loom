// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import * as Schema from "effect/Schema";

const Sample = Schema.Struct({
  value: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)),
  work: Schema.Int.check(Schema.isGreaterThan(0)),
  errors: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
const Observation = Schema.Struct({
  scenario: Schema.Literals(["thread-open", "long-history", "streaming", "reconnect", "idle"]),
  units: Schema.Literals(["ms", "bytes", "cpu-percent"]),
  build: Schema.NonEmptyString,
  dataset: Schema.NonEmptyString,
  host: Schema.NonEmptyString,
  workload: Schema.NonEmptyString,
  cache: Schema.Literals(["warm", "cold"]),
  limiter: Schema.String,
  samples: Schema.Array(Sample).check(Schema.isMinLength(5)),
});
export const PerformanceRun = Schema.Struct({ observations: Schema.Array(Observation) });
export type PerformanceRun = typeof PerformanceRun.Type;
const median = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : sorted[middle - 1]! + (sorted[middle]! - sorted[middle - 1]!) / 2;
};
export function performanceReport(baseline: PerformanceRun, candidate: PerformanceRun) {
  const metric = (observation: typeof Observation.Type) =>
    `${observation.scenario}:${observation.units}`;
  const counts = (run: PerformanceRun) => {
    const result = new Map<string, number>();
    for (const observation of run.observations)
      result.set(metric(observation), (result.get(metric(observation)) ?? 0) + 1);
    return result;
  };
  const baselineCounts = counts(baseline);
  const candidateCounts = counts(candidate);
  const missing = ["thread-open", "long-history", "streaming", "reconnect", "idle"].filter(
    (scenario) =>
      !baseline.observations.some((item) => item.scenario === scenario) ||
      !candidate.observations.some((item) => item.scenario === scenario),
  );
  for (const key of baselineCounts.keys()) if (!candidateCounts.has(key)) missing.push(key);
  const rows = candidate.observations.map((next) => {
    const previous = baseline.observations.find(
      (item) => item.scenario === next.scenario && item.units === next.units,
    );
    const values = next.samples.map((sample) => sample.value),
      current = median(values),
      range = [Math.min(...values), Math.max(...values)];
    const errors = next.samples.reduce((sum, sample) => sum + sample.errors, 0);
    if (
      !previous ||
      baselineCounts.get(metric(next)) !== 1 ||
      candidateCounts.get(metric(next)) !== 1 ||
      (["dataset", "host", "workload", "cache"] as const).some(
        (field) => previous[field] !== next[field],
      ) ||
      previous.samples.some((sample) => sample.work !== next.samples[0]?.work) ||
      next.samples.some((sample) => sample.work !== previous.samples[0]?.work) ||
      !next.limiter.trim() ||
      !previous.limiter.trim()
    )
      return {
        scenario: next.scenario,
        units: next.units,
        verdict: "inconclusive",
        median: current,
        range,
        errors,
        reason: "Missing or ambiguous metric, limiter or comparable dataset/host/workload/cache.",
      };
    const before = previous.samples.map((sample) => sample.value),
      base = median(before),
      delta = base === 0 ? (current === 0 ? 0 : null) : (current - base) / base;
    const variation = Math.max(Math.max(...before) - Math.min(...before), range[1]! - range[0]!);
    const verdict =
      errors > 0 || previous.samples.some((sample) => sample.errors > 0)
        ? "failed"
        : delta === null
          ? "inconclusive"
          : delta > 0.1 && current - base > variation
            ? "possible-regression"
            : "no-demonstrated-regression";
    return {
      scenario: next.scenario,
      units: next.units,
      verdict,
      baselineMedian: base,
      median: current,
      range,
      relativeChange: delta,
      errors,
      limiter: next.limiter,
      build: next.build,
      dataset: next.dataset,
      samples: next.samples.length,
    };
  });
  return {
    verdict:
      [...baseline.observations, ...candidate.observations].some((observation) =>
        observation.samples.some((sample) => sample.errors > 0),
      ) || rows.some((row) => row.verdict === "failed" || row.verdict === "possible-regression")
        ? "needs-attention"
        : missing.length || rows.some((row) => row.verdict === "inconclusive")
          ? "inconclusive"
          : "no-demonstrated-regression",
    missing,
    rows,
  };
}
if (process.argv[1] === NodeURL.fileURLToPath(import.meta.url)) {
  const [baseline, candidate] = process.argv.slice(2);
  if (!baseline || !candidate)
    throw new Error(
      "Use <baseline-samples.json> <candidate-samples.json>. See the verification feature map for collecting real samples.",
    );
  const decode = Schema.decodeUnknownSync(Schema.fromJsonString(PerformanceRun));
  const result = performanceReport(
    decode(NodeFS.readFileSync(baseline, "utf8")),
    decode(NodeFS.readFileSync(candidate, "utf8")),
  );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.verdict !== "no-demonstrated-regression") process.exitCode = 1;
}
