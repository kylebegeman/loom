import { describe, expect, it } from "vite-plus/test";
import { dimensionDelta, resolveInspectorTab } from "./ModelInspector";

describe("resolveInspectorTab", () => {
  it("accepts current tab names the file has", () => {
    expect(resolveInspectorTab("variants", true)).toBe("variants");
    expect(resolveInspectorTab("views", false)).toBe("views");
  });

  it("maps tab names from the first inspector", () => {
    expect(resolveInspectorTab("parameters", true)).toBe("customize");
    expect(resolveInspectorTab("review", false)).toBe("markup");
    expect(resolveInspectorTab("tools", false)).toBe("markup");
    expect(resolveInspectorTab("log", false)).toBe("part");
  });

  it("rejects SCAD-only tabs for meshes and unknown names", () => {
    expect(resolveInspectorTab("customize", false)).toBeNull();
    expect(resolveInspectorTab("parameters", false)).toBeNull();
    expect(resolveInspectorTab("settings", true)).toBeNull();
    expect(resolveInspectorTab(null, true)).toBeNull();
  });
});

describe("dimensionDelta", () => {
  it("formats signed dimension changes in the active display units", () => {
    expect(dimensionDelta(12, 10)).toBe("+2.0 mm");
    expect(dimensionDelta(8.5, 10)).toBe("−1.5 mm");
    expect(dimensionDelta(50.8, 25.4, "in")).toBe("+1.00 in");
    expect(dimensionDelta(25.4, 50.8, "in")).toBe("−1.00 in");
  });
  it("drops unchanged axes and noise below 0.05 mm without losing the boundary", () => {
    expect(dimensionDelta(10, 10)).toBeNull();
    expect(dimensionDelta(10.049, 10)).toBeNull();
    expect(dimensionDelta(9.951, 10)).toBeNull();
    expect(dimensionDelta(2.05, 2)).toBe("+0.1 mm");
    expect(dimensionDelta(Number.NaN, 10)).toBeNull();
  });
});
