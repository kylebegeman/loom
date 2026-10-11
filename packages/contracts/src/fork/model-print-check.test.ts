import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { PrintCheckReport, PrintCheckId, PrintFindingCode } from "./model-print-check.ts";
import { ModelPreviewSettings, DEFAULT_MODEL_PREVIEW_SETTINGS } from "./model-preview-3d.ts";
const decodeReport = Schema.decodeUnknownSync(PrintCheckReport);
it("decodes old settings with defaults and rejects unsafe print settings", () => {
  const {
    nozzleDiameterMm: _,
    firstLayerHeightMm: __,
    overhangAngleDegrees: ___,
    ...old
  } = DEFAULT_MODEL_PREVIEW_SETTINGS;
  const decode = Schema.decodeUnknownSync(ModelPreviewSettings);
  expect(decode(old)).toMatchObject({
    nozzleDiameterMm: 0.4,
    firstLayerHeightMm: 0.2,
    overhangAngleDegrees: 45,
  });
  for (const patch of [
    { nozzleDiameterMm: 0.05 },
    { firstLayerHeightMm: 0 },
    { overhangAngleDegrees: 80 },
  ])
    expect(() => decode({ ...old, ...patch })).toThrow();
});
it("round trips a complete eight-check report and keeps check/code ids unique", () => {
  const ids = PrintCheckId.literals;
  expect(new Set(ids).size).toBe(8);
  expect(new Set(PrintFindingCode.literals).size).toBe(PrintFindingCode.literals.length);
  const report: PrintCheckReport = {
    version: 1,
    status: "complete",
    verdict: "ready",
    geometryRevision: "revision",
    checkedAt: "2026-10-10T00:00:00Z",
    durationMs: 10,
    cached: false,
    orientation: null,
    summary: {
      triangles: 12,
      vertices: 8,
      shells: 1,
      watertight: true,
      volumeMm3: 1000,
      surfaceAreaMm2: 600,
      sizeMm: [10, 10, 10],
      contactAreaMm2: 100,
      overhangAreaMm2: 0,
      minThicknessMm: null,
      thicknessSamples: 2000,
    },
    settings: {
      nozzleMm: 0.4,
      nozzleSource: "setting",
      overhangAngleDegrees: 45,
      firstLayerMm: 0.2,
      minWallMm: 0.8,
    },
    bed: { id: "bed", label: "Bed", fit: "fits", overMm: null },
    checks: ids.map((check) => ({ check, status: "pass", summary: "Pass", findings: 0 })),
    findings: [],
    truncated: false,
    stages: [{ name: "parse", ms: 1 }],
  };
  expect(decodeReport(report)).toEqual(report);
});
