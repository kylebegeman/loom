import { describe, expect, it } from "vite-plus/test";

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { FORK_PANELS, forkPanelSurface } from "./registry";

// Upstream's launcher and "+" menu letters (RightPanelTabs.tsx); fork panels never take them.
const UPSTREAM_LETTERS = new Set(["A", "B", "D", "F", "L", "M", "P", "T"]);

describe("fork right panels", () => {
  it("requires a thread and the environment feature for the model launcher", () => {
    const panel = FORK_PANELS.find((item) => item.id === "model-preview-3d")!;
    const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
    expect(panel.isAvailable({ threadRef, loomFeatures: [] })).toBe(false);
    expect(panel.isAvailable({ threadRef: null, loomFeatures: ["model-preview-3d"] })).toBe(false);
    expect(panel.isAvailable({ threadRef, loomFeatures: ["model-preview-3d"] })).toBe(true);
  });

  it("uses unique ids in the <slug> or <slug>:<name> form", () => {
    const ids = FORK_PANELS.map((panel) => panel.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !/^[a-z0-9-]+(:[a-z0-9-]+)?$/.test(id))).toEqual([]);
  });

  it("uses unique single uppercase launcher letters that upstream does not reserve", () => {
    const letters = FORK_PANELS.map((panel) => panel.shortcut).filter((letter) => letter !== "");
    expect(new Set(letters).size).toBe(letters.length);
    expect(letters.filter((letter) => !/^[A-Z]$/.test(letter))).toEqual([]);
    expect(letters.filter((letter) => UPSTREAM_LETTERS.has(letter))).toEqual([]);
  });

  it("builds stable surface ids", () => {
    expect(forkPanelSurface("snippets")).toEqual({
      id: "fork:snippets",
      kind: "fork",
      panelId: "snippets",
    });
    expect(forkPanelSurface("thread-lineage", "thread-1").id).toBe("fork:thread-lineage:thread-1");
  });
});
