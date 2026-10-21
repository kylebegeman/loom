import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  type ModelSelection,
  type ServerConfig,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { libraryConversationModels } from "./libraryModels";

const instanceId = ProviderInstanceId.make("codex");
const selection = (model: string): ModelSelection => ({ instanceId, model });
const config = {
  settings: {
    ...DEFAULT_SERVER_SETTINGS,
    defaultModelSelection: selection("environment"),
  },
  providers: [
    {
      instanceId,
      driver: "codex",
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      models: ["provider", "environment", "project", "local", "saved"].map((slug) => ({
        slug,
        name: slug,
        isDefault: slug === "provider",
        capabilities: null,
      })),
    },
  ],
} as unknown as ServerConfig;
const input = { config, projectDefaultSelection: null, localProjectId: null, savedSelection: null };

describe("library conversation model defaults", () => {
  it("uses the project model before environment and provider defaults, preserving options", () => {
    const preferred = {
      ...selection("project"),
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    expect(
      libraryConversationModels({
        ...input,
        projectDefaultSelection: preferred,
      }).defaultModel?.selection,
    ).toEqual(preferred);
  });

  it("resolves the selected computer's project override before its environment default", () => {
    const localProjectId = ProjectId.make("local-project");
    expect(
      libraryConversationModels({
        ...input,
        localProjectId,
        config: {
          ...config,
          settings: {
            ...config.settings,
            projectSettingsOverrides: {
              [localProjectId]: { defaultModelSelection: selection("local") },
            },
          },
        },
      }).defaultModel?.selection,
    ).toEqual(selection("local"));
    expect(libraryConversationModels(input).defaultModel?.selection).toEqual(
      selection("environment"),
    );
  });

  it("prefers an explicit computer-project model over a conflicting Library preference", () => {
    const localProjectId = ProjectId.make("local-project");
    const chosen = {
      ...selection("local"),
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    expect(
      libraryConversationModels({
        ...input,
        projectDefaultSelection: selection("project"),
        localProjectId,
        config: {
          ...config,
          settings: {
            ...config.settings,
            projectSettingsOverrides: {
              [localProjectId]: { defaultModelSelection: chosen },
            },
          },
        },
      }).defaultModel?.selection,
    ).toEqual(chosen);
  });

  it("respects a cleared computer-project model instead of restoring the Library preference", () => {
    const localProjectId = ProjectId.make("local-project");
    expect(
      libraryConversationModels({
        ...input,
        projectDefaultSelection: selection("project"),
        localProjectId,
        config: {
          ...config,
          settings: {
            ...config.settings,
            projectSettingsOverrides: {
              [localProjectId]: { defaultModelSelection: null },
            },
          },
        },
      }).defaultModel?.selection,
    ).toEqual(selection("provider"));
  });

  it("keeps legacy local project defaults until the server folds them into settings", () => {
    expect(
      libraryConversationModels({
        ...input,
        projectDefaultSelection: selection("project"),
        localProjectId: ProjectId.make("legacy"),
        localProject: { defaultModelSelection: selection("local") },
        config: { ...config, settings: { ...config.settings, projectSettingsFolded: false } },
      }).defaultModel?.selection,
    ).toEqual(selection("local"));
  });

  it("falls back from a hidden default to a visible model", () => {
    expect(
      libraryConversationModels({
        ...input,
        projectDefaultSelection: selection("project"),
        config: {
          ...config,
          settings: {
            ...config.settings,
            providerModelPreferences: {
              [instanceId]: { hiddenModels: ["project"], modelOrder: [] },
            },
          },
        },
      }).defaultModel?.selection,
    ).toEqual(selection("provider"));
  });

  it("keeps the saved model and its options when resuming preparation", () => {
    const savedSelection = {
      ...selection("saved"),
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    const localProjectId = ProjectId.make("local-project");
    expect(
      libraryConversationModels({
        ...input,
        savedSelection,
        projectDefaultSelection: selection("project"),
        localProjectId,
        config: {
          ...config,
          settings: {
            ...config.settings,
            projectSettingsOverrides: {
              [localProjectId]: { defaultModelSelection: selection("local") },
            },
          },
        },
      }).defaultModel?.selection,
    ).toEqual(savedSelection);
  });

  it("leaves no model available when this project's only provider is disabled", () => {
    const localProjectId = ProjectId.make("local-project");
    const result = libraryConversationModels({
      ...input,
      projectDefaultSelection: selection("project"),
      localProjectId,
      config: {
        ...config,
        settings: {
          ...config.settings,
          projectSettingsOverrides: {
            [localProjectId]: { providerInstances: { [instanceId]: { enabled: false } } },
          },
        },
      },
    });
    expect(result.models).toEqual([]);
    expect(result.defaultModel).toBeNull();
  });

  it("does not launch with a saved model whose provider has become disabled", () => {
    const result = libraryConversationModels({
      ...input,
      savedSelection: selection("saved"),
      config: {
        ...config,
        settings: {
          ...config.settings,
          providerInstances: {
            ...config.settings.providerInstances,
            [instanceId]: { ...config.settings.providerInstances[instanceId]!, enabled: false },
          },
        },
      },
    });
    expect(result.defaultModel).toBeNull();
    expect(result.models).toEqual([]);
  });

  it("falls back when the project's provider cannot run on the chosen computer", () => {
    expect(
      libraryConversationModels({
        ...input,
        projectDefaultSelection: {
          instanceId: ProviderInstanceId.make("other-computer"),
          model: "unavailable",
        },
      }).defaultModel?.selection,
    ).toEqual(selection("environment"));
  });
});
