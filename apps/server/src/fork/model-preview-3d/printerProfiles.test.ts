import { expect, it } from "@effect/vitest";
import { parseBambuProfile, parsePrusaIni, shapeFromPolygon } from "./printerProfiles.ts";
const id = "custom-12345678";
it("reads the real Bambu H2D bed and both nozzle reach rectangles", () => {
  const result = parseBambuProfile(
    {
      name: "Bambu Lab H2D 0.4 nozzle",
      printable_area: ["0x0", "350x0", "350x320", "0x320"],
      printable_height: "325",
      nozzle_diameter: ["0.4", "0.4"],
      extruder_printable_area: ["0x0,325x0,325x320,0x320", "25x0,350x0,350x320,25x320"],
      extruder_printable_height: ["320", "325"],
    },
    id,
  );
  expect(result.printer.volumeMm).toEqual([350, 320, 325]);
  expect(result.printer.nozzlesMm).toEqual([0.4]);
  expect(result.printer.zones).toEqual([
    {
      id: "nozzle-1",
      label: "Left nozzle",
      footprintMm: [325, 320],
      offsetMm: [0, 0],
      heightMm: 320,
    },
    { id: "nozzle-2", label: "Right nozzle", footprintMm: [325, 320], offsetMm: [25, 0] },
  ]);
});
it("keeps purge corners and refuses unresolved inheritance", () => {
  expect(
    parseBambuProfile(
      {
        printable_area: ["0x0", "256x0", "256x256", "0x256"],
        printable_height: "256",
        nozzle_diameter: ["0.4"],
        bed_exclude_area: ["0x0", "18x0", "18x28", "0x28"],
      },
      id,
    ).printer.excludedAreasMm[0],
  ).toEqual([
    [0, 0],
    [18, 0],
    [18, 28],
    [0, 28],
  ]);
  expect(() => parseBambuProfile({ inherits: "missing" }, id)).toThrow("could not find");
});
it("imports Prusa configs and refuses vendor bundles", () => {
  const result = parsePrusaIni(
    "bed_shape = 0x0,250x0,250x210,0x210\nmax_print_height = 220\nnozzle_diameter = 0.4,0.6\nprinter_model = MK4S",
    id,
  );
  expect(result.printer.volumeMm).toEqual([250, 210, 220]);
  expect(result.printer.nozzlesMm).toEqual([0.4, 0.6]);
  expect(() => parsePrusaIni("[printer:MK4S]\nbed_shape = 0x0,250x0,250x210,0x210", id)).toThrow(
    "single config",
  );
});
it("normalizes centred circles and warns for irregular polygons", () => {
  const points = Array.from(
    { length: 16 },
    (_, i) => [90 * Math.cos((i * Math.PI) / 8), 90 * Math.sin((i * Math.PI) / 8)] as const,
  );
  const shape = shapeFromPolygon(points);
  expect(shape.shape).toBe("round");
  expect(shape.volume[0]).toBeCloseTo(180);
  expect(shape.origin[0]).toBeCloseTo(-90);
  expect(
    shapeFromPolygon([
      [0, 0],
      [250, 0],
      [200, 150],
      [0, 210],
    ]).warnings,
  ).toHaveLength(1);
});
