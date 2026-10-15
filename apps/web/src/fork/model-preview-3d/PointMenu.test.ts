import { describe, expect, it } from "vite-plus/test";
import { pointMenuPlacement } from "./PointMenu";

const stage = { left: 100, top: 50, width: 600, height: 400 };

describe("point menu placement", () => {
  it("opens toward the larger free side from the pick", () => {
    expect(pointMenuPlacement({ x: 100, y: 80, stage })).toEqual({
      left: 200,
      top: 130,
      side: "bottom",
      align: "start",
    });
    expect(pointMenuPlacement({ x: 500, y: 300, stage })).toMatchObject({
      side: "top",
      align: "end",
    });
  });

  it("keeps the anchor inside the canvas", () => {
    expect(pointMenuPlacement({ x: -20, y: 900, stage })).toMatchObject({ left: 108, top: 442 });
  });
});
