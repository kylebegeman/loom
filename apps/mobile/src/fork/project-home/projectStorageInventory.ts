import { projectStorageRolloutKey } from "@t3tools/client-runtime/fork";
import { derivePhysicalProjectKey } from "@t3tools/client-runtime/state/project-grouping";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, SidebarProjectGroupingMode } from "@t3tools/contracts";

import { buildHomeProjectScopes } from "../../features/home/homeThreadList";

export const PROJECT_STORAGE_INVENTORY_PAGE_SIZE = 30;

/** Known working-file locations share library grouping, but retain their own save targets. */
export function projectStorageInventory(
  projects: ReadonlyArray<EnvironmentProject>,
  computerNames: ReadonlyMap<EnvironmentId, string>,
  query: string,
  projectGroupingMode: SidebarProjectGroupingMode = "repository",
) {
  const records = new Map<string, EnvironmentProject>();
  for (const project of projects) {
    const key = JSON.stringify([project.environmentId, project.id]);
    const current = records.get(key);
    if (!current || Date.parse(project.updatedAt) > Date.parse(current.updatedAt))
      records.set(key, project);
  }
  const knownProjects = [...records.values()];
  const locationRecordCounts = new Map<string, number>();
  const locationTitleCounts = new Map<string, number>();
  for (const project of knownProjects) {
    const locationKey = derivePhysicalProjectKey(project);
    const titleKey = JSON.stringify([locationKey, project.title.trim().toLocaleLowerCase()]);
    locationRecordCounts.set(locationKey, (locationRecordCounts.get(locationKey) ?? 0) + 1);
    locationTitleCounts.set(titleKey, (locationTitleCounts.get(titleKey) ?? 0) + 1);
  }
  const scopes = buildHomeProjectScopes({
    projects: knownProjects,
    environmentId: null,
    projectGroupingMode,
  });
  const scopeByProject = new Map(
    scopes.flatMap((scope) =>
      scope.projectRefs.map((ref) => [JSON.stringify([ref.environmentId, ref.projectId]), scope]),
    ),
  );
  const entries = knownProjects
    .map((project) => {
      const scope = scopeByProject.get(JSON.stringify([project.environmentId, project.id]))!;
      const locationKey = derivePhysicalProjectKey(project);
      const titleKey = JSON.stringify([locationKey, project.title.trim().toLocaleLowerCase()]);
      const recordLabel =
        (locationRecordCounts.get(locationKey) ?? 0) > 1
          ? `Project record: ${project.title}${(locationTitleCounts.get(titleKey) ?? 0) > 1 ? ` (${project.id})` : ""}`
          : null;
      return {
        project,
        groupKey: scope.key,
        groupTitle: scope.title,
        recordLabel,
        key: projectStorageRolloutKey({
          environmentId: project.environmentId,
          projectId: project.id,
          workspaceRoot: project.workspaceRoot,
        }),
        computerLabel: computerNames.get(project.environmentId) ?? "Computer",
      };
    })
    .sort(
      (left, right) =>
        left.groupTitle.localeCompare(right.groupTitle) ||
        left.groupKey.localeCompare(right.groupKey) ||
        left.computerLabel.localeCompare(right.computerLabel) ||
        left.project.title.localeCompare(right.project.title) ||
        left.key.localeCompare(right.key),
    );
  return filterProjectStorageInventory(entries, query);
}

export function filterProjectStorageInventory<
  T extends {
    readonly project: EnvironmentProject;
    readonly groupTitle: string;
    readonly computerLabel: string;
    readonly recordLabel: string | null;
  },
>(entries: ReadonlyArray<T>, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      normalizedQuery.length === 0 ||
      [
        entry.groupTitle,
        entry.project.title,
        entry.project.workspaceRoot,
        entry.computerLabel,
        entry.recordLabel ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
  );
}
