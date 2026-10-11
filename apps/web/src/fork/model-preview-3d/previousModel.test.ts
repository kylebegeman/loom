import { describe, expect, it } from "vite-plus/test";
import { previousGeometry, type PreviewGeometry } from "./previousModel";

const current: PreviewGeometry = { revision: "one", size: [20, 30, 40], triangles: 12 };
describe("previous geometry metadata", () => {
  it("keeps only an actual prior revision retained by the viewer", () => {
    expect(previousGeometry(current, "two", true)).toBe(current);
    expect(previousGeometry(current, "one", true)).toBeNull();
    expect(previousGeometry(current, "two", false)).toBeNull();
  });
  it("has no prior geometry on the first load or after the hidden viewer is released", () => {
    expect(previousGeometry(null, "two", true)).toBeNull();
  });
});
