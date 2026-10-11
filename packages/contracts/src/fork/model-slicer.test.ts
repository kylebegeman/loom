import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DEFAULT_SLICER_SETTINGS, SlicerSettings, SliceResult } from "./model-slicer.ts";
const decode = Schema.decodeUnknownSync(SlicerSettings),
  decodeResult = Schema.decodeUnknownSync(SliceResult);
it("fills partial path defaults and validates timeouts, currencies and mapping limits", () => {
  expect(decode({ ...DEFAULT_SLICER_SETTINGS, paths: { "bambu-studio": "/bambu" } }).paths).toEqual(
    { "bambu-studio": "/bambu", "orca-slicer": null, "prusa-slicer": null },
  );
  for (const invalid of [{ currency: "usd" }, { timeoutSeconds: 10 }, { timeoutSeconds: 4000 }])
    expect(() => decode({ ...DEFAULT_SLICER_SETTINGS, ...invalid })).toThrow();
  const mapping = {
    app: "prusa-slicer",
    machine: { source: "imported", name: "printer.ini" },
    process: null,
    filaments: [],
  };
  expect(() =>
    decode({
      ...DEFAULT_SLICER_SETTINGS,
      mappings: Object.fromEntries(Array.from({ length: 65 }, (_, index) => [index, mapping])),
    }),
  ).toThrow();
});
it("decodes a cached-only miss without projects or estimates", () => {
  const result = {
    status: "none",
    key: null,
    cached: false,
    durationMs: 0,
    bedId: "bambu-h2d",
    app: null,
    appVersion: null,
    profiles: null,
    estimate: null,
    orientationApplied: null,
    warnings: [],
    log: [],
    project: null,
    layers: null,
  };
  expect(decodeResult(result)).toEqual(result);
});
