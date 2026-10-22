import type { ProjectId } from "@t3tools/contracts";
import type { VaultMigrationInventoryPage, VaultMigrationProject } from "@t3tools/contracts/fork";

export const MAX_GITHUB_PROJECT_INVENTORY_PAGES = 20;

export async function collectGitHubProjectInventory(
  readPage: (cursor: ProjectId | null) => Promise<VaultMigrationInventoryPage>,
  signal?: AbortSignal,
) {
  const projects: VaultMigrationProject[] = [];
  const warnings: string[] = [];
  const seen = new Set<ProjectId>();
  let cursor: ProjectId | null = null;
  let finished = false;
  for (let pageIndex = 0; pageIndex < MAX_GITHUB_PROJECT_INVENTORY_PAGES; pageIndex++) {
    if (signal?.aborted) break;
    let page: VaultMigrationInventoryPage;
    try {
      page = await readPage(cursor);
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : "Project metadata could not be loaded.",
      );
      break;
    }
    projects.push(...page.projects);
    if (page.nextCursor === null) {
      finished = true;
      break;
    }
    if (seen.has(page.nextCursor)) {
      warnings.push("The project list repeated a page.");
      break;
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  if (!finished) {
    warnings.unshift(
      signal?.aborted
        ? "Search cancelled. Only part of the project list was checked."
        : "Only part of the project list was checked. Retry or select missing projects manually.",
    );
  }
  const unavailable = projects.filter((project) => project.state === "unavailable").length;
  const incomplete = projects.filter((project) => project.omittedDependencies > 0).length;
  if (unavailable)
    warnings.push(
      `Git metadata was unavailable for ${unavailable} ${unavailable === 1 ? "project" : "projects"}. Select their repositories manually.`,
    );
  if (incomplete)
    warnings.push(
      `Some remotes were omitted for ${incomplete} ${incomplete === 1 ? "project" : "projects"}. Review their repository selections.`,
    );
  return { projects, warnings };
}
