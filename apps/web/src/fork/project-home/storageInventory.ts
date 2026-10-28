import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { projectStorageRolloutKey } from "@t3tools/client-runtime/fork";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";

/** Only saved project records, never a filesystem scan or a claim that a path still exists. */
type InventoryProject = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "workspaceRoot"
>;
export function buildProjectStorageInventory<TProject extends InventoryProject>(input: {
  readonly projects: readonly TProject[];
  readonly groups: ReadonlyArray<{
    readonly projectKey: string;
    readonly displayName: string;
    readonly memberProjects: readonly TProject[];
  }>;
  readonly query: string;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
}) {
  const query = input.query.trim().toLocaleLowerCase();
  // Library snapshots may coalesce records at one physical location. Group using
  // those snapshots, but keep every exact rollout target from the source records.
  const groupKeyByPhysicalKey = new Map(
    input.groups.flatMap((group) =>
      group.memberProjects.map(
        (project) => [derivePhysicalProjectKey(project), group.projectKey] as const,
      ),
    ),
  );
  const projectsByGroup = new Map<string, TProject[]>();
  for (const project of input.projects) {
    const groupKey = groupKeyByPhysicalKey.get(derivePhysicalProjectKey(project));
    if (groupKey === undefined) continue;
    const members = projectsByGroup.get(groupKey) ?? [];
    members.push(project);
    projectsByGroup.set(groupKey, members);
  }
  return input.groups
    .map((group) => {
      const locations = new Map<
        string,
        { key: string; project: TProject; computerLabel: string }
      >();
      for (const project of projectsByGroup.get(group.projectKey) ?? []) {
        const computerLabel =
          input.environmentLabels.get(project.environmentId) ?? "Saved computer";
        const key = projectStorageRolloutKey({
          environmentId: project.environmentId,
          projectId: project.id,
          workspaceRoot: project.workspaceRoot,
        });
        locations.set(key, { key, project, computerLabel });
      }
      const peersByPhysicalKey = new Map<
        string,
        { count: number; titleCounts: Map<string, number> }
      >();
      for (const { project } of locations.values()) {
        const physicalKey = derivePhysicalProjectKey(project);
        const peers = peersByPhysicalKey.get(physicalKey) ?? { count: 0, titleCounts: new Map() };
        const titleKey = project.title.trim().toLocaleLowerCase();
        peers.count++;
        peers.titleCounts.set(titleKey, (peers.titleCounts.get(titleKey) ?? 0) + 1);
        peersByPhysicalKey.set(physicalKey, peers);
      }
      return {
        projectKey: group.projectKey,
        label: group.displayName,
        locations: [...locations.values()]
          .map((location) => {
            const { project } = location;
            const peers = peersByPhysicalKey.get(derivePhysicalProjectKey(project))!;
            const repeatedTitle =
              (peers.titleCounts.get(project.title.trim().toLocaleLowerCase()) ?? 0) > 1;
            const recordLabel =
              peers.count < 2
                ? null
                : repeatedTitle
                  ? `${project.title} (record ${project.id})`
                  : project.title;
            return {
              ...location,
              recordLabel,
              projectName: recordLabel
                ? `${group.displayName}, saved project ${recordLabel}`
                : group.displayName,
            };
          })
          .filter(
            ({ project, computerLabel, recordLabel }) =>
              !query ||
              [
                group.displayName,
                project.title,
                project.workspaceRoot,
                computerLabel,
                recordLabel ?? "",
              ].some((value) => value.toLocaleLowerCase().includes(query)),
          )
          .sort(
            (left, right) =>
              left.computerLabel.localeCompare(right.computerLabel) ||
              left.project.workspaceRoot.localeCompare(right.project.workspaceRoot) ||
              left.project.id.localeCompare(right.project.id),
          ),
      };
    })
    .filter((group) => group.locations.length > 0)
    .sort((left, right) => left.label.localeCompare(right.label));
}
