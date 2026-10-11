import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  DEFAULT_MODEL_PREVIEW_SETTINGS,
  ModelPreviewSettings,
  modelFormatOf,
} from "./model-preview-3d.ts";
import { ModelEditorAction } from "./model-editor.ts";
import { ModelCamera } from "./model-workspace.ts";

const decodeSettings = Schema.decodeUnknownSync(ModelPreviewSettings);
const decodeEditor = Schema.decodeUnknownSync(ModelEditorAction);
const decodeCamera = Schema.decodeUnknownSync(ModelCamera);
const legacySettings = {
  openscadPath: null,
  backend: "auto",
  renderTimeoutSeconds: 120,
  renderColors: false,
  maxFileMegabytes: 150,
  buildPlate: DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate,
  fabricationUrl: null,
  agentToolEnabled: true,
};

it("loads old settings with millimetres and no scale reference", () => {
  expect(decodeSettings(legacySettings)).toEqual(DEFAULT_MODEL_PREVIEW_SETTINGS);
});

it("preserves display preferences and millimetre bed dimensions", () => {
  const settings = decodeSettings({
    ...legacySettings,
    displayUnits: "in",
    scaleReference: "coin-euro",
  });
  expect(settings.displayUnits).toBe("in");
  expect(settings.scaleReference).toBe("coin-euro");
  expect(settings.buildPlate.customMm).toEqual([350, 320, 325]);
});

it("rejects unsupported units and scale objects at the settings boundary", () => {
  expect(() => decodeSettings({ ...legacySettings, displayUnits: "cm" })).toThrow();
  expect(() => decodeSettings({ ...legacySettings, scaleReference: "ruler" })).toThrow();
});

it("lets agents show or remove known scale references and rejects unknown ones", () => {
  expect(decodeEditor({ action: "display", reference: "hand" }).reference).toBe("hand");
  expect(decodeEditor({ action: "display", reference: "none" }).reference).toBe("none");
  expect(() => decodeEditor({ action: "display", reference: "ruler" })).toThrow();
});

it("loads old overhang preferences and validates the threshold and camera toggle", () => {
  expect(decodeSettings(legacySettings).overhangAngleDegrees).toBe(45);
  for (const angle of [29, 71, 45.5])
    expect(() => decodeSettings({ ...legacySettings, overhangAngleDegrees: angle })).toThrow();
  expect(decodeSettings({ ...legacySettings, overhangAngleDegrees: 70 }).overhangAngleDegrees).toBe(
    70,
  );
  const oldCamera = {
    position: [1, 2, 3],
    target: [0, 0, 0],
    near: 0.1,
    far: 1000,
    wireframe: false,
    gridVisible: true,
    axesVisible: false,
    navigationMode: "orbit",
    section: { enabled: false, axis: "z", offset: 0, flipped: false },
  };
  expect(decodeCamera(oldCamera).overhangs).toBe(false);
  expect(decodeEditor({ action: "display", overhangs: true }).overhangs).toBe(true);
});

it("defaults legacy settings to offer agent models and rejects unknown modes", () => {
  expect(decodeSettings(legacySettings).agentModels).toBe("offer");
  for (const agentModels of ["offer", "open", "off"])
    expect(decodeSettings({ ...legacySettings, agentModels }).agentModels).toBe(agentModels);
  expect(() => decodeSettings({ ...legacySettings, agentModels: "always" })).toThrow();
});
it("recognizes shared model extensions without mistaking directories for extensions", () => {
  expect(modelFormatOf("part.STL")).toBe("stl");
  expect(modelFormatOf("a.stp")).toBe("step");
  expect(modelFormatOf("bracket.B3D.PY")).toBe("build123d");
  expect(modelFormatOf("helper.py")).toBeNull();
  expect(modelFormatOf("notes.txt")).toBeNull();
  expect(modelFormatOf("Makefile")).toBeNull();
  expect(modelFormatOf("folder.scad/Makefile")).toBeNull();
});
