import { buildProjectNavigationEntries } from "@t3tools/client-runtime/fork";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { useCallback, useMemo, useState } from "react";

import {
  sortHomeProjectScopes,
  type HomeProjectScope,
  type HomeProjectSortOrder,
} from "../../features/home/homeThreadList";
import type { PendingNewTask } from "../../state/use-pending-new-tasks";
import { projectThreadActivity } from "./projectNavigation.logic";

export type ProjectLibraryEntry = ReturnType<
  typeof buildProjectNavigationEntries<HomeProjectScope, EnvironmentThreadShell>
>[number];
export interface ProjectLibraryItem {
  readonly type: "loom-project";
  readonly key: string;
  readonly entry: ProjectLibraryEntry;
  readonly expanded: boolean;
}

export function useProjectLibrary(input: {
  readonly scopes: ReadonlyArray<HomeProjectScope>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly projectSortOrder: HomeProjectSortOrder;
  readonly searchQuery: string;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly settlementEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly snoozeEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly queuedThreadKeys: ReadonlySet<string>;
  readonly now: string;
  readonly enabled: boolean;
}) {
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const {
    enabled,
    scopes,
    threads,
    pendingTasks,
    projectSortOrder,
    searchQuery,
    connectedEnvironmentIds,
    settlementEnvironmentIds,
    snoozeEnvironmentIds,
    queuedThreadKeys,
    now,
  } = input;
  const entries = useMemo(
    () =>
      enabled
        ? buildProjectNavigationEntries({
            groups: sortHomeProjectScopes({ scopes, threads, pendingTasks, projectSortOrder }),
            threads: threads.filter((thread) => thread.lineage.relationshipToParent !== "subagent"),
            searchQuery,
            connectedEnvironmentIds,
            getThreadActivity: (thread) =>
              projectThreadActivity(thread, {
                now,
                settlementEnvironmentIds,
                snoozeEnvironmentIds,
                queuedThreadKeys,
              }),
          })
        : [],
    [
      enabled,
      scopes,
      threads,
      pendingTasks,
      projectSortOrder,
      searchQuery,
      connectedEnvironmentIds,
      settlementEnvironmentIds,
      snoozeEnvironmentIds,
      queuedThreadKeys,
      now,
    ],
  );
  const items = useMemo(
    () =>
      entries.map((entry): ProjectLibraryItem => ({
        type: "loom-project",
        key: `loom-project:${entry.key}`,
        entry,
        expanded: expandedKeys.has(entry.key) || searchQuery.trim().length > 0,
      })),
    [entries, expandedKeys, searchQuery],
  );
  const toggleExpanded = useCallback((key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  return { items, toggleExpanded } as const;
}
