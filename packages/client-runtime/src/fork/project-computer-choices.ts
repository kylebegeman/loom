import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

interface ComputerChoiceProject {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly workspaceRoot: string;
  readonly environmentLabel?: string | null;
}

export const projectHomeComputerChoiceKey = (project: {
  readonly environmentId: string;
  readonly id: string;
}) => JSON.stringify([project.environmentId, project.id]);

function uniqueIdentity(identity: string, peers: readonly string[]) {
  let length = 8;
  while (
    length < identity.length &&
    peers.some((peer) => peer !== identity && peer.slice(0, length) === identity.slice(0, length))
  )
    length++;
  return identity.slice(0, length);
}

/** Concise picker labels retain enough folder context to distinguish the exact checkout. */
export function buildProjectHomeComputerChoices(input: {
  readonly projects: readonly ComputerChoiceProject[];
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly permittedEnvironmentIds: ReadonlySet<EnvironmentId>;
}) {
  const name = (project: ComputerChoiceProject) =>
    input.environmentLabels.get(project.environmentId) ?? project.environmentLabel ?? "Computer";
  const computerFolders = new Map<EnvironmentId, number>();
  const namedComputers = new Map<string, Set<EnvironmentId>>();
  for (const project of input.projects) {
    computerFolders.set(
      project.environmentId,
      (computerFolders.get(project.environmentId) ?? 0) + 1,
    );
    const ids = namedComputers.get(name(project)) ?? new Set<EnvironmentId>();
    ids.add(project.environmentId);
    namedComputers.set(name(project), ids);
  }
  const suffix = (path: string, length: number) =>
    path
      .split(/[\\/]+/)
      .filter(Boolean)
      .slice(-length)
      .join("/") || path;
  return input.projects.map((project) => {
    const computer = name(project);
    const includeFolder =
      (computerFolders.get(project.environmentId) ?? 0) > 1 ||
      (namedComputers.get(computer)?.size ?? 0) > 1;
    const peers = input.projects.filter((peer) => name(peer) === computer);
    const sameFolder = peers.filter((peer) => peer.workspaceRoot === project.workspaceRoot);
    const identities: string[] = [];
    if (sameFolder.some((peer) => peer.environmentId !== project.environmentId)) {
      identities.push(
        uniqueIdentity(
          project.environmentId,
          sameFolder.map((peer) => peer.environmentId),
        ),
      );
    }
    const sameComputerFolder = sameFolder.filter(
      (peer) => peer.environmentId === project.environmentId,
    );
    if (sameComputerFolder.some((peer) => peer.id !== project.id)) {
      identities.push(
        uniqueIdentity(
          project.id,
          sameComputerFolder.map((peer) => peer.id),
        ),
      );
    }
    const identity = identities.length > 0 ? ` (${identities.join(", ")})` : "";
    let folderLength = 1;
    const maximumLength = project.workspaceRoot.split(/[\\/]+/).filter(Boolean).length;
    while (
      folderLength < maximumLength &&
      peers.some(
        (peer) =>
          peer.workspaceRoot !== project.workspaceRoot &&
          suffix(peer.workspaceRoot, folderLength) === suffix(project.workspaceRoot, folderLength),
      )
    )
      folderLength++;
    const access = !input.connectedEnvironmentIds.has(project.environmentId)
      ? " (offline)"
      : !input.permittedEnvironmentIds.has(project.environmentId)
        ? " (read only)"
        : "";
    return {
      value: projectHomeComputerChoiceKey(project),
      label: `${computer}${includeFolder ? `, ${project.workspaceRoot}` : ""}${identity}${access}`,
      triggerLabel: `${computer}${includeFolder ? `, ${suffix(project.workspaceRoot, folderLength)}` : ""}${identity}${access}`,
    };
  });
}
