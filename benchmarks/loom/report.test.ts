import { describe, expect, test } from "vite-plus/test";
import { defineBenchmark, measure, type BenchmarkMeasurement } from "./harness.ts";
import { readBaseline, summarizeSweeps } from "./report.ts";

const hardware = { cpu: "test CPU", node: "v24", platform: "darwin", arch: "arm64" };
const measurement = (id: string, medianMs: number): BenchmarkMeasurement => ({
  id,
  medianMs,
  description: "test workload",
  workload: { items: 100 },
  fingerprint: "stable-output",
  samplesMs: [medianMs, medianMs, medianMs * 2],
  p95Ms: medianMs * 2,
  minMs: medianMs,
  cpuMs: 1,
  observedHeapDeltaBytes: 0,
  observedRssDeltaBytes: 0,
});
const baseline = (measurements = [measurement("pcb.netlist.1000", 100)]) =>
  readBaseline({ schemaVersion: 1, metadata: hardware, measurements }, hardware);

describe("benchmark comparisons", () => {
  test("uses equal weight per sweep and preserves the observed p95", () => {
    const result = summarizeSweeps(
      [
        [measurement("pcb.netlist.1000", 50)],
        [
          {
            ...measurement("pcb.netlist.1000", 70),
            samplesMs: Array.from({ length: 100 }, () => 70),
          },
        ],
        [measurement("pcb.netlist.1000", 60)],
      ],
      baseline(),
    )[0]!;
    expect(result.medianMs).toBe(60);
    expect(result.reductionPct).toBe(40);
    expect(result.p95Ms).toBe(70);
    expect(result.passed).toBe(true);
  });

  test("rejects different results, fixtures and missing workloads", () => {
    const current = measurement("pcb.netlist.1000", 50);
    expect(() => summarizeSweeps([[{ ...current, fingerprint: "wrong" }]], baseline())).toThrow(
      "output or fixture",
    );
    expect(() => summarizeSweeps([[{ ...current, workload: { items: 1 } }]], baseline())).toThrow(
      "output or fixture",
    );
    expect(() => summarizeSweeps([[measurement("new-case", 50)]], baseline())).toThrow(
      "absent from baseline",
    );
    expect(() => summarizeSweeps([[current], []], null)).toThrow("same workloads");
  });

  test("requires target gains while bounding guardrail regressions", () => {
    const previous = baseline([
      measurement("pcb.netlist.1000", 100),
      measurement("cold-load", 100),
    ]);
    const results = summarizeSweeps(
      [[measurement("pcb.netlist.1000", 85), measurement("cold-load", 116)]],
      previous,
    );
    expect(results.map((item) => item.passed)).toEqual([false, false]);
  });

  test("rejects incompatible hardware and invalid measurements", () => {
    const report = { schemaVersion: 1, metadata: hardware, measurements: [measurement("case", 1)] };
    expect(() => readBaseline(report, { ...hardware, node: "v26" })).toThrow("node must match");
    expect(() =>
      readBaseline({ ...report, measurements: [measurement("case", 0)] }, hardware),
    ).toThrow("Invalid baseline");
    expect(() =>
      readBaseline(
        { ...report, measurements: [measurement("case", 1), measurement("case", 2)] },
        hardware,
      ),
    ).toThrow("unique");
  });
});

test("measurement verifies stable async output before and after timing", async () => {
  let state = "stable";
  const workload = defineBenchmark({
    id: "mutable",
    description: "output guard",
    workload: {},
    run: async () => state,
    check: (result) => result,
  });
  const result = await measure(workload, { samples: 1, minTimeMs: 0, warmupMs: 0 });
  expect(result.fingerprint).toBe("stable");
  let invocations = 0;
  await expect(
    measure(
      {
        ...workload,
        run: () => {
          state = "changed";
        },
        verify: async () => {
          invocations++;
          return state;
        },
      },
      { samples: 1, minTimeMs: 0, warmupMs: 0 },
    ),
  ).rejects.toThrow("output changed");
  expect(invocations).toBe(2);
});
