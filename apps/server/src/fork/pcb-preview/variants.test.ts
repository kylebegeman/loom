import { expect, it } from "vite-plus/test";
import { circuitIssues, variantStats, validateVariantValues } from "./variants.ts";
import { inspectCircuitJson } from "./semantics.ts";
it("counts circuit issues and computes stats from candidate data", () => {
  const json = [
    { type: "pcb_board", center: { x: 0, y: 0 }, width: 40, height: 20 },
    { type: "pcb_trace_error" },
    { type: "pcb_layout_warning" },
    {},
    null,
  ];
  expect(circuitIssues(json)).toEqual({ errors: 1, warnings: 1 });
  expect(circuitIssues({})).toEqual({ errors: 0, warnings: 0 });
  expect(variantStats(inspectCircuitJson(json, "r1"), json)).toMatchObject({
    widthMm: 40,
    heightMm: 20,
    components: 0,
    errors: 1,
    warnings: 1,
    board: { areaMm2: 800, copperLayers: 2 },
  });
});
it("validates proposed values using the same bounded source edits as promotion", () => {
  const parameters = {
    sourceHash: "r1",
    schemaPath: "",
    source: 'const w=/* loom:param width */20; const k=/* loom:param kind */"a";',
    parameters: [
      {
        key: "width",
        label: "Width",
        description: "",
        type: "number" as const,
        default: 20,
        min: 10,
        max: 40,
      },
      {
        key: "kind",
        label: "Kind",
        description: "",
        type: "string" as const,
        default: "a",
        choices: ["a", "b"],
      },
    ],
  };
  expect(validateVariantValues(parameters, { width: 30 })).toBeNull();
  expect(validateVariantValues(parameters, { width: 100 })).toContain("range");
  expect(validateVariantValues(parameters, { kind: "c" })).toContain("listed");
  expect(validateVariantValues(parameters, { missing: true })).toContain("Invalid value");
});
