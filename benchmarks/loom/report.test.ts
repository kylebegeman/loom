import { describe, expect, test } from "vite-plus/test";
import { defineBenchmark, measure, type BenchmarkMeasurement } from "./harness.ts";
import { readBaseline, summarizePairedSweeps, summarizeSweeps } from "./report.ts";

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

  test("rejects dropped workloads unless a filtered comparison was requested", () => {
    const previous = baseline([
      measurement("pcb.netlist.1000", 100),
      measurement("cold-load", 100),
    ]);
    const subset = [[measurement("pcb.netlist.1000", 50)]];
    expect(() => summarizeSweeps(subset, previous)).toThrow("all baseline workloads");
    expect(summarizeSweeps(subset, previous, true)[0]?.passed).toBe(true);
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

describe("paired benchmark comparisons", () => {
  const rounds = (values: readonly number[], id = "pcb.netlist.1000") =>
    values.map((value) => [measurement(id, value)]);
  const referenceBaseline = (reference: readonly (readonly BenchmarkMeasurement[])[]) =>
    readBaseline(
      { schemaVersion: 1, metadata: hardware, measurements: summarizeSweeps(reference, null) },
      hardware,
    );

  test("requires gains in matched rounds when independent medians suggest a larger gain", () => {
    const reference = rounds([100, 200, 1000]);
    const result = summarizePairedSweeps(
      rounds([120, 180, 100]),
      reference,
      referenceBaseline(reference),
    )[0]!;
    expect(result.reductionPct).toBeCloseTo(40);
    expect(result.pairedReductionsPct[0]).toBeCloseTo(-20);
    expect(result.pairedReductionsPct[1]).toBeCloseTo(10);
    expect(result.pairedReductionsPct[2]).toBeCloseTo(90);
    expect(result.pairedReductionPct).toBeCloseTo(10);
    expect(result.passed).toBe(false);
  });

  test("preserves aggregate metrics and accepts consistent target and control results", () => {
    const reference = [100, 200, 300].map((value) => [
      measurement("pcb.netlist.1000", value),
      measurement("cold-load", value),
    ]);
    const current = [
      [measurement("pcb.netlist.1000", 70), measurement("cold-load", 110)],
      [measurement("pcb.netlist.1000", 130), measurement("cold-load", 220)],
      [measurement("pcb.netlist.1000", 210), measurement("cold-load", 330)],
    ];
    const previous = referenceBaseline(reference);
    const aggregate = summarizeSweeps(current, previous);
    const paired = summarizePairedSweeps(current, reference, previous);
    expect(paired[0]).toMatchObject(aggregate[0]!);
    expect(paired[0]!.pairedReductionPct).toBeCloseTo(30);
    expect(paired[1]!.pairedReductionPct).toBeCloseTo(-10);
    expect(paired.map((item) => item.passed)).toEqual([true, true]);
  });

  test("keeps the aggregate gate when a majority of matched rounds improve", () => {
    const reference = rounds([100, 200, 1000]);
    const result = summarizePairedSweeps(
      rounds([50, 180, 500]),
      reference,
      referenceBaseline(reference),
    )[0]!;
    expect(result.reductionPct).toBeCloseTo(10);
    expect(result.pairedReductionPct).toBeCloseTo(50);
    expect(result.passed).toBe(false);
  });

  test("rejects repeated control regressions even if independent medians improve", () => {
    const reference = rounds([100, 200, 1000], "cold-load");
    const result = summarizePairedSweeps(
      rounds([120, 240, 100], "cold-load"),
      reference,
      referenceBaseline(reference),
    )[0]!;
    expect(result.reductionPct).toBeCloseTo(40);
    expect(result.pairedReductionPct).toBeCloseTo(-20);
    expect(result.passed).toBe(false);
  });

  test("requires a nonempty matched round count and corresponding workload order", () => {
    expect(() => summarizePairedSweeps([], [], baseline())).toThrow("nonempty round count");
    expect(() => summarizePairedSweeps(rounds([50]), rounds([100, 200]), baseline())).toThrow(
      "same nonempty round count",
    );
    const reference = [[measurement("pcb.netlist.1000", 100), measurement("cold-load", 100)]];
    expect(() =>
      summarizePairedSweeps(
        [[measurement("cold-load", 50), measurement("pcb.netlist.1000", 50)]],
        reference,
        referenceBaseline(reference),
      ),
    ).toThrow("same workloads in the same order");
  });

  test("requires identical outputs and fixtures for matched rounds", () => {
    const reference = rounds([100]);
    const previous = referenceBaseline(reference);
    expect(() =>
      summarizePairedSweeps(
        [[{ ...measurement("pcb.netlist.1000", 50), fingerprint: "different" }]],
        reference,
        previous,
      ),
    ).toThrow("output or fixture");
    expect(() =>
      summarizePairedSweeps(
        [[{ ...measurement("pcb.netlist.1000", 50), workload: { items: 200 } }]],
        reference,
        previous,
      ),
    ).toThrow("output or fixture");
  });

  test("rejects a stale baseline median even when workloads and outputs match", () => {
    expect(() => summarizePairedSweeps(rounds([50]), rounds([101]), baseline())).toThrow(
      "baseline median differs from the reference sweeps",
    );
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
