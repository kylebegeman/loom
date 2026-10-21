import {
  DEFAULT_RUNTIME_MODE,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { libraryLaunchDefaults } from "./library-launch-defaults.ts";

const localProjectId = ProjectId.make("computer-project");
const instanceId = ProviderInstanceId.make("codex");
const selection = (model: string): ModelSelection => ({
  instanceId,
  model,
  options: [{ id: "reasoningEffort", value: "high" }],
});
const computer = selection("computer");
const library = selection("library");
const local = selection("local");
const source = selection("source");
const settings = {
  ...DEFAULT_SERVER_SETTINGS,
  defaultModelSelection: computer,
  defaultRuntimeMode: "approval-required" as const,
  projectSettingsOverrides: {
    [localProjectId]: { defaultModelSelection: local, defaultRuntimeMode: "full-access" as const },
  },
};
const input = { settings, localProjectId, projectDefaultSelection: library };

describe("Library launch defaults shared by clients", () => {
  it("preserves explicit launch or source settings ahead of conflicting project and Library defaults", () => {
    expect(
      libraryLaunchDefaults({ ...input, selection: source, runtimeMode: "approval-required" }),
    ).toEqual({ modelSelection: source, runtimeMode: "approval-required" });
  });

  it("uses the computer-project override ahead of Library and computer defaults", () => {
    expect(libraryLaunchDefaults(input)).toEqual({
      modelSelection: local,
      runtimeMode: "full-access",
    });
  });

  it("uses the Library preference before the computer default without a model override", () => {
    expect(libraryLaunchDefaults({ ...input, localProjectId: null })).toEqual({
      modelSelection: library,
      runtimeMode: "approval-required",
    });
  });

  it("does not let unrelated project overrides suppress the Library preference", () => {
    expect(
      libraryLaunchDefaults({
        ...input,
        settings: {
          ...settings,
          projectSettingsOverrides: { [localProjectId]: { defaultRuntimeMode: "full-access" } },
        },
      }),
    ).toEqual({ modelSelection: library, runtimeMode: "full-access" });
  });

  it("keeps explicit null ahead of the Library and leaves provider fallback to the client", () => {
    expect(
      libraryLaunchDefaults({
        ...input,
        settings: {
          ...settings,
          projectSettingsOverrides: { [localProjectId]: { defaultModelSelection: null } },
        },
      }).modelSelection,
    ).toBeNull();
  });

  it("keeps legacy project defaults until their settings fold and then honors a reset", () => {
    const legacy = { defaultModelSelection: local };
    const unfolded = { ...settings, projectSettingsOverrides: {}, projectSettingsFolded: false };
    expect(
      libraryLaunchDefaults({ ...input, settings: unfolded, localProject: legacy }).modelSelection,
    ).toEqual(local);
    expect(
      libraryLaunchDefaults({
        ...input,
        settings: { ...unfolded, projectSettingsFolded: true },
        localProject: legacy,
      }).modelSelection,
    ).toEqual(library);
  });

  it("uses computer defaults before falling through to provider policy", () => {
    expect(libraryLaunchDefaults({ settings, localProjectId: null }).modelSelection).toEqual(
      computer,
    );
    expect(
      libraryLaunchDefaults({
        settings: { ...settings, defaultModelSelection: null },
        localProjectId: null,
      }).modelSelection,
    ).toBeNull();
  });

  it("provides built-in runtime defaults while computer settings are unavailable", () => {
    expect(libraryLaunchDefaults({ settings: null, localProjectId: null })).toEqual({
      modelSelection: null,
      runtimeMode: DEFAULT_RUNTIME_MODE,
    });
  });
});
