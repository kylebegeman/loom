import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryProjectColor,
  LibraryThreadIndex,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { libraryProjectColor } from "@t3tools/client-runtime/fork";

export const PROJECT_SORTS = ["activity", "name", "created"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  activity: "Recent activity",
  name: "Name",
  created: "Newest first",
};

/** One project with everything a list or card shows about it. */
export type ProjectEntry = {
  readonly project: LibraryProject;
  readonly color: LibraryProjectColor;
  readonly copies: readonly LibraryWorkingCopy[];
  /** Null when the thread index is partial, so the count would undercount. */
  readonly conversations: number | null;
  /** The later of the last edit and the last conversation update. */
  readonly activeAt: string;
};

export function projectEntries(
  projects: readonly LibraryProject[],
  copies: readonly LibraryWorkingCopy[],
  index: LibraryThreadIndex | null | undefined,
): ProjectEntry[] {
  const threads = new Map<string, { count: number; latest: string }>();
  for (const thread of index?.threads ?? []) {
    if (thread.deleted || thread.archived) continue;
    const current = threads.get(thread.projectId);
    threads.set(thread.projectId, {
      count: (current?.count ?? 0) + 1,
      latest: current && current.latest > thread.updatedAt ? current.latest : thread.updatedAt,
    });
  }
  const complete = index?.nextOffset === null;
  return projects.map((project) => {
    const activity = threads.get(project.id);
    return {
      project,
      color: libraryProjectColor(project),
      copies: copies.filter((copy) => copy.projectId === project.id),
      conversations: complete ? (activity?.count ?? 0) : null,
      activeAt:
        activity && activity.latest > project.updatedAt ? activity.latest : project.updatedAt,
    };
  });
}

export type ProjectFilter = {
  readonly archived: boolean;
  readonly search: string;
  readonly colors: ReadonlySet<LibraryProjectColor>;
  readonly computer: EnvironmentId | null;
};

/** Search reads names, briefs, repositories, folders and computers, since any of them is how someone remembers a project. */
export function filterProjectEntries(
  entries: readonly ProjectEntry[],
  filter: ProjectFilter,
  computerLabel: (id: EnvironmentId) => string,
) {
  const search = filter.search.trim().toLocaleLowerCase();
  return entries.filter(({ project, color, copies }) => {
    if (project.archived !== filter.archived) return false;
    if (filter.colors.size && !filter.colors.has(color)) return false;
    if (filter.computer && !copies.some((copy) => copy.environmentId === filter.computer))
      return false;
    if (!search) return true;
    return [
      project.title,
      project.brief,
      ...project.resources.map((resource) => resource.title),
      ...copies.flatMap((copy) => [copy.rootPath, computerLabel(copy.environmentId)]),
    ].some((text) => text.toLocaleLowerCase().includes(search));
  });
}

export function sortProjectEntries(entries: readonly ProjectEntry[], sort: ProjectSort) {
  const compare = {
    activity: (a: ProjectEntry, b: ProjectEntry) => b.activeAt.localeCompare(a.activeAt),
    name: (a: ProjectEntry, b: ProjectEntry) =>
      a.project.title.localeCompare(b.project.title, undefined, { sensitivity: "base" }),
    created: (a: ProjectEntry, b: ProjectEntry) =>
      b.project.createdAt.localeCompare(a.project.createdAt),
  }[sort];
  return entries.toSorted(compare);
}
