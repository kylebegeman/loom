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
/**
 * Archived projects stay out until restored, except the selected scope, which stays listed so it
 * can be seen and cleared. A project with one folder already scopes to that folder.
 */
export function libraryProjectFilterItems(
  projects: readonly LibraryProject[],
  selected: string | null = null,
) {
  return projects.flatMap((project) => {
    const folders = project.resources.filter((r) => r.kind !== "link");
    const suffix = project.archived ? " (archived)" : "";
    return [
      {
        value: libraryProjectScopeKey(project.id),
        label: `${project.title}${suffix}`,
        listed: true,
      },
      ...folders.map((r) => ({
        value: libraryProjectScopeKey(project.id, r.id),
        label: `${project.title} / ${r.title}${suffix}`,
        listed: folders.length > 1,
      })),
    ].flatMap(({ listed, ...item }) =>
      (listed && !project.archived) || item.value === selected ? [item] : [],
    );
  });
}
/** Drops threads or copies of archived projects. `projects` must include archived ones. */
export function libraryOutsideArchivedProjects<T extends { readonly projectId: string }>(
  items: readonly T[],
  projects: readonly LibraryProject[],
) {
  const archived = new Set(projects.filter((p) => p.archived).map((p) => p.id));
  return items.filter((item) => !archived.has(item.projectId));
}
/** The Library projects each local folder belongs to, by its copies and registered threads. */
function libraryProjectIdsForLocalRefs(
  threads: readonly LibraryThreadSummary[],
  refs: readonly { environmentId: string; projectId: string }[],
  copies: readonly LibraryWorkingCopy[],
  includeInactiveCopies = false,
) {
  return refs.map(
    (ref) =>
      new Set([
        ...copies
          .filter(
            (copy) =>
              (includeInactiveCopies || (copy.registered !== false && copy.state !== "released")) &&
              copy.environmentId === ref.environmentId &&
              (copy.rootLocalProjectId === ref.projectId ||
                copy.repositories.some((repo) => repo.localProjectId === ref.projectId)),
          )
          .map((copy) => copy.projectId),
        ...threads
          .filter(
            (t) =>
              !t.deleted &&
              t.environmentId === ref.environmentId &&
              t.localProjectId === ref.projectId,
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
  options?: { readonly includeInactiveCopies?: boolean },
) {
  if (!refs.length) return null;
  const projects = libraryProjectIdsForLocalRefs(
    threads,
    refs,
    copies,
    options?.includeInactiveCopies,
  );
  if (projects.some((ids) => ids.size !== 1)) return null;
  const ids = new Set(projects.flatMap((ids) => [...ids]));
  return ids.size === 1 ? [...ids][0]! : null;
}
