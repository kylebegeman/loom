import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, ModelPreviewSettings } from "./model-preview-3d.ts";
import { ModelEditorAction } from "./model-editor.ts";

const decodeSettings = Schema.decodeUnknownSync(ModelPreviewSettings);
const decodeEditor = Schema.decodeUnknownSync(ModelEditorAction);
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
