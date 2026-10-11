import { expect, it } from "vite-plus/test";
import { bambuArgs, parseSliceInfo, verifyBambuResult } from "./bambu.ts";
const info =
  '<config><plate><metadata key="prediction" value="120"/><metadata key="weight" value="38"/><metadata key="printer_model_id" value="O1D"/><metadata key="outside" value="true"/><metadata key="support_used" value="true"/><filament id="1" type="PLA" color="#FF0000" used_m="12.71" used_g="38"/><warning msg="Check nozzle area &amp; support"/></plate></config>';
it("runs Bambu and Orca with isolated data and complete projects", () => {
  const args = bambuArgs({
    dataDir: "/loom/data",
    outputDir: "/loom/job/out",
    mesh: "/part.stl",
    machine: "/machine.json",
    process: "/process.json",
    filaments: ["/pla.json", "/petg.json"],
  });
  expect(args).toContain("/machine.json;/process.json");
  expect(args).toContain("/pla.json;/petg.json");
  expect(args).toContain("--orient");
  expect(args).not.toContain("--min-save");
  expect(() =>
    bambuArgs({
      dataDir: "/loom/data",
      outputDir: "/loom/job/out",
      mesh: "/part;2.stl",
      machine: "/machine.json",
      process: "/process.json",
      filaments: [],
    }),
  ).toThrow("semicolons");
});
it("reads plate metadata and verifies the actual printer before accepting output", () => {
  const parsed = parseSliceInfo(info);
  expect(parsed).toMatchObject({
    printSeconds: 120,
    totalGrams: 38,
    printerModelId: "O1D",
    supportUsed: true,
    filaments: [{ slot: 0, type: "PLA", grams: 38, lengthMm: 12710 }],
  });
  expect(parsed.warnings).toEqual([
    "Part of the model is outside the plate.",
    "Check nozzle area & support",
  ]);
  expect(() => verifyBambuResult(parsed, "O1D")).not.toThrow();
  expect(() => verifyBambuResult(parsed, "OTHER")).toThrow("different printer");
  expect(() => parseSliceInfo("<config/>")).toThrow("without a result");
  expect(() => verifyBambuResult({ ...parsed, printSeconds: null }, "O1D")).toThrow(
    "without a result",
  );
});

it("verifies exported printer settings when a Bambu bundle omits model-id metadata", () => {
  const parsed = { ...parseSliceInfo(info), printerModelId: "" };
  expect(() =>
    verifyBambuResult(parsed, "O1D", { expected: "Bambu Lab H2D", actual: "Bambu Lab H2D" }),
  ).not.toThrow();
  expect(() =>
    verifyBambuResult(parsed, "O1D", { expected: "Bambu Lab H2D", actual: "Bambu Lab X1 Carbon" }),
  ).toThrow("different printer");
  expect(() =>
    verifyBambuResult(parseSliceInfo(info), "OTHER", {
      expected: "Bambu Lab H2D",
      actual: "Bambu Lab H2D",
    }),
  ).toThrow("different printer");
});
