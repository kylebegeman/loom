import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";

export const PROJECT_STORAGE_INVENTORY_PAGE_SIZE = 30;

/** Enumerate known records only, keeping storage review bound to each computer/project ID. */
export function projectStorageInventory(
  projects: ReadonlyArray<EnvironmentProject>,
  computerNames: ReadonlyMap<EnvironmentId, string>,
  query: string,
) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const records = new Map<string, EnvironmentProject>();
  for (const project of projects) {
    const key = JSON.stringify([project.environmentId, project.id]);
    const current = records.get(key);
    if (!current || Date.parse(project.updatedAt) > Date.parse(current.updatedAt))
      records.set(key, project);
  }
  return [...records.values()]
    .map((project) => ({
      project,
      key: JSON.stringify([project.environmentId, project.id]),
      computerLabel: computerNames.get(project.environmentId) ?? "Computer",
    }))
    .filter(
      (entry) =>
        normalizedQuery.length === 0 ||
        [entry.project.title, entry.project.workspaceRoot, entry.computerLabel].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        ),
    )
    .sort(
      (left, right) =>
        left.computerLabel.localeCompare(right.computerLabel) ||
        left.project.title.localeCompare(right.project.title) ||
        left.key.localeCompare(right.key),
    );
}
