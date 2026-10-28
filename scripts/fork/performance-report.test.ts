import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PerformanceRun, performanceReport } from "./performance-report.ts";
const isPerformanceRun = Schema.is(PerformanceRun);
const run = (value: number): PerformanceRun => ({
  observations: (["thread-open", "long-history", "streaming", "reconnect", "idle"] as const).map(
    (scenario) => ({
      scenario,
      units: "ms",
      build: "checked-build",
      dataset: "fixture-hash",
      host: "isolated",
      workload: "stable scenario",
      cache: "warm",
      limiter: "render work",
      samples: [value, value + 1, value, value - 1, value].map((value) => ({
        value,
        work: 10,
        errors: 0,
      })),
    }),
  ),
});
it("requires comparable complete scenarios and treats fast failed work as a failure", () => {
  expect(performanceReport(run(100), run(120)).verdict).toBe("needs-attention");
  const errors = {
    observations: run(20).observations.map((item) => ({
      ...item,
      samples: item.samples.map((sample) => ({ ...sample, errors: 1 })),
    })),
  };
  expect(performanceReport(run(100), errors).verdict).toBe("needs-attention");
  const changed = {
    observations: run(90).observations.map((item) => ({ ...item, dataset: "another dataset" })),
  };
  expect(performanceReport(run(100), changed).verdict).toBe("inconclusive");
  expect(
    performanceReport(run(100), { observations: run(100).observations.slice(1) }).verdict,
  ).toBe("inconclusive");
  expect(
    isPerformanceRun({
      observations: [{ ...run(100).observations[0], samples: [{ value: 1, work: 0, errors: 0 }] }],
    }),
  ).toBe(false);
});
