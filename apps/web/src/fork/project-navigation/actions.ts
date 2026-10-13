import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

type ProjectDestination = { readonly environmentId: EnvironmentId; readonly id: ProjectId };

export function resolveProjectLibraryNewThreadTarget<TProject extends ProjectDestination>(input: {
  readonly memberProjects: readonly TProject[];
  readonly representative: ProjectDestination;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly permittedEnvironmentIds: ReadonlySet<EnvironmentId>;
}): TProject | null {
  const eligible = (project: TProject) =>
    input.connectedEnvironmentIds.has(project.environmentId) &&
    input.permittedEnvironmentIds.has(project.environmentId);
  return (
    input.memberProjects.find(
      (project) =>
        project.id === input.representative.id &&
        project.environmentId === input.representative.environmentId &&
        eligible(project),
    ) ??
    input.memberProjects.find(eligible) ??
    null
  );
}
