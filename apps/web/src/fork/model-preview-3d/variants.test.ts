import { describe, expect, it } from "vite-plus/test";
import type { ScadParameter } from "@t3tools/contracts/fork";
import {
  MAX_VARIANTS,
  expandVariants,
  parseValues,
  sweepValues,
  variantName,
  type VariantAxis,
  type VariantCandidate,
} from "./variants";

const parameter = (
  name: string,
  kind: ScadParameter["kind"],
  range: ScadParameter["range"] = null,
): ScadParameter => ({
  name,
  group: "",
  description: null,
  kind,
  defaultValue: "0",
  range,
  options: null,
});
const parameters = [
  parameter("width", "number", { min: 20, max: 200, step: null }),
  parameter("wall", "number", { min: 1, max: 5, step: 0.5 }),
  parameter("hole", "number", { min: 1, max: 10, step: null }),
  parameter("depth", "number"),
  parameter("label", "string"),
  parameter("rounded", "boolean"),
];
const base = { width: "60", wall: "2", hole: "4", depth: "30", label: '"A"', rounded: "true" };
const expand = (axes: readonly VariantAxis[]) => expandVariants(parameters, base, axes);
const names = (result: ReturnType<typeof expandVariants>) =>
  (result as VariantCandidate[]).map((candidate) => candidate.name);
const error = (axes: readonly VariantAxis[]) => (expand(axes) as { error: string }).error;

describe("Variant sweeps", () => {
  it("expands one parameter on top of the current values", () => {
    const result = expand([{ name: "width", values: ["30", "40", "50"] }]) as VariantCandidate[];
    expect(result.map((candidate) => candidate.name)).toEqual(["width 30", "width 40", "width 50"]);
    // The others keep their values, and the base is untouched.
    expect(result[1]!.values).toEqual({ ...base, width: "40" });
    expect(base.width).toBe("60");
  });

  it("forms a grid of two parameters in a stable order", () => {
    expect(
      names(
        expand([
          { name: "width", values: ["40", "60"] },
          { name: "wall", values: ["2", "2.5", "3"] },
        ]),
      ),
    ).toEqual([
      "width 40 · wall 2",
      "width 40 · wall 2.5",
      "width 40 · wall 3",
      "width 60 · wall 2",
      "width 60 · wall 2.5",
      "width 60 · wall 3",
    ]);
  });

  it("refuses sweeps over the limits or outside a range", () => {
    expect(error([])).toMatch(/one or two/);
    expect(error([{ name: "width", values: ["20", "30", "40", "50", "60", "70", "80"] }])).toBe(
      "List up to 6 values for width.",
    );
    expect(
      error([
        { name: "width", values: ["40", "60"] },
        { name: "wall", values: ["2", "3", "4", "5"] },
      ]),
    ).toBe(`That makes 8 variants; explore up to ${MAX_VARIANTS} at once.`);
    expect(
      error([
        { name: "width", values: ["40", "60", "80"] },
        { name: "wall", values: ["2", "3", "4"] },
      ]),
    ).toBe("That makes 9 variants; explore up to 6 at once.");
    expect(error([{ name: "width", values: ["250"] }])).toBe("width 250 is outside 20 to 200.");
    expect(error([{ name: "hole", values: ["12"] }])).toBe("hole 12 is outside 1 to 10.");
    expect(error([{ name: "width", values: ["40", "40"] }])).toMatch(/different/);
    expect(
      error([
        { name: "wall", values: ["2"] },
        { name: "wall", values: ["3"] },
      ]),
    ).toMatch(/two different/);
    expect(error([{ name: "length", values: ["1"] }])).toMatch(/No parameter/);
    expect(error([{ name: "width", values: [] }])).toBe("List at least one value for width.");
    // A number without a declared range takes any finite value.
    expect(names(expand([{ name: "depth", values: ["-5", "1000"] }]))).toEqual([
      "depth -5",
      "depth 1000",
    ]);
  });

  it("reads typed value lists and names values without float noise", () => {
    expect(parseValues("30, 40 50;60")).toEqual([30, 40, 50, 60]);
    expect(parseValues(" ")).toEqual({ error: "List at least one value." });
    expect(parseValues("30, abc")).toEqual({ error: '"abc" is not a number.' });
    expect(variantName([{ name: "wall" }], [String(0.1 + 0.2)])).toBe("wall 0.3");
  });

  it("reads switches and text as OpenSCAD literals", () => {
    const [, , , , label, rounded] = parameters;
    expect(sweepValues(parameters[0]!, "30; 40.50")).toEqual(["30", "40.5"]);
    expect(sweepValues(rounded!, "true false")).toEqual(["true", "false"]);
    expect(sweepValues(rounded!, "yes")).toEqual({ error: '"yes" is not true or false.' });
    expect(sweepValues(label!, "Front panel, Back")).toEqual(['"Front panel"', '"Back"']);
    expect(sweepValues(parameter("size", "vector"), "1")).toHaveProperty("error");
    expect(
      names(expand([{ name: "label", values: sweepValues(label!, "A, B") as string[] }])),
    ).toEqual(["label A", "label B"]);
  });
});
