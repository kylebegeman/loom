import {
  libraryOutsideArchivedProjects,
  libraryProjectFilterItems,
  libraryProjectForLocalRefs,
  libraryProjectScopeKey,
  parseLibraryProjectScope,
} from "@t3tools/client-runtime/fork";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironmentQuery } from "~/state/query";
import {
  LIBRARY_THREAD_INDEX_LIMIT,
  projectLibrary,
  useLibraryProject,
  useLibraryProjects,
} from "./state";

interface ProjectScopeItem {
  readonly value: string;
  readonly label: string;
}

/** Whole-project scope includes older local threads; component scope requires explicit history. */
export function libraryScopeLocalProjectKeys(
  scope: ReturnType<typeof parseLibraryProjectScope>,
  threads: readonly LibraryThreadSummary[],
  copies: readonly LibraryWorkingCopy[],
): ReadonlySet<string> | null {
  if (!scope) return null;
  const keys = new Set(
    threads
      .filter(
        (thread) =>
          thread.projectId === scope.projectId &&
          (!scope.resourceId ||
            (thread.resourceIds.length === 1 && thread.resourceIds[0] === scope.resourceId)),
      )
      .map((thread) => `${thread.environmentId}:${thread.localProjectId}`),
  );
  if (!scope.resourceId) {
    for (const copy of copies) {
      if (
        copy.projectId !== scope.projectId ||
        copy.state === "released" ||
        copy.registered === false
      )
        continue;
      for (const id of [
        copy.rootLocalProjectId,
        ...copy.repositories.map((repo) => repo.localProjectId),
      ]) {
        if (id) keys.add(`${copy.environmentId}:${id}`);
      }
    }
  }
  return keys;
}

/**
 * Finds the live Library project that holds a group's folders. A folder held only by an archived
 * project stays a plain local folder, since the filter does not list the archived project.
 * `projects` must include archived ones.
 */
export function librarySidebarGroupProjects(
  projects: readonly LibraryProject[],
  threads: readonly LibraryThreadSummary[],
  copies: readonly LibraryWorkingCopy[],
) {
  const liveThreads = libraryOutsideArchivedProjects(threads, projects);
  const liveCopies = libraryOutsideArchivedProjects(copies, projects);
  const known = new Set(projects.map((project) => project.id));
  return (refs: readonly { environmentId: string; projectId: string }[]) => {
    const id = libraryProjectForLocalRefs(liveThreads, refs, liveCopies);
    return id && known.has(id) ? id : null;
  };
}

/**
 * The sidebar's project filter with Library projects in it. A local project group that belongs to
 * exactly one Library project is filtered through that project instead, so the same work is not
 * offered twice, and a Library scope lists the threads every computer saved for it.
 */
export function useSidebarLibraryScope(input: {
  readonly persistedScopeKey: string | null;
  readonly projectGroups: ReadonlyArray<SidebarProjectSnapshot>;
}) {
  const { persistedScopeKey, projectGroups } = input;
  const catalog = useLibraryProjects(true);
  const index = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.threadIndex({
          environmentId: catalog.authorityId,
          input: { limit: LIBRARY_THREAD_INDEX_LIMIT },
        })
      : null,
  );
  const copies = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.copies({ environmentId: catalog.authorityId, input: {} })
      : null,
  );
  const scope = parseLibraryProjectScope(persistedScopeKey);
  const project = useLibraryProject(scope?.projectId ?? "");

  const groupProjectFor = librarySidebarGroupProjects(
    catalog.query.data ?? [],
    index.data?.threads ?? [],
    copies.data ?? [],
  );
  const groupProjectId = (group: SidebarProjectSnapshot) =>
    groupProjectFor(group.memberProjectRefs);
  const scopeKeyForGroup = (group: SidebarProjectSnapshot) => {
    const id = groupProjectId(group);
    return id ? libraryProjectScopeKey(id) : group.projectKey;
  };
  const legacy = scope
    ? null
    : projectGroups.find((group) => group.projectKey === persistedScopeKey);
  const migratedId = legacy ? groupProjectId(legacy) : null;
  const migratedScopeKey = migratedId ? libraryProjectScopeKey(migratedId) : null;
  const scopeItems = (localItems: ReadonlyArray<ProjectScopeItem>): ProjectScopeItem[] => {
    const [allItem, ...groupItems] = localItems;
    const groupByKey = new Map(projectGroups.map((group) => [group.projectKey, group] as const));
    return [
      ...(allItem ? [allItem] : []),
      ...libraryProjectFilterItems(catalog.query.data ?? [], persistedScopeKey),
      ...groupItems.filter((item) => {
        const group = groupByKey.get(item.value);
        return !group || !groupProjectId(group);
      }),
    ];
  };
  const scopedProjectKeys = libraryScopeLocalProjectKeys(
    scope,
    project.threads.data ?? [],
    copies.data ?? [],
  );

  return {
    authorityId: catalog.authorityId,
    environments: catalog.environments,
    scope,
    scopedProjectKeys,
    scopeKeyForGroup,
    migratedScopeKey,
    scopeItems,
  };
}
