import type { VaultMigrationInventoryPage, VaultMigrationProject } from "@t3tools/contracts/fork";

const MAX_PROJECT_INVENTORY_PAGES = 25;

export async function scanGitHubProjectInventory(
  readPage: (
    cursor: VaultMigrationInventoryPage["nextCursor"],
  ) => Promise<VaultMigrationInventoryPage>,
  onProjects: (projects: readonly VaultMigrationProject[]) => void,
) {
  const projects: VaultMigrationProject[] = [];
  const visited = new Set<string>();
  let cursor: VaultMigrationInventoryPage["nextCursor"] = null;
  let complete = false;
  let incompleteReason: string | null = null;
  try {
    for (let page = 0; page < MAX_PROJECT_INVENTORY_PAGES; page++) {
      const result = await readPage(cursor);
      projects.push(...result.projects);
      onProjects([...projects]);
      cursor = result.nextCursor;
      if (cursor === null) {
        complete = true;
        break;
      }
      if (visited.has(cursor)) {
        throw new Error("The project inventory repeated a page. Refresh before scanning again.");
      }
      visited.add(cursor);
    }
    if (!complete) {
      incompleteReason = `The scan stopped after ${MAX_PROJECT_INVENTORY_PAGES} pages. More registered projects remain. Select missing projects manually.`;
    }
  } catch (cause) {
    incompleteReason = `Project matching is incomplete. ${cause instanceof Error ? cause.message : "Project metadata could not be read."} You can select missing projects manually.`;
  }
  const unavailable = projects.filter(
    (project) =>
      project.state === "unavailable" || project.omittedDependencies > 0 || project.localUrlRewrite,
  ).length;
  if (unavailable > 0) {
    incompleteReason = [
      incompleteReason,
      `${unavailable} projects have unavailable, omitted or rewritten repository metadata. Review those projects manually.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  return { projects, incompleteReason };
}
