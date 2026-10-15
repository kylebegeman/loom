import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";

export function libraryProjectScopeKey(projectId: string, resourceId?: string) {
  return `library:${encodeURIComponent(projectId)}${resourceId ? `:component:${encodeURIComponent(resourceId)}` : ""}`;
}
export function parseLibraryProjectScope(key: string | null) {
  if (!key?.startsWith("library:")) return null;
  const parts = key.slice(8).split(":component:");
  if (parts.length > 2 || !parts[0] || parts[1] === "") return null;
  try {
    return {
      projectId: decodeURIComponent(parts[0]),
      resourceId: parts[1] ? decodeURIComponent(parts[1]) : null,
    };
  } catch {
    return null;
  }
}
export function libraryThreadMatchesScope(
  thread: LibraryThreadSummary,
  scope: ReturnType<typeof parseLibraryProjectScope>,
) {
  return (
    !scope ||
    (thread.projectId === scope.projectId &&
      (!scope.resourceId ||
        (thread.resourceIds.length === 1 && thread.resourceIds[0] === scope.resourceId)))
  );
}
export function libraryProjectFilterItems(projects: readonly LibraryProject[]) {
  return projects.flatMap((project) => [
    {
      value: libraryProjectScopeKey(project.id),
      label: `${project.title}${project.archived ? " (archived)" : ""}`,
    },
    ...project.resources
      .filter((r) => r.kind !== "link")
      .map((r) => ({
        value: libraryProjectScopeKey(project.id, r.id),
        label: `${project.title} / ${r.title}`,
      })),
  ]);
}
/** Match by explicit source identity, never by a display name or coincidentally identical path. */
export function libraryProjectForLocalRefs(
  threads: readonly LibraryThreadSummary[],
  refs: readonly { environmentId: string; projectId: string }[],
) {
  if (!refs.length) return null;
  const projects = refs.map(
    (ref) =>
      new Set(
        threads
          .filter(
            (t) => t.environmentId === ref.environmentId && t.localProjectId === ref.projectId,
          )
          .map((t) => t.projectId),
      ),
  );
  if (projects.some((ids) => ids.size !== 1)) return null;
  const ids = new Set(projects.flatMap((ids) => [...ids]));
  return ids.size === 1 ? [...ids][0]! : null;
}
