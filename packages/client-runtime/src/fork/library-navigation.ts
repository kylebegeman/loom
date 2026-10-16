import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

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
/** The Library projects each local folder belongs to, by its copies and registered threads. */
function libraryProjectIdsForLocalRefs(
  threads: readonly LibraryThreadSummary[],
  refs: readonly { environmentId: string; projectId: string }[],
  copies: readonly LibraryWorkingCopy[],
) {
  return refs.map(
    (ref) =>
      new Set([
        ...copies
          .filter(
            (copy) =>
              copy.registered !== false &&
              copy.state !== "released" &&
              copy.environmentId === ref.environmentId &&
              (copy.rootLocalProjectId === ref.projectId ||
                copy.repositories.some((repo) => repo.localProjectId === ref.projectId)),
          )
          .map((copy) => copy.projectId),
        ...threads
          .filter(
            (t) => t.environmentId === ref.environmentId && t.localProjectId === ref.projectId,
          )
          .map((t) => t.projectId),
      ]),
  );
}
/**
 * Whether any Library project already holds one of these folders. Unlike
 * `libraryProjectForLocalRefs`, a folder shared by two projects, or linked on only one of its
 * computers, still counts, so it is never offered as a folder outside every project.
 */
export function libraryHoldsLocalRefs(
  threads: readonly LibraryThreadSummary[],
  refs: readonly { environmentId: string; projectId: string }[],
  copies: readonly LibraryWorkingCopy[] = [],
) {
  return libraryProjectIdsForLocalRefs(threads, refs, copies).some((ids) => ids.size > 0);
}
/** Match by explicit source identity, never by a display name or coincidentally identical path. */
export function libraryProjectForLocalRefs(
  threads: readonly LibraryThreadSummary[],
  refs: readonly { environmentId: string; projectId: string }[],
  copies: readonly LibraryWorkingCopy[] = [],
) {
  if (!refs.length) return null;
  const projects = libraryProjectIdsForLocalRefs(threads, refs, copies);
  if (projects.some((ids) => ids.size !== 1)) return null;
  const ids = new Set(projects.flatMap((ids) => [...ids]));
  return ids.size === 1 ? [...ids][0]! : null;
}
