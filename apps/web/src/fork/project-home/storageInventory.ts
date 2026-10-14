import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";

/** Only saved project records, never a filesystem scan or a claim that a path still exists. */
type InventoryProject = Pick<
  EnvironmentProject,
  "environmentId" | "id" | "title" | "workspaceRoot"
>;
export function buildProjectStorageInventory<TProject extends InventoryProject>(input: {
  readonly projects: readonly TProject[];
  readonly query: string;
  readonly environmentLabels: ReadonlyMap<EnvironmentId, string>;
}) {
  const query = input.query.trim().toLocaleLowerCase();
  const projects = new Map<string, TProject>();
  for (const project of input.projects)
    projects.set(JSON.stringify([project.environmentId, project.id]), project);
  const groups = new Map<
    EnvironmentId,
    {
      environmentId: EnvironmentId;
      label: string;
      projects: Array<{ key: string; project: TProject }>;
    }
  >();
  for (const [key, project] of projects) {
    const label = input.environmentLabels.get(project.environmentId) ?? "Saved computer";
    if (
      query &&
      ![project.title, project.workspaceRoot, label].some((value) =>
        value.toLocaleLowerCase().includes(query),
      )
    )
      continue;
    let group = groups.get(project.environmentId);
    if (!group) {
      group = { environmentId: project.environmentId, label, projects: [] };
      groups.set(project.environmentId, group);
    }
    group.projects.push({ key, project });
  }
  return [...groups.values()]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((group) => ({
      ...group,
      projects: group.projects.sort(
        (left, right) =>
          left.project.title.localeCompare(right.project.title) ||
          left.project.workspaceRoot.localeCompare(right.project.workspaceRoot),
      ),
    }));
}
