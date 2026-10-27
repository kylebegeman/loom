import { describe, expect, it } from "vite-plus/test";
import {
  filterAvailableSettingsSearchItems,
  getSettingsSearchTargetScope,
  isSettingsSearchScopeAvailable,
  searchSettings,
} from "~/components/settings/settingsSearch";
import {
  forkSettingsSearchItems,
  forkSettingsTarget,
  legacyLoomSettingsTarget,
} from "./navigation";
import { FORK_SETTINGS_SECTIONS } from "./registry";

const AVAILABLE = {
  hasCloudPublicConfig: false,
  hasEnvironment: true,
  hasProviderSettingsEnvironment: true,
  hasMacProviderSettingsEnvironment: false,
  canManageLocalBackend: false,
  isWslSettingsRowVisible: false,
  hasThreadAutoSettlement: false,
};

describe("fork settings search", () => {
  it("offers every topic once, on its home page at its own anchor", () => {
    const items = forkSettingsSearchItems();
    expect(items.map((item) => item.targetId)).toEqual(
      FORK_SETTINGS_SECTIONS.map((section) => `loom-${section.id}`),
    );
    for (const section of FORK_SETTINGS_SECTIONS) {
      expect(items.find((item) => item.targetId === `loom-${section.id}`)?.to).toBe(section.home);
    }
  });

  it("finds topics from global settings search by their title and keywords", () => {
    const available = filterAvailableSettingsSearchItems(AVAILABLE);
    const ids = available.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(searchSettings("circuit boards", available)[0]).toMatchObject({
      targetId: "loom-pcb-preview",
      to: "/settings/tools",
    });
    expect(searchSettings("kicad", available).map((item) => item.targetId)).toContain(
      "loom-pcb-preview",
    );
    expect(searchSettings("panel picker", available)[0]).toMatchObject({
      to: "/settings/general",
    });
  });

  it("opens computer topics at any scope and asks for a project only where one is needed", () => {
    for (const id of ["project-lifecycle", "device-qa", "preview-links", "panel-picker"]) {
      const target = getSettingsSearchTargetScope(`loom-${id}`)!;
      expect(isSettingsSearchScopeAvailable(target.scope, "all")).toBe(true);
    }
    const profile = getSettingsSearchTargetScope("loom-project-profiles")!;
    expect(isSettingsSearchScopeAvailable(profile.scope, "all")).toBe(false);
    expect(isSettingsSearchScopeAvailable(profile.scope, "checkout")).toBe(true);
  });
});

describe("fork settings links", () => {
  it("sends each topic to its page and anchor, and unknown topics to Lanes", () => {
    expect(forkSettingsTarget("vault-github")).toEqual({
      to: "/settings/vault",
      hash: "loom-vault-github",
    });
    expect(forkSettingsTarget("model-preview-3d")).toEqual({
      to: "/settings/tools",
      hash: "loom-model-preview-3d",
    });
    expect(forkSettingsTarget("retired-topic")).toEqual({
      to: "/settings/worktrees",
      hash: "loom-project-lifecycle",
    });
  });

  it("resolves retired Loom page links by hash first, then section", () => {
    expect(
      legacyLoomSettingsTarget({
        search: { machine: "m", section: "vault-health" },
        hash: "#loom-preview-links",
      }),
    ).toEqual({ to: "/settings/access", search: { machine: "m" }, hash: "loom-preview-links" });
    expect(
      legacyLoomSettingsTarget({ search: { section: "apple-build-tooling" }, hash: "" }),
    ).toEqual({ to: "/settings/devices", search: {}, hash: "loom-apple-build-tooling" });
    expect(
      legacyLoomSettingsTarget({ search: { section: "mini-offload" }, hash: "loom-unknown" }),
    ).toEqual({ to: "/settings/connections", search: {}, hash: "loom-mini-offload" });
  });
});
