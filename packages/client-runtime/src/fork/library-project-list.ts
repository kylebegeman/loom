import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentProject } from "../state/shell.ts";
import type {
  LibraryProject,
  LibraryProjectColor,
  LibraryThreadIndex,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { LIBRARY_PROJECT_COLORS } from "@t3tools/contracts/fork";
import { libraryProjectColor } from "./library-project.ts";

export const PROJECT_SORTS = ["activity", "name", "created"] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  activity: "Recent activity",
  name: "Name",
  created: "Newest first",
};

export const PROJECT_COLOR_NAMES: Record<LibraryProjectColor, string> = {
  plum: "Plum",
  red: "Red",
  orange: "Orange",
  gold: "Gold",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  slate: "Slate",
};

export const PROJECT_GROUPS = ["activity", "color", "none"] as const;
export type ProjectGroup = (typeof PROJECT_GROUPS)[number];

export const PROJECT_GROUP_LABELS: Record<ProjectGroup, string> = {
  activity: "Activity",
  color: "Color",
  none: "No grouping",
};

/**
 * Projects rarely end; they go quiet. After two weeks without a conversation or an edit a project
 * rests on its own, and the next conversation brings it back, so nobody has to park anything.
 */
export const RESTING_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

/** The local project record whose favicon or chosen icon stands in for a Library project. */
export type LocalProjectIcon = Pick<
  EnvironmentProject,
  "id" | "environmentId" | "workspaceRoot" | "title" | "faviconPath" | "projectIcon"
>;

/**
 * Picks the local project that shows a Library project's icon, the same record its threads
 * show. A deliberately chosen icon wins, then each copy's root folder before its repositories,
 * so the project looks the same whichever computer is answering.
 */
export function libraryLocalProjectIcon(
  copies: readonly LibraryWorkingCopy[],
  byRef: ReadonlyMap<string, LocalProjectIcon>,
): LocalProjectIcon | null {
  const candidates = copies.flatMap((copy) =>
    [copy.rootLocalProjectId, ...copy.repositories.map((repository) => repository.localProjectId)]
      .map((id) => (id ? byRef.get(`${copy.environmentId}:${id}`) : undefined))
      .filter((project) => project !== undefined),
  );
  return candidates.find((project) => project.projectIcon) ?? candidates[0] ?? null;
}

/** Indexes local projects by environment and id, the way Library copies point at them. */
export function localProjectsByRef(projects: readonly LocalProjectIcon[]) {
  return new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project]));
}

/** One project with everything a list or card shows about it. */
export type ProjectEntry = {
  readonly project: LibraryProject;
  readonly color: LibraryProjectColor;
  readonly copies: readonly LibraryWorkingCopy[];
  readonly localIcon: LocalProjectIcon | null;
  /** Null when a legacy host supplies only a partial conversation index. */
  readonly conversations: number | null;
  /** The later of the last edit and the last conversation update. */
  readonly activeAt: string;
};

export function projectEntries(
  projects: readonly LibraryProject[],
  copies: readonly LibraryWorkingCopy[],
  index: LibraryThreadIndex | null | undefined,
  localProjects: readonly LocalProjectIcon[] = [],
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
  // New hosts aggregate metadata in SQL rather than requiring every conversation to be fetched.
  const totals = index?.projectActivity;
  if (totals !== undefined) {
    threads.clear();
    for (const activity of totals) {
      threads.set(activity.projectId, { count: activity.conversations, latest: activity.latestAt });
    }
  }
  const complete = totals !== undefined || index?.nextOffset === null;
  const locals = localProjectsByRef(localProjects);
  return projects.map((project) => {
    const activity = threads.get(project.id);
    const projectCopies = copies.filter((copy) => copy.projectId === project.id);
    return {
      project,
      color: libraryProjectColor(project),
      copies: projectCopies,
      localIcon: libraryLocalProjectIcon(projectCopies, locals),
      conversations: complete ? (activity?.count ?? 0) : null,
      activeAt:
        activity && activity.latest > project.updatedAt ? activity.latest : project.updatedAt,
    };
  });
}

export type ProjectFilter = {
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
  return [...entries].sort(compare);
}

export type ProjectSection =
  | { readonly kind: "active" | "resting" | "all"; readonly entries: readonly ProjectEntry[] }
  | {
      readonly kind: "color";
      readonly color: LibraryProjectColor;
      readonly entries: readonly ProjectEntry[];
    };

export function isRestingSince(activeAt: string, now: number) {
  return now - Date.parse(activeAt) >= RESTING_AFTER_MS;
}

export function isRestingEntry(entry: ProjectEntry, now: number) {
  // Missing activity in a partial legacy page cannot establish two quiet weeks.
  return entry.conversations !== null && isRestingSince(entry.activeAt, now);
}

/** Splits entries into the sections the page shows, keeping each section in the given order. */
export function projectSections(
  entries: readonly ProjectEntry[],
  group: ProjectGroup,
  now: number,
): ProjectSection[] {
  const sections: ProjectSection[] =
    group === "none"
      ? [{ kind: "all", entries }]
      : group === "color"
        ? LIBRARY_PROJECT_COLORS.map((color) => ({
            kind: "color" as const,
            color,
            entries: entries.filter((entry) => entry.color === color),
          }))
        : [
            { kind: "active", entries: entries.filter((entry) => !isRestingEntry(entry, now)) },
            { kind: "resting", entries: entries.filter((entry) => isRestingEntry(entry, now)) },
          ];
  return sections.filter((section) => section.entries.length > 0);
}
