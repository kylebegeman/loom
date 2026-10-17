import {
  libraryProjectFilterItems,
  libraryProjectForLocalRefs,
  libraryProjectScopeKey,
  parseLibraryProjectScope,
} from "@t3tools/client-runtime/fork";
import { useCallback, useMemo } from "react";

import type { SidebarProjectSnapshot } from "~/sidebarProjectGrouping";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryProject, useLibraryProjects } from "./state";

interface ProjectScopeItem {
  readonly value: string;
  readonly label: string;
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
  const scope = useMemo(() => parseLibraryProjectScope(persistedScopeKey), [persistedScopeKey]);
  const project = useLibraryProject(scope?.projectId ?? "");

  const groupProjectId = useCallback(
    (group: SidebarProjectSnapshot) => {
      const id = libraryProjectForLocalRefs(
        index.data?.threads ?? [],
        group.memberProjectRefs,
        copies.data ?? [],
      );
      return id && catalog.query.data?.some((entry) => entry.id === id) ? id : null;
    },
    [index.data, copies.data, catalog.query.data],
  );

  /** The filter key for a local group: its Library project when it has one. */
  const scopeKeyForGroup = useCallback(
    (group: SidebarProjectSnapshot) => {
      const id = groupProjectId(group);
      return id ? libraryProjectScopeKey(id) : group.projectKey;
    },
    [groupProjectId],
  );

  /** A persisted local group key that now belongs to a Library project, rewritten to it. */
  const migratedScopeKey = useMemo(() => {
    if (scope) return null;
    const legacy = projectGroups.find((group) => group.projectKey === persistedScopeKey);
    const id = legacy ? groupProjectId(legacy) : null;
    return id ? libraryProjectScopeKey(id) : null;
  }, [scope, projectGroups, persistedScopeKey, groupProjectId]);

  const scopeItems = useCallback(
    (localItems: ReadonlyArray<ProjectScopeItem>): ProjectScopeItem[] => {
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
    },
    [projectGroups, catalog.query.data, groupProjectId],
  );

  const threads = project.threads.data;
  const scopedProjectKeys = useMemo<ReadonlySet<string> | null>(
    () =>
      scope
        ? new Set(
            (threads ?? [])
              .filter(
                (thread) =>
                  !scope.resourceId ||
                  (thread.resourceIds.length === 1 && thread.resourceIds[0] === scope.resourceId),
              )
              .map((thread) => `${thread.environmentId}:${thread.localProjectId}`),
          )
        : null,
    [scope, threads],
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
