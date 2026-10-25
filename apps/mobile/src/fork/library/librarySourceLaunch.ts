import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
} from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { libraryRepositories } from "./libraryLogic";

export interface LibrarySourceSettings {
  readonly modelSelection: ModelSelection;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export type LibrarySourceContext = {
  readonly projectId: string;
  readonly environmentId: EnvironmentId;
  readonly workingCopyId?: string | null;
  readonly resourceIds: readonly string[] | null;
};

export function librarySourceLaunchParams(
  source: EnvironmentThreadShell,
  context: LibrarySourceContext,
  project: LibraryProject,
) {
  // A Library conversation runs in its copy's folder, so the source's branch or worktree is not
  // carried over. The form cannot select a partial multi-repository scope.
  if (context.environmentId !== source.environmentId || context.projectId !== project.id)
    return null;
  const repositories = libraryRepositories(project);
  const resourceIds = context.resourceIds?.length
    ? context.resourceIds
    : repositories.map((resource) => resource.id);
  if (resourceIds.some((id) => !repositories.some((resource) => resource.id === id))) return null;
  if (
    resourceIds.length !== 1 &&
    (resourceIds.length !== repositories.length ||
      repositories.some((resource) => !resourceIds.includes(resource.id)))
  )
    return null;
  return {
    projectId: context.projectId,
    reuseEnvironmentId: source.environmentId,
    ...(context.workingCopyId ? { initialCopyId: context.workingCopyId } : {}),
    ...(resourceIds.length === 1 ? { initialResourceId: resourceIds[0]! } : {}),
    sourceThreadId: source.id,
    launchSettings: {
      modelSelection: source.modelSelection,
      runtimeMode: source.runtimeMode,
      interactionMode: source.interactionMode,
    },
  };
}

export function sourceConversationSettings(source: EnvironmentThreadShell) {
  return {
    modelSelection: source.modelSelection,
    runtimeMode: source.runtimeMode,
    interactionMode: source.interactionMode,
    // Creating an empty thread reuses this checkout, including a lane's worktree.
    branch: source.branch,
    worktreePath: source.worktreePath,
  };
}

export function librarySourceProjectContext(
  source: Pick<EnvironmentThreadShell, "environmentId" | "projectId">,
  copies: readonly LibraryWorkingCopy[],
): LibrarySourceContext | null {
  const matches = copies.flatMap((copy) => {
    if (
      copy.environmentId !== source.environmentId ||
      copy.registered === false ||
      copy.state === "released"
    )
      return [];
    const root = copy.rootLocalProjectId === source.projectId;
    const resources = copy.repositories.filter(
      (repository) => repository.localProjectId === source.projectId,
    );
    if (!root && resources.length !== 1) return [];
    return [
      {
        projectId: copy.projectId,
        environmentId: copy.environmentId,
        workingCopyId: copy.id,
        resourceIds: root ? null : resources.map((repository) => repository.resourceId),
      },
    ];
  });
  if (
    !matches.length ||
    new Set(matches.map((entry) => entry.projectId)).size !== 1 ||
    new Set(
      matches.map((entry) =>
        JSON.stringify(entry.resourceIds ? [...entry.resourceIds].sort() : null),
      ),
    ).size !== 1
  )
    return null;
  return matches[0]!;
}
