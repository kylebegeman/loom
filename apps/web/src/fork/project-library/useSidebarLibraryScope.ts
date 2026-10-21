import {
  libraryProjectFilterItems,
  libraryProjectForLocalRefs,
  libraryProjectScopeKey,
  parseLibraryProjectScope,
} from "@t3tools/client-runtime/fork";
import type { LibraryThreadSummary, LibraryWorkingCopy } from "@t3tools/contracts/fork";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryProject, useLibraryProjects } from "./state";

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
      ? projectLibrary.threadIndex({ environmentId: catalog.authorityId, input: { limit: 200 } })
      : null,
  );
  const copies = useEnvironmentQuery(
    catalog.authorityId
      ? projectLibrary.copies({ environmentId: catalog.authorityId, input: {} })
      : null,
  );
  const scope = parseLibraryProjectScope(persistedScopeKey);
  const project = useLibraryProject(scope?.projectId ?? "");

  const groupProjectId = (group: SidebarProjectSnapshot) => {
    const id = libraryProjectForLocalRefs(
      index.data?.threads ?? [],
      group.memberProjectRefs,
      copies.data ?? [],
    );
    return id && catalog.query.data?.some((entry) => entry.id === id) ? id : null;
  };
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
      ...libraryProjectFilterItems(catalog.query.data ?? []),
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
