import { expect, it } from "vite-plus/test";
import { announcement, type AnnounceInput } from "./announce";
const initial: AnnounceInput = {
  file: "part.stl",
  geometryRevision: "",
  stats: null,
  fits: null,
  bedLabel: "H2D",
  stale: false,
  hint: null,
  tool: null,
  navigationMode: "orbit",
  view: null,
  projection: "perspective",
  success: null,
  formatSize: (size) => size.join(" × ") + " mm",
};
const loaded: AnnounceInput = {
  ...initial,
  geometryRevision: "one",
  stats: { size: [42, 30, 12], triangles: 1234 },
  fits: true,
};
it("announces a completed load and its units and bed fit before simultaneous mode changes", () => {
  expect(announcement(initial, { ...loaded, navigationMode: "pan" })).toBe(
    "part.stl loaded. 42 × 30 × 12 mm, 1,234 triangles. Fits the bed (H2D).",
  );
  expect(announcement(null, { ...loaded, fits: false, formatSize: () => "1.0 in" })).toBe(
    "part.stl loaded. 1.0 in, 1,234 triangles. Larger than the bed (H2D).",
  );
  expect(announcement(null, initial)).toBeNull();
  expect(announcement(loaded, loaded)).toBeNull();
});
it("announces stale previews, changed fit and capture results once", () => {
  expect(announcement(loaded, { ...loaded, stale: true })).toBe("Showing the last good version.");
  expect(announcement(loaded, { ...loaded, fits: false, bedLabel: "A1 mini" })).toBe(
    "Larger than the bed (A1 mini).",
  );
  expect(announcement(loaded, { ...loaded, success: "Image copied." })).toBe("Image copied.");
});
it("announces tools, modes, standard views and projection but stays quiet during camera steps", () => {
  expect(announcement(loaded, { ...loaded, tool: "measure", hint: "Click the first point" })).toBe(
    "Click the first point",
  );
  expect(announcement({ ...loaded, tool: "measure" }, loaded)).toBe("Measure off");
  expect(announcement(loaded, { ...loaded, navigationMode: "pan" })).toBe("Pan mode");
  expect(announcement({ ...loaded, navigationMode: "pan" }, loaded)).toBe("Orbit mode");
  expect(announcement(loaded, { ...loaded, view: "front" })).toBe("Front view");
  expect(announcement(loaded, { ...loaded, projection: "orthographic" })).toBe("Orthographic");
  expect(announcement(loaded, { ...loaded })).toBeNull();
});
