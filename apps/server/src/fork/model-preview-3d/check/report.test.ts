import { expect, it } from "vite-plus/test";
import { finalizeReport } from "./report.ts";
import { runPrintChecks } from "./printChecks.ts";
import { cubeSoup } from "./fixtures.ts";
import { weld } from "./mesh.ts";
const core = () =>
  runPrintChecks(
    weld(cubeSoup()),
    { nozzleMm: 0.4, overhangAngleDegrees: 45, firstLayerMm: 0.2 },
    42,
  );
const input = {
  geometryRevision: "rev",
  checkedAt: "2026-10-10T00:00:00Z",
  cached: false,
  settings: {
    nozzleMm: 0.4,
    nozzleSource: "setting" as const,
    overhangAngleDegrees: 45,
    firstLayerMm: 0.2,
    minWallMm: 0.8,
  },
  bed: { id: "bed", label: "Bed", fit: "fits" as const, overMm: null },
};
it("maps ready, incomplete and bed failures to report verdicts", () => {
  expect(finalizeReport(core(), input).verdict).toBe("ready");
  expect(finalizeReport({ ...core(), status: "incomplete" }, input).verdict).toBe("review");
  const report = finalizeReport(core(), {
    ...input,
    bed: { ...input.bed, fit: "too-big", overMm: [1, 2, 3] },
  });
  expect(report.verdict).toBe("blocked");
  expect(report.findings[0]).toMatchObject({
    id: "EXCEEDS_BUILD_VOLUME-1",
    check: "bed-fit",
    severity: "fail",
  });
  expect(
    finalizeReport(core(), { ...input, bed: { ...input.bed, fit: "fits-rotated" } }).findings[0]
      ?.code,
  ).toBe("FITS_ROTATED");
});
it("caps each finding code with stable unique ids and retains pre-cap counts", () => {
  const finding = {
    id: "",
    check: "overhangs" as const,
    code: "OVERHANG_AREA" as const,
    severity: "warn" as const,
    message: "Needs supports.",
    value: 10,
    limit: 5,
    unit: "mm2" as const,
    location: null,
  };
  const value = core();
  value.findings = Array.from({ length: 25 }, (_, i) => ({ ...finding, value: i }));
  const report = finalizeReport(value, input);
  expect(report.findings).toHaveLength(10);
  expect(report.truncated).toBe(true);
  expect(new Set(report.findings.map((f) => f.id)).size).toBe(10);
  expect(report.checks.find((r) => r.check === "overhangs")?.findings).toBe(25);
  expect(report.findings[0]?.value).toBe(24);
});
