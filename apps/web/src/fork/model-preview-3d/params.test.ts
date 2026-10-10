import type { ScadParameter } from "@t3tools/contracts/fork";
import { validParameterLiteral, rebaseParameterValues, describeValues } from "./params";
import { expect, it } from "vite-plus/test";
import {
  changedOverrides,
  parameterValues,
  stringParameterValue,
  vectorParameterValue,
  parameterLabel,
} from "./params";
const parameters = [
  {
    name: "width",
    kind: "number" as const,
    defaultValue: "2",
    group: "",
    description: null,
    range: null,
    options: null,
  },
];
it("retains changed values, ignores removed parameters, and restores defaults on reset", () => {
  expect(changedOverrides(parameters, { width: "4", removed: "3" })).toEqual({ width: "4" });
  expect(changedOverrides(parameters, { width: "2" })).toEqual({});
  expect(parameterValues(parameters, {})).toEqual({ width: "2" });
  expect(parameterValues(parameters, { width: "8" })).toEqual({ width: "8" });
});

it("handles OpenSCAD string and vector literals without crashing on source edits", () => {
  expect(stringParameterValue('"blue"')).toBe("blue");
  expect(stringParameterValue('"a\\"b"')).toBe('a"b');
  expect(stringParameterValue('"unfinished')).toBe('"unfinished');
  expect(vectorParameterValue("[1, -2.5, 3]")).toEqual([1, -2.5, 3]);
  expect(vectorParameterValue("[]")).toBeNull();
  expect(vectorParameterValue('[1, "bad"]')).toBeNull();
  expect(vectorParameterValue("[1, 1e999]")).toBeNull();
  expect(vectorParameterValue("[1, cube(5)]")).toBeNull();
  expect(parameterLabel("wall_thickness")).toBe("Wall thickness");
  expect(parameterLabel("holeDiameter")).toBe("Hole Diameter");
});

it("validates variant literals and rebases source changes without invalid overrides", () => {
  const parameters = [
    { name: "width", kind: "number", defaultValue: "20" },
    { name: "label", kind: "string", defaultValue: '"New"' },
    { name: "enabled", kind: "boolean", defaultValue: "true" },
  ] as ScadParameter[];
  expect(validParameterLiteral(parameters[0]!, "+.5e2")).toBe(true);
  expect(validParameterLiteral(parameters[0]!, "cube(2)")).toBe(false);
  expect(validParameterLiteral(parameters[1]!, "unquoted")).toBe(false);
  expect(validParameterLiteral(parameters[2]!, "1")).toBe(false);
  expect(rebaseParameterValues(parameters, { width: "30", label: "3", removed: "9" })).toEqual({
    width: "30",
    label: '"New"',
    enabled: "true",
  });
});

it("summarises the parameters that differ from a baseline in readable form", () => {
  const parameter = (
    name: string,
    kind: ScadParameter["kind"],
    defaultValue: string,
    options: ScadParameter["options"] = null,
  ): ScadParameter => ({
    name,
    kind,
    defaultValue,
    options,
    group: "",
    description: null,
    range: null,
  });
  const parameters = [
    parameter("tray_depth", "number", "200"),
    parameter("label", "string", '"Rack"'),
    parameter("vents", "boolean", "true"),
    parameter("style", "string", '"flat"', [
      { value: '"flat"', label: "Flat" },
      { value: '"ribbed"', label: "Ribbed" },
    ]),
    parameter("size", "vector", "[10, 20]"),
  ];
  const defaults = Object.fromEntries(parameters.map((p) => [p.name, p.defaultValue]));
  expect(describeValues(parameters, defaults, {})).toBe("");
  expect(
    describeValues(
      parameters,
      { tray_depth: "140", label: '"Shelf"', vents: "false", style: '"ribbed"', size: "[10, 30]" },
      defaults,
    ),
  ).toBe("Tray depth 140, Label Shelf, Vents Off, Style Ribbed, Size 10 × 30");
});
