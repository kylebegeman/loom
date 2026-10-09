import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createMemoryStorage } from "~/lib/storage";

// The module caches one snapshot, so each test loads it fresh against its own storage.
async function loadWith(localStorage: unknown) {
  vi.resetModules();
  vi.stubGlobal("window", { localStorage });
  return import("./preferences");
}

afterEach(() => vi.unstubAllGlobals());

describe("panel picker preferences", () => {
  it("defaults both switches on when nothing is stored or storage throws", async () => {
    const empty = await loadWith(createMemoryStorage());
    expect(empty.readPanelPickerPreferences()).toEqual({
      enabled: true,
      shortcut: true,
      recents: [],
    });
    const throwing = await loadWith({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    expect(throwing.readPanelPickerPreferences().enabled).toBe(true);
    throwing.setPanelPickerEnabled(false);
    expect(throwing.readPanelPickerPreferences().enabled).toBe(false);
  });

  it("persists switches and keeps five recent labels, newest first, without duplicates", async () => {
    const storage = createMemoryStorage();
    const first = await loadWith(storage);
    first.setPanelPickerShortcut(false);
    for (const label of ["A", "B", "C", "D", "E", "F", "B"]) first.recordPanelPick(label);
    expect(first.readPanelPickerPreferences().recents).toEqual(["B", "F", "E", "D", "C"]);

    const reloaded = await loadWith(storage);
    expect(reloaded.readPanelPickerPreferences()).toEqual({
      enabled: true,
      shortcut: false,
      recents: ["B", "F", "E", "D", "C"],
    });
  });

  it("ignores a corrupt recents value", async () => {
    const storage = createMemoryStorage();
    storage.setItem("loom:panel-picker:recent:v1", "{not json");
    const preferences = await loadWith(storage);
    expect(preferences.readPanelPickerPreferences().recents).toEqual([]);
  });
});
