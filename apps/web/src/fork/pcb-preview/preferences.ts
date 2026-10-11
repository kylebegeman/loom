import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { resolveStorage } from "~/lib/storage";
import { PcbLengthUnit } from "./length";

const Selection = Schema.Struct({
  designId: Schema.String,
  view: Schema.Literals(["schematic", "pcb"]),
  layers: Schema.Literals(["front", "back", "all"]),
});
export type Selection = typeof Selection.Type;
// Saved preferences outlive releases: a field added later must not reset trust and selections.
const Preferences = Schema.Struct({
  selections: Schema.Record(Schema.String, Selection).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  trusted: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  electronicsUrl: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  lengthUnit: PcbLengthUnit.pipe(Schema.withDecodingDefault(Effect.succeed("mm"))),
  hiddenLayerPresets: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  checkMarkers: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  pngScale: Schema.Literals([1, 2]).pipe(Schema.withDecodingDefault(Effect.succeed(2))),
});
const KEY = "loom:pcb-preview:preferences:v1";
const defaults = {
  selections: {},
  trusted: [],
  electronicsUrl: "",
  lengthUnit: "mm",
  hiddenLayerPresets: [],
  pngScale: 2,
  checkMarkers: true,
} satisfies typeof Preferences.Type;
export const decodePreferences = Schema.decodeSync(Schema.fromJsonString(Preferences));
function load() {
  try {
    const raw = resolveStorage(window.localStorage).getItem(KEY);
    return typeof raw === "string" ? decodePreferences(raw) : defaults;
  } catch {
    return defaults;
  }
}
function save(value: typeof Preferences.Type) {
  try {
    resolveStorage(window.localStorage).setItem(KEY, JSON.stringify(value));
  } catch {
    /* Preview still works when device storage is unavailable. */
  }
}
export const projectPreferenceKey = (environmentId: string, projectId: string) =>
  JSON.stringify([environmentId, projectId]);
export const usePcbPreferences = create<
  typeof Preferences.Type & {
    select: (key: string, value: Selection) => void;
    trust: (key: string, trusted: boolean) => void;
    setElectronicsUrl: (value: string) => void;
    setLengthUnit: (unit: PcbLengthUnit) => void;
    setHiddenLayerPresets: (ids: readonly string[]) => void;
    setPngScale: (scale: 1 | 2) => void;
    setCheckMarkers: (enabled: boolean) => void;
  }
>((set, get) => ({
  ...load(),
  select: (key, value) => {
    const entries = Object.entries({ ...get().selections, [key]: value })
      .filter(([k]) => k !== key)
      .slice(-99);
    const selections = Object.fromEntries([...entries, [key, value]]);
    const next = { ...get(), selections };
    save(next);
    set({ selections });
  },
  trust: (key, enabled) => {
    const trusted = get()
      .trusted.filter((k) => k !== key)
      .slice(-99);
    if (enabled) trusted.push(key);
    const next = { ...get(), trusted };
    save(next);
    set({ trusted });
  },
  setElectronicsUrl: (electronicsUrl) => {
    const next = { ...get(), electronicsUrl };
    save(next);
    set({ electronicsUrl });
  },
  setLengthUnit: (lengthUnit) => {
    save({ ...get(), lengthUnit });
    set({ lengthUnit });
  },
  setHiddenLayerPresets: (ids) => {
    const hiddenLayerPresets = [...new Set(ids)];
    save({ ...get(), hiddenLayerPresets });
    set({ hiddenLayerPresets });
  },
  setCheckMarkers: (checkMarkers) => {
    save({ ...get(), checkMarkers });
    set({ checkMarkers });
  },
  setPngScale: (pngScale) => {
    save({ ...get(), pngScale });
    set({ pngScale });
  },
}));
/** The device's PCB display unit. Geometry and agent tools stay in millimetres. */
export const useLengthUnit = () => usePcbPreferences((s) => s.lengthUnit);
