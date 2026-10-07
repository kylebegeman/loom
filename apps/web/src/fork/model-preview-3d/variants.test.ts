import { expect, it } from "vite-plus/test";
import { generateVariants, sweepValues } from "./variants";
import type { ScadParameter } from "@t3tools/contracts/fork";
const number = { name: "width", kind: "number" } as ScadParameter;
it("validates sweep literals and generates independent Cartesian candidates", () => {
  expect(sweepValues(number, "10, 20")).toEqual(["10", "20"]);
  expect(() => sweepValues(number, "oops")).toThrow("Invalid number");
  expect(() => sweepValues({ ...number, kind: "boolean" }, "yes")).toThrow("true or false");
  expect(sweepValues({ ...number, kind: "string" }, "red, blue")).toEqual(['"red"', '"blue"']);
  const base = { wall: "2" };
  const result = generateVariants(base, [
    { name: "width", values: ["10", "20"] },
    { name: "height", values: ["30", "40"] },
  ]);
  expect(result).toHaveLength(4);
  expect(result[3]!.values).toEqual({ wall: "2", width: "20", height: "40" });
  expect(base).toEqual({ wall: "2" });
  expect(() =>
    generateVariants(base, [
      { name: "a", values: Array(6).fill("1") },
      { name: "b", values: Array(3).fill("2") },
    ]),
  ).toThrow("12 candidates");
});

it("rejects duplicate axes and empty sweeps", () => {
  expect(() =>
    generateVariants({}, [
      { name: "width", values: ["1"] },
      { name: "width", values: ["2"] },
    ]),
  ).toThrow("distinct parameters");
  expect(() => generateVariants({}, [{ name: "width", values: [] }])).toThrow("at least one value");
});
