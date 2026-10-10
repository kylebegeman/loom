import { describe, expect, it } from "vite-plus/test";
import { resolveInspectorTab } from "./ModelInspector";

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
