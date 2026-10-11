import { expect, it } from "vite-plus/test";
import { weld } from "./mesh.ts";
import { runPrintChecks } from "./printChecks.ts";
import { cubeSoup, joinSoup } from "./fixtures.ts";
const params = { nozzleMm: 0.4, overhangAngleDegrees: 45, firstLayerMm: 0.2 };
const check = (soup: Float32Array) => runPrintChecks(weld(soup), params, 42);
it("a cube is watertight with full bed contact and no supports", () => {
  const result = check(cubeSoup());
  expect(result.checks).toHaveLength(8);
  expect(result.summary).toMatchObject({
    watertight: true,
    contactAreaMm2: 100,
    overhangAreaMm2: 0,
  });
  expect(result.summary.volumeMm3).toBeCloseTo(1000);
  expect(result.findings).toEqual([]);
});
it("an open cube locates its open-edge cluster", () => {
  const result = check(cubeSoup().slice(0, 90));
  expect(result.findings.find((f) => f.code === "OPEN_EDGES")?.location?.point).toBeTruthy();
  expect(result.summary.volumeMm3).toBeNull();
});
it.each([
  [0.6, "THIN_WALL"],
  [0.25, "FEATURE_BELOW_NOZZLE"],
  [2, null],
] as const)("checks a %s mm plate", (width, code) => {
  const result = check(cubeSoup([10, 10, width]));
  if (code) {
    const finding = result.findings.find((f) => f.code === code);
    expect(finding?.value).toBeCloseTo(width, 2);
    expect(finding?.location).toBeTruthy();
  } else
    expect(
      result.findings.some((f) => f.code === "THIN_WALL" || f.code === "FEATURE_BELOW_NOZZLE"),
    ).toBe(false);
});
it("warns for tall posts and detects a floating body/overhang", () => {
  expect(check(cubeSoup([5, 5, 60])).findings.some((f) => f.code === "TALL_THIN")).toBe(true);
  const floating = check(joinSoup(cubeSoup(), cubeSoup([5, 5, 5], [20, 0, 12])));
  expect(floating.findings.some((f) => f.code === "UNSUPPORTED_ISLAND")).toBe(true);
  expect(floating.findings.some((f) => f.code === "OVERHANG_AREA")).toBe(true);
  expect(floating.findings.find((f) => f.code === "MULTIPLE_SHELLS")?.value).toBe(2);
});
it("is deterministic and marks zero-budget thickness work incomplete", () => {
  const soup = cubeSoup([10, 10, 0.6]);
  expect(check(soup).findings).toEqual(check(soup).findings);
  const result = runPrintChecks(weld(soup), params, 42, 0);
  expect(result.status).toBe("incomplete");
  expect(result.summary.thicknessSamples).toBe(0);
  expect(result.checks.find((r) => r.check === "walls")?.summary).toContain("Partly checked");
});
it("rotated findings map back to original mesh space", () => {
  const soup = cubeSoup([5, 5, 60]),
    q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const,
    result = runPrintChecks(weld(soup, q), params, 42, 15000, q);
  expect(result.orientation).toEqual(q);
  expect(result.findings.some((f) => f.code === "TALL_THIN")).toBe(false);
  for (const f of result.findings)
    if (f.location) expect(f.location.point[2]).toBeGreaterThanOrEqual(-1e-4);
});

it("bounds fragment findings while retaining the full row count", () => {
  const soup = joinSoup(
      ...Array.from({ length: 25 }, (_, i) => cubeSoup([0.3, 0.3, 0.3], [i * 2, 0, 0])),
    ),
    result = runPrintChecks(weld(soup), params, 42, 0);
  expect(result.findings.filter((f) => f.code === "FEATURE_BELOW_NOZZLE")).toHaveLength(20);
  expect(result.checks.find((c) => c.check === "small-features")?.findings).toBe(25);
  expect(result.truncated).toBe(true);
});
