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

  it("keeps legacy local project defaults until the server folds them into settings", () => {
    expect(
      libraryConversationModels({
        ...input,
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
    expect(libraryConversationModels({ ...input, savedSelection }).defaultModel?.selection).toEqual(
      savedSelection,
    );
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
