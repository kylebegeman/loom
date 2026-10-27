import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";
import {
  PrinterLibrary,
  PrinterExport,
  STARTER_MATERIALS,
  libraryProblems,
} from "./model-printers.ts";
import { DEFAULT_MODEL_PREVIEW_SETTINGS } from "./model-preview-3d.ts";
import { activeBed, listBeds, selectBed, fitBed, BUILT_IN_PRINTERS } from "./model-beds.ts";
const decodeLibrary = Schema.decodeUnknownSync(PrinterLibrary);
const decodeExport = Schema.decodeUnknownSync(Schema.fromJsonString(PrinterExport));
const printer = {
  id: "custom-12345678",
  name: "Delta",
  kind: "printer" as const,
  volumeMm: [200, 200, 300] as const,
  bedShape: "round" as const,
  nozzlesMm: [0.6],
  materialIds: ["generic-pla"],
  defaultMaterialId: "generic-pla",
  zones: [],
  excludedAreasMm: [],
  notes: "",
  source: { kind: "user" as const, app: null, profileName: null },
  basedOn: null,
};
const library: PrinterLibrary = {
  version: 1,
  printers: [printer],
  materials: STARTER_MATERIALS,
  hiddenBuiltIns: ["prusa-mini"],
};
describe("printer library", () => {
  it("round trips starter materials and portable exports with null prices", () => {
    expect(decodeLibrary({ ...library, future: true })).toEqual(library);
    expect(new Set(STARTER_MATERIALS.map((m) => m.id)).size).toBe(5);
    expect(STARTER_MATERIALS.every((m) => m.costPerKg === null)).toBe(true);
    const exported = {
      format: "loom.printers",
      version: 1,
      exportedAt: "2026-10-10",
      printers: library.printers,
      materials: library.materials,
    } as const;
    expect(decodeExport(JSON.stringify(exported))).toEqual(exported);
  });
  it("validates duplicates, references and nozzle reach", () => {
    expect(libraryProblems(library)).toEqual([]);
    expect(libraryProblems({ ...library, printers: [printer, printer] })).toContain(
      "Printer ids must be unique.",
    );
    expect(libraryProblems({ ...library, materials: [] })).toContain(
      "Delta: A selected material does not exist.",
    );
    expect(
      libraryProblems({ ...library, printers: [{ ...printer, defaultMaterialId: "missing" }] }),
    ).toContain("Delta: The default material must be selected for this printer.");
    expect(
      libraryProblems({
        ...library,
        printers: [
          {
            ...printer,
            zones: [{ id: "zone", label: "Left", footprintMm: [190, 200], offsetMm: [20, 0] }],
          },
        ],
      }),
    ).toContain("Delta: Left leaves the bed.");
  });
  it("keeps preset order and dimensions and preserves the active hidden bed", () => {
    const settings = DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate;
    const beds = listBeds(settings, { library });
    expect(beds.some((b) => b.id === "prusa-mini")).toBe(false);
    expect(beds.find((b) => b.id === printer.id)?.nozzlesMm).toEqual([0.6]);
    expect(Object.keys(BUILT_IN_PRINTERS)).toEqual(
      listBeds(settings)
        .slice(0, 14)
        .map((b) => b.id),
    );
    expect(
      listBeds({ ...settings, preset: "prusa-mini" }, { library }).some(
        (b) => b.id === "prusa-mini",
      ),
    ).toBe(true);
  });
  it("selects migrated ids without changing scratch size and falls back for a missing id", () => {
    const settings = DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate;
    const selected = selectBed(settings, printer.id, { library });
    expect(selected.customMm).toBe(settings.customMm);
    expect(activeBed(selected, { library }).bedShape).toBe("round");
    const legacy = {
      ...selected,
      customBeds: [{ id: printer.id, name: printer.name, volumeMm: printer.volumeMm }],
    };
    expect(activeBed(legacy).volumeMm).toEqual(activeBed(selected, { library }).volumeMm);
    expect(activeBed({ ...selected, customBedId: "custom-99999999" }, { library }).id).toBe(
      "custom",
    );
  });
  it("conservatively checks round footprints using their diagonal", () => {
    expect(fitBed([100, 100, 250], printer).fit.status).toBe("fits");
    expect(fitBed([150, 150, 250], printer).fit.status).toBe("too-big");
    expect(fitBed([100, 100, 350], printer).fit.status).toBe("too-big");
  });
});
