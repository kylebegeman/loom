import { expect, it } from "vite-plus/test";
import { measurementLabel, measurementParts } from "./geometry";

it("changes distance labels and deltas without modifying millimetre points", () => {
  const measurement = {
    kind: "distance" as const,
    points: [
      { x: 0, y: 0 },
      { x: 12.7, y: 0 },
    ],
  };
  expect(measurementLabel(measurement, "mm")).toBe("12.70 mm (Δx 12.70, Δy 0.00)");
  expect(measurementLabel(measurement, "mil")).toBe("500.0 mil (Δx 500.0, Δy 0.0)");
  expect(measurementLabel(measurement, "in")).toBe("0.500 in (Δx 0.500, Δy 0.000)");
  expect(measurement.points[1]).toEqual({ x: 12.7, y: 0 });
});
it("keeps angle values in degrees while formatting vertex positions in the reading unit", () => {
  const measurement = {
    kind: "angle" as const,
    points: [
      { x: 25.4, y: 25.4 },
      { x: 12.7, y: 25.4 },
      { x: 12.7, y: 12.7 },
    ],
  };
  expect(measurementParts(measurement, "in")).toEqual({
    value: "90.0°",
    detail: "Vertex 0.500, 1.000 in",
  });
  expect(measurementLabel(measurement, "mil")).toBe("90.0°");
});
