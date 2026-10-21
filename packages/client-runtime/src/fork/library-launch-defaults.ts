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

/** A cleared project default still overrides the Library; clients resolve provider fallbacks. */
export function libraryLaunchDefaults(input: {
  readonly settings: ServerSettings | null | undefined;
  readonly localProjectId: ProjectId | null;
  readonly localProject?: LegacyProjectSettingsFields | null | undefined;
  readonly projectDefaultSelection?: ModelSelection | null | undefined;
  readonly selection?: ModelSelection | null | undefined;
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
        : (input.projectDefaultSelection ?? resolved?.settings.defaultModelSelection ?? null)),
    runtimeMode: input.runtimeMode ?? resolved?.settings.defaultRuntimeMode ?? DEFAULT_RUNTIME_MODE,
  };
}
