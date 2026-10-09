import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

import { resolveStorage } from "~/lib/storage";

const ENABLED_KEY = "loom:panel-picker:enabled:v1";
const SHORTCUT_KEY = "loom:panel-picker:shortcut:v1";
const RECENT_KEY = "loom:panel-picker:recent:v1";
const RECENT_LIMIT = 5;

export interface PanelPickerPreferences {
  /** The compact picker replaces upstream's launcher and "+" menu. */
  readonly enabled: boolean;
  /** `mod+shift+'` opens the picker. */
  readonly shortcut: boolean;
  /** Labels of recently picked panels, newest first. */
  readonly recents: ReadonlyArray<string>;
}

const decodeRecents = Schema.decodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

// Client preferences only: every access tolerates missing or blocked storage.
function read(key: string): string | null {
  try {
    const raw = resolveStorage(window.localStorage).getItem(key);
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    resolveStorage(window.localStorage).setItem(key, value);
  } catch {
    /* The choice still applies for this session. */
  }
}
function load(): PanelPickerPreferences {
  let recents: ReadonlyArray<string> = [];
  try {
    const raw = read(RECENT_KEY);
    if (raw !== null) recents = decodeRecents(raw).slice(0, RECENT_LIMIT);
  } catch {
    recents = [];
  }
  return {
    enabled: read(ENABLED_KEY) !== "false",
    shortcut: read(SHORTCUT_KEY) !== "false",
    recents,
  };
}

let snapshot: PanelPickerPreferences | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const readPanelPickerPreferences = (): PanelPickerPreferences => (snapshot ??= load());

function update(patch: Partial<PanelPickerPreferences>) {
  snapshot = { ...readPanelPickerPreferences(), ...patch };
  for (const listener of listeners) listener();
}

export function usePanelPickerPreferences(): PanelPickerPreferences {
  return useSyncExternalStore(subscribe, readPanelPickerPreferences);
}

/** The seams' switch: true renders the picker instead of upstream's list and menu. */
export function useLoomPanelPicker(): { readonly enabled: boolean } {
  const enabled = useSyncExternalStore(subscribe, () => readPanelPickerPreferences().enabled);
  return { enabled };
}

export function setPanelPickerEnabled(enabled: boolean) {
  write(ENABLED_KEY, String(enabled));
  update({ enabled });
}

export function setPanelPickerShortcut(shortcut: boolean) {
  write(SHORTCUT_KEY, String(shortcut));
  update({ shortcut });
}

export function recordPanelPick(label: string) {
  const recents = [label, ...readPanelPickerPreferences().recents.filter((l) => l !== label)].slice(
    0,
    RECENT_LIMIT,
  );
  write(RECENT_KEY, JSON.stringify(recents));
  update({ recents });
}
