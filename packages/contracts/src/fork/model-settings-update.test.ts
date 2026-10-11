import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DEFAULT_MODEL_PREVIEW_SETTINGS, ModelPreviewSettingsUpdate } from "./model-preview-3d.ts";
const decode = Schema.decodeUnknownSync(ModelPreviewSettingsUpdate);
it("accepts the legacy save payload without populating newer fields", () => {
  const legacy = {
    openscadPath: null,
    backend: "auto",
    renderTimeoutSeconds: 120,
    renderColors: false,
    maxFileMegabytes: 150,
    fabricationUrl: null,
    agentToolEnabled: true,
    buildPlate: { preset: "custom", customMm: [400, 300, 200] },
  };
  expect(decode(legacy)).toEqual(legacy);
});
it("preserves full newer saves including named surfaces and hidden presets", () => {
  const settings = {
    ...DEFAULT_MODEL_PREVIEW_SETTINGS,
    buildPlate: {
      ...DEFAULT_MODEL_PREVIEW_SETTINGS.buildPlate,
      preset: "custom" as const,
      customBedId: "custom-12345678",
      customBeds: [{ id: "custom-12345678", name: "Laser", volumeMm: [400, 300, null] as const }],
      hiddenPresets: ["prusa-mini" as const],
    },
  };
  expect(decode(settings)).toEqual(settings);
});
