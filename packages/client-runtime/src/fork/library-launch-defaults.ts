import {
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  resolveProjectSettings,
  type LegacyProjectSettingsFields,
} from "@t3tools/shared/projectSettings";

/**
 * The model a Library start opens with: an explicit choice, then the computer's setting for this
 * project, then the Library project's default, then the model this client used last, then the
 * computer's default. A cleared project default still overrides the rest; clients resolve
 * provider fallbacks.
 */
export function libraryLaunchDefaults(input: {
  readonly settings: ServerSettings | null | undefined;
  readonly localProjectId: ProjectId | null;
  readonly localProject?: LegacyProjectSettingsFields | null | undefined;
  readonly projectDefaultSelection?: ModelSelection | null | undefined;
  readonly selection?: ModelSelection | null | undefined;
  /** The client's last-used model, as new upstream drafts get it. */
  readonly lastUsedSelection?: ModelSelection | null | undefined;
  readonly runtimeMode?: RuntimeMode | null | undefined;
}) {
  const resolved = input.settings
    ? resolveProjectSettings(input.settings, input.localProjectId, input.localProject)
    : null;
  return {
    modelSelection:
      input.selection ??
      (resolved?.sources.defaultModelSelection === "project"
        ? resolved.settings.defaultModelSelection
        : (input.projectDefaultSelection ??
          input.lastUsedSelection ??
          resolved?.settings.defaultModelSelection ??
          null)),
    runtimeMode: input.runtimeMode ?? resolved?.settings.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE,
  };
}
