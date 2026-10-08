import * as Schema from "effect/Schema";
import { create } from "zustand";
import { resolveStorage } from "~/lib/storage";

const Selection = Schema.Struct({
  designId: Schema.String,
  view: Schema.Literals(["schematic", "pcb"]),
  layers: Schema.Literals(["front", "back", "all"]),
});
export type Selection = typeof Selection.Type;
const Preferences = Schema.Struct({
  selections: Schema.Record(Schema.String, Selection),
  trusted: Schema.Array(Schema.String),
  electronicsUrl: Schema.String,
});
const KEY = "loom:pcb-preview:preferences:v1";
const defaults = {
  selections: {},
  trusted: [],
  electronicsUrl: "",
} satisfies typeof Preferences.Type;
const decodePreferences = Schema.decodeSync(Schema.fromJsonString(Preferences));
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
}));
