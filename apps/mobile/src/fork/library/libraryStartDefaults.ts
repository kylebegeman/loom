import {
  libraryLaunchDefaults,
  libraryLaunchInputs,
  libraryQuickLaunch,
  type LibraryLaunchHost,
  type LibraryLaunchRememberedComputer,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ProjectId, ServerConfig } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LegacyProjectSettingsFields } from "@t3tools/shared/projectSettings";
import { RUNTIME_MODE_CHOICES } from "../../features/threads/thread-settings-options";
import { libraryLaunchCopyMatchesScope } from "./libraryLaunchFiles";
import { libraryRepositories } from "./libraryLogic";
import { libraryConversationModels } from "./libraryModels";

export interface LibraryStartDefaults {
  readonly environmentId: EnvironmentId;
  readonly copyId: string;
  /** For example "Dorothy · GPT 6.0 Astra · Full access". */
  readonly summary: string;
}

/**
 * What a tap on a Library project in New task starts with: the computer and files web's project
 * list promises for the same project, with the model and permissions the start screen picks there.
 * The row hands that computer and copy to the start screen rather than letting it rank again. Null
 * when starting needs a decision first, or when the start screen would not start there as it is.
 */
export function libraryStartDefaults(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly threads: readonly LibraryThreadSummary[];
  readonly hosts: readonly LibraryLaunchHost[];
  readonly remembered: readonly LibraryLaunchRememberedComputer[];
  /** Computers this device may start conversations on. */
  readonly operable: ReadonlySet<EnvironmentId>;
  readonly configs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly localProject: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => LegacyProjectSettingsFields | null;
}): LibraryStartDefaults | null {
  const { project } = input;
  // Ranked without working threads, as web ranks, so a row never moves as threads start and stop.
  const { computers } = libraryLaunchInputs({
    project,
    copies: [],
    hosts: input.hosts,
    remembered: input.remembered,
    workingThreads: new Map(),
  });
  const quick = libraryQuickLaunch({
    project,
    copies: input.copies,
    computers,
    threads: input.threads,
  });
  if (quick === null) return null;
  const { environmentId, copy } = quick;
  // The start screen runs work only where this device has conversation access.
  if (!input.operable.has(environmentId)) return null;
  // The start screen offers whole-project files only when their repositories match the project
  // exactly, so a folder still holding a removed repository needs a choice there.
  if (!libraryLaunchCopyMatchesScope(project, copy, null)) return null;
  // The start screen reads the local project the same way for the whole project.
  const repositories = libraryRepositories(project);
  const localProjectId =
    repositories.length === 1
      ? (copy.repositories.find((entry) => entry.resourceId === repositories[0]!.id)
          ?.localProjectId ?? null)
      : (copy.rootLocalProjectId ?? null);
  const config = input.configs.get(environmentId) ?? null;
  const { defaultModel } = libraryConversationModels({
    config,
    projectDefaultSelection: project.profile?.defaultModelSelection ?? null,
    localProjectId,
    localProject: localProjectId ? input.localProject(environmentId, localProjectId) : null,
    savedSelection: null,
  });
  if (defaultModel === null) return null;
  const runtimeMode = libraryLaunchDefaults({
    settings: config?.settings,
    localProjectId,
  }).runtimeMode;
  return {
    environmentId,
    copyId: copy.id,
    summary: [
      quick.label,
      defaultModel.label,
      RUNTIME_MODE_CHOICES.find((choice) => choice.mode === runtimeMode)?.label,
    ]
      .filter((part) => part !== undefined)
      .join(" · "),
  };
}
