import { describe, expect, it } from "vite-plus/test";
import {
  filterLoomSettingsSections,
  loomSettingsSectionForHash,
  resolveLoomSettingsSection,
} from "./navigation";
import { FORK_SETTINGS_SECTIONS } from "./registry";

describe("finding Loom settings", () => {
  it("finds a topic from the controls it contains, ignoring case and extra spaces", () => {
    expect(
      filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, "  PANEL   shortcut  ").map((s) => s.id),
    ).toEqual(["panel-picker"]);
    expect(
      filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, "github repositories").map((s) => s.id),
    ).toContain("vault-github");
    expect(
      filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, "disk cleanup").map((s) => s.id),
    ).toEqual(["project-lifecycle"]);
  });

  it("requires all search terms and keeps topics available after clearing search", () => {
    expect(filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, "github nozzle")).toEqual([]);
    expect(filterLoomSettingsSections(FORK_SETTINGS_SECTIONS, " \t ")).toEqual(
      FORK_SETTINGS_SECTIONS,
    );
  });
});

describe("Loom topic selection", () => {
  it("opens every existing section link, including similarly named Vault sections", () => {
    for (const section of FORK_SETTINGS_SECTIONS) {
      expect(loomSettingsSectionForHash(FORK_SETTINGS_SECTIONS, `#loom-${section.id}`)).toBe(
        section.id,
      );
      expect(loomSettingsSectionForHash(FORK_SETTINGS_SECTIONS, `loom-${section.id}`)).toBe(
        section.id,
      );
    }
    expect(loomSettingsSectionForHash(FORK_SETTINGS_SECTIONS, "loom-vault-unknown")).toBeNull();
    expect(loomSettingsSectionForHash(FORK_SETTINGS_SECTIONS, "")).toBeNull();
  });

  it("restores a selected topic and falls back safely for absent or stale links", () => {
    expect(resolveLoomSettingsSection(FORK_SETTINGS_SECTIONS, "vault-github").id).toBe(
      "vault-github",
    );
    expect(resolveLoomSettingsSection(FORK_SETTINGS_SECTIONS, undefined).id).toBe(
      "project-lifecycle",
    );
    expect(resolveLoomSettingsSection(FORK_SETTINGS_SECTIONS, "retired-section").id).toBe(
      "project-lifecycle",
    );
  });
});
