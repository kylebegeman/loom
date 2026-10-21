import type { ModelSelection, ProjectId, ServerConfig } from "@t3tools/contracts";
import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";
import {
  buildModelOptions,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
} from "../../lib/modelOptions";

export function libraryConversationModels(input: {
  config: ServerConfig | null;
  projectDefaultSelection: ModelSelection | null;
  localProject?: LegacyProjectSettingsFields | null;
  localProjectId: ProjectId | null;
  savedSelection: ModelSelection | null;
}) {
  const { config, localProjectId } = input;
  const localDefault = config?.settings
    ? resolveProjectSettings(config.settings, localProjectId, input.localProject).settings
        .defaultModelSelection
    : null;
  const preferred =
    resolveDefaultableModelSelection(config, input.projectDefaultSelection, localProjectId) ??
    resolveDefaultableModelSelection(config, localDefault, localProjectId);
  const models = buildModelOptions(
    config,
    input.savedSelection ?? preferred,
    undefined,
    localProjectId,
  ).filter((model) => !model.isHidden && !model.isUnavailable);
  const selection = resolveNewTaskModelSelection({
    modelOptions: models,
    draftSelection: input.savedSelection,
    projectDefaultSelection: models.some(
      (model) =>
        model.selection.instanceId === preferred?.instanceId &&
        model.selection.model === preferred?.model,
    )
      ? preferred
      : null,
    stickySelection: null,
  });
  return {
    models,
    defaultModel:
      models.find(
        (model) =>
          model.selection.instanceId === selection?.instanceId &&
          model.selection.model === selection?.model,
      ) ?? null,
  };
}
