import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PcbVariant } from "@t3tools/contracts/fork";
import { sweepValues, generateCandidates, sortVariants } from "./sweep";
const number = {
  key: "width",
  label: "Width",
  description: "",
  type: "number" as const,
  default: 20,
  min: 10,
  max: 40,
  step: 2,
};
const boolean = {
  key: "enabled",
  label: "Enabled",
  description: "",
  type: "boolean" as const,
  default: true,
};
it("snaps inclusive ranges, clamps, deduplicates and validates choices", () => {
  expect(sweepValues(number, { from: 11, to: 39, count: 3 })).toEqual([12, 26, 40]);
  expect(sweepValues(number, { from: 0, to: 12, count: 3 })).toEqual([10, 12]);
  expect(sweepValues(boolean, undefined)).toEqual([false, true]);
  const choice = { ...number, choices: [10, 20] };
  expect(sweepValues(choice, [20, 10, 20])).toEqual([20, 10]);
  expect(() => sweepValues(choice, [30])).toThrow();
  expect(() => sweepValues(number, { from: 0, to: NaN, count: 3 })).toThrow();
  expect(
    sweepValues({ ...boolean, key: "kind", type: "string", default: "a" }, " a, b, a "),
  ).toEqual(["a", "b"]);
});
it("forms bounded two-axis products while preserving other values", () => {
  const axes = [
    { parameter: number, values: [10, 20, 30] },
    { parameter: boolean, values: [false, true] },
  ];
  const rows = generateCandidates({ keep: "source" }, axes);
  expect(rows).toHaveLength(6);
  expect(rows[0]).toEqual({
    name: "width 10 / enabled false",
    values: { keep: "source", width: 10, enabled: false },
  });
  expect(() =>
    generateCandidates({}, [{ ...axes[0]!, values: [10, 12, 14, 16, 18] }, axes[1]!]),
  ).toThrow("8");
  expect(() => generateCandidates({}, [axes[0]!, axes[0]!])).toThrow("different");
});
const decodeVariant = Schema.decodeUnknownSync(PcbVariant);
it("sorts statistics in either direction with unrendered candidates last", () => {
  const make = (id: string, width?: number) =>
    decodeVariant({
      id,
      name: id,
      values: {},
      sourceHash: "r1",
      ...(width !== undefined
        ? { stats: { widthMm: width, heightMm: 10, components: 1, errors: 0, warnings: 0 } }
        : {}),
    });
  const values = [make("Z"), make("A", 40), make("B", 20)];
  expect(sortVariants(values, "width", "asc").map((v) => v.id)).toEqual(["B", "A", "Z"]);
  expect(sortVariants(values, "width", "desc").map((v) => v.id)).toEqual(["A", "B", "Z"]);
});
