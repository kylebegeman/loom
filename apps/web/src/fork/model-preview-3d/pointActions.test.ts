import { describe, expect, it } from "vite-plus/test";
import {
  coordinateText,
  pointActions,
  sectionAxisThrough,
  type PointContext,
} from "./pointActions";

const open: PointContext = { canPick: true, measurements: 0, pins: 0, markupLimit: 50 };
const actions = (pick: Parameters<typeof pointActions>[0], context = open) =>
  pointActions(pick, context).map((entry) => entry.action);

describe("model context menu actions", () => {
  it("offers every action on a face, in menu order", () => {
    expect(pointActions({ point: [1, 2, 3], face: [0, 0, 1] }, open)).toEqual([
      { action: "measure", label: "Measure from here" },
      { action: "pin", label: "Pin a change here" },
      { action: "center", label: "Center the view here" },
      { action: "section", label: "Section through here" },
      { action: "layFlat", label: "Lay this face flat" },
      { action: "copy", label: "Copy coordinates" },
    ]);
  });

  it("leaves out lay flat without a face and adds at the markup limit", () => {
    expect(actions({ point: [0, 0, 0] })).not.toContain("layFlat");
    expect(actions({ point: [0, 0, 0], face: [0, 0, 0] })).not.toContain("layFlat");
    expect(
      actions({ point: [0, 0, 0], face: [1, 0, 0] }, { ...open, measurements: 50, pins: 50 }),
    ).toEqual(["center", "section", "layFlat", "copy"]);
  });

  it("offers nothing without a working 3D view", () => {
    expect(actions({ point: [0, 0, 0] }, { ...open, canPick: false })).toEqual([]);
  });

  it("uses Loom's separate pin limit and keeps only view actions when editing is off", () => {
    const face = { point: [0, 0, 0], face: [0, 0, 1] } as const;
    expect(actions(face, { ...open, markupLimit: 100, pinLimit: 30, pins: 30 })).toEqual([
      "measure",
      "center",
      "section",
      "layFlat",
      "copy",
    ]);
    expect(actions(face, { ...open, canEdit: false })).toEqual(["center", "section", "copy"]);
    expect(actions(face, { ...open, canLayFlat: false })).not.toContain("layFlat");
  });

  it("turns the section off a face it would only skim", () => {
    expect(sectionAxisThrough([0, 0, 1], "z")).toBe("x");
    expect(sectionAxisThrough([0, 0, -2], "z")).toBe("x");
    expect(sectionAxisThrough([1, 0, 0], "x")).toBe("y");
    expect(sectionAxisThrough([0, 0, 1], "y")).toBe("y");
    expect(sectionAxisThrough([0.6, 0, 0.8], "z")).toBe("z");
    expect(sectionAxisThrough(undefined, "y")).toBe("y");
    expect(sectionAxisThrough(null, "y")).toBe("y");
  });

  it("copies the model-space point in display units and precision", () => {
    expect(coordinateText([1, -2.5, 25.4], "mm", "auto")).toBe("1.0 mm, -2.5 mm, 25.4 mm");
    expect(coordinateText([1, -2.5, 25.4], "mm", 0)).toBe("1 mm, -3 mm, 25 mm");
    expect(coordinateText([0, 12.7, 25.4], "in", 2)).toBe("0.00 in, 0.50 in, 1.00 in");
  });
});
