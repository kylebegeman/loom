import {
  libraryLaunchChoice,
  libraryLaunchDefaults,
  libraryLaunchInputs,
  libraryLaunchRanking,
  libraryLaunchWarning,
  libraryPortableRecoveryPlan,
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
 * What a tap on a Library project in New task starts with: the computer and files the start
 * screen would preselect for the whole project, with its model and permissions. It ranks with
 * published copy health and the recent conversation index instead of asking each computer, so the
 * row hands this computer and copy to the start screen rather than letting it rank again. Null
 * when starting needs a decision first, such as no ready computer, files to prepare, restore or
 * choose, a copy that is behind or broken, required tools to check, or no model.
 */
export function libraryStartDefaults(input: {
  readonly project: LibraryProject;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly threads: readonly LibraryThreadSummary[];
  readonly hosts: readonly LibraryLaunchHost[];
  readonly remembered: readonly LibraryLaunchRememberedComputer[];
  readonly workingThreads: ReadonlyMap<EnvironmentId, number>;
  readonly configs: ReadonlyMap<EnvironmentId, ServerConfig>;
  readonly localProject: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => LegacyProjectSettingsFields | null;
}): LibraryStartDefaults | null {
  const { project } = input;
  if (project.archived || (project.profile?.requiredTools?.length ?? 0) > 0) return null;
  const copies = input.copies.filter(
    (copy) => copy.projectId === project.id && libraryLaunchCopyMatchesScope(project, copy, null),
  );
  const { computers } = libraryLaunchInputs({
    project,
    copies,
    hosts: input.hosts,
    remembered: input.remembered,
    workingThreads: input.workingThreads,
  });
  const ranking = libraryLaunchRanking({
    project,
    copies,
    computers,
    threads: input.threads.filter((thread) => thread.projectId === project.id),
    resourceId: null,
  });
  const { hostId, candidate } = libraryLaunchChoice({ ranking, hostId: null, copyId: null });
  if (hostId === null || candidate?.kind !== "copy") return null;
  const copy = copies.find((entry) => entry.id === candidate.copyId);
  if (copy?.state !== "ready" || libraryLaunchWarning(candidate, copy, null) !== null) return null;
  const recovery = libraryPortableRecoveryPlan({
    project,
    copies,
    destinationEnvironmentId: hostId,
    resourceIds: null,
  });
  if (recovery.kind !== "local" || recovery.copy.id !== copy.id) return null;
  // The start screen reads the local project the same way for the whole project.
  const repositories = libraryRepositories(project);
  const localProjectId =
    repositories.length === 1
      ? (copy.repositories.find((entry) => entry.resourceId === repositories[0]!.id)
          ?.localProjectId ?? null)
      : (copy.rootLocalProjectId ?? null);
  const config = input.configs.get(hostId) ?? null;
  const { defaultModel } = libraryConversationModels({
    config,
    projectDefaultSelection: project.profile?.defaultModelSelection ?? null,
    localProjectId,
    localProject: localProjectId ? input.localProject(hostId, localProjectId) : null,
    savedSelection: null,
  });
  if (defaultModel === null) return null;
  const runtimeMode = libraryLaunchDefaults({
    settings: config?.settings,
    localProjectId,
  }).runtimeMode;
  return {
    environmentId: hostId,
    copyId: copy.id,
    summary: [
      computers.find((computer) => computer.environmentId === hostId)?.label,
      defaultModel.label,
      RUNTIME_MODE_CHOICES.find((choice) => choice.mode === runtimeMode)?.label,
    ]
      .filter((part) => part !== undefined)
      .join(" · "),
  };
}
