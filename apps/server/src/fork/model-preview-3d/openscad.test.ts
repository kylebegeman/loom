import { describe, expect, it } from "@effect/vitest";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "@t3tools/contracts/fork";
import {
  detectedInfo,
  parseVersion,
  renderArgs,
  pngArgs,
  parseLog,
  parseSummary,
} from "./openscad.ts";
describe("OpenSCAD command boundary", () => {
  it("detects capabilities from help rather than a guessed snapshot date", () => {
    expect(parseVersion("OpenSCAD version 2026.10.05")).toBe("2026.10.05");
    expect(detectedInfo("openscad", "OpenSCAD version 2021.01", "")).toMatchObject({
      isSnapshot: false,
      supportsManifold: false,
      supportsSummary: false,
    });
    expect(
      detectedInfo("openscad", "2026.10.05", "--backend Manifold --summary-file"),
    ).toMatchObject({ isSnapshot: true, supportsManifold: true, supportsSummary: true });
  });
  it("exports binary STL and keeps overrides after the saved set", () => {
    const args = renderArgs({
      source: "a file.scad",
      output: "part.stl",
      deps: "part.deps",
      summary: "summary.json",
      info: detectedInfo("openscad", "2026.10.05", "--backend Manifold --summary-file"),
      settings: DEFAULT_MODEL_PREVIEW_SETTINGS,
      overrides: { width: "12", name: '"a b"' },
      parameterSet: "wide",
      sidecar: "part.json",
    });
    expect(args).toContain("binstl");
    expect(args).toContain("--backend=manifold");
    expect(args.indexOf("-D")).toBeGreaterThan(args.indexOf("-P"));
    expect(args.slice(-3)).toEqual(["-d", "part.deps", "a file.scad"]);
  });
  it("chooses different cameras and treats exit-zero ERROR text as an error", () => {
    expect(pngArgs("part.scad", "part.png", "top")).toContain("--camera=0,0,0,0,0,0,200");
    expect(pngArgs("part.scad", "part.png", "front")).not.toEqual(
      pngArgs("part.scad", "part.png", "top"),
    );
    expect(
      parseLog('ECHO: "width", 3\nWARNING: bad\nERROR: nope\nTRACE: at part\nplain').map(
        (line) => line.level,
      ),
    ).toEqual(["echo", "warning", "error", "trace", "info"]);
  });
  it("parses incomplete geometry summaries defensively", () => {
    expect(parseSummary('{"geometry":{"simple":true,"facets":12}}')).toMatchObject({
      manifold: true,
      facets: 12,
      vertices: null,
      boundingBox: null,
    });
    expect(parseSummary("not json")).toBeNull();
    expect(parseSummary("{}")).toBeNull();
  });
});
