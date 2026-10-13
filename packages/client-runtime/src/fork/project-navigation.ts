import type { EnvironmentId, ProjectId, ScopedProjectRef, ThreadId } from "@t3tools/contracts";

export type LoomNavigatorView = "threads" | "projects";

export function resolveLoomNavigatorView(value: unknown): LoomNavigatorView {
  return value === "projects" ? "projects" : "threads";
}

export const PROJECT_NAVIGATION_PREVIEW_LIMIT = 8;

export type ProjectNavigationThreadActivity =
  | "attention"
  | "working"
  | "failed"
  | "ready"
  | "settled"
  | "snoozed";

export interface ProjectNavigationGroup {
  readonly key: string;
  readonly title: string;
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
}

export interface ProjectNavigationThread {
  readonly id: ThreadId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
}

export interface ProjectNavigationEntry<
  TGroup extends ProjectNavigationGroup,
  TThread extends ProjectNavigationThread,
> {
  readonly key: string;
  readonly title: string;
  readonly group: TGroup;
  readonly threadCount: number;
  readonly activeCount: number;
  readonly settledCount: number;
  readonly snoozedCount: number;
  readonly attentionCount: number;
  readonly workingCount: number;
  readonly failedCount: number;
  readonly readyCount: number;
  readonly offlineCount: number;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly previewThreads: ReadonlyArray<TThread>;
  readonly hiddenThreadCount: number;
}

const ACTIVITY_PRIORITY: Record<ProjectNavigationThreadActivity, number> = {
  attention: 0,
  failed: 1,
  working: 2,
  ready: 3,
  snoozed: 4,
  settled: 5,
};

function entityKey(environmentId: string, id: string): string {
  return JSON.stringify([environmentId, id]);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** A project remains in the library even when it has no active or present checkout.
 * Clients supply their existing thread classification and project grouping policy.
 * Cached threads count toward history but cannot claim live activity while offline.
 */
export function buildProjectNavigationEntries<
  TGroup extends ProjectNavigationGroup,
  TThread extends ProjectNavigationThread,
>(input: {
  readonly groups: ReadonlyArray<TGroup>;
  readonly threads: ReadonlyArray<TThread>;
  readonly searchQuery?: string;
  readonly getThreadActivity: (thread: TThread) => ProjectNavigationThreadActivity;
  readonly connectedEnvironmentIds?: ReadonlySet<EnvironmentId>;
}): ReadonlyArray<ProjectNavigationEntry<TGroup, TThread>> {
  const query = input.searchQuery?.trim().toLocaleLowerCase() ?? "";
  const groups = input.groups.map((group) => ({
    group,
    threads: [] as Array<{
      thread: TThread;
      activity: ProjectNavigationThreadActivity;
      connected: boolean;
      matches: boolean;
      updatedAt: number;
    }>,
  }));
  const groupsByProject = new Map<string, Array<(typeof groups)[number]>>();
  for (const state of groups) {
    const seen = new Set<string>();
    for (const ref of state.group.projectRefs) {
      const key = entityKey(ref.environmentId, ref.projectId);
      if (seen.has(key)) continue;
      seen.add(key);
      const matches = groupsByProject.get(key);
      if (matches) matches.push(state);
      else groupsByProject.set(key, [state]);
    }
  }

  const uniqueThreads = new Map<string, TThread>();
  for (const thread of input.threads) {
    const key = entityKey(thread.environmentId, thread.id);
    const existing = uniqueThreads.get(key);
    if (!existing || timestamp(thread.updatedAt) > timestamp(existing.updatedAt)) {
      uniqueThreads.set(key, thread);
    }
  }
  for (const thread of uniqueThreads.values()) {
    if (thread.archivedAt != null || thread.deletedAt != null) continue;
    const states = groupsByProject.get(entityKey(thread.environmentId, thread.projectId));
    if (!states) continue;
    const row = {
      thread,
      activity: input.getThreadActivity(thread),
      connected: input.connectedEnvironmentIds?.has(thread.environmentId) ?? true,
      matches: query.length === 0 || thread.title.toLocaleLowerCase().includes(query),
      updatedAt: Math.max(timestamp(thread.updatedAt), timestamp(thread.createdAt)),
    };
    for (const state of states) state.threads.push(row);
  }

  const entries: Array<ProjectNavigationEntry<TGroup, TThread>> = [];
  for (const state of groups) {
    const groupMatches =
      query.length === 0 || state.group.title.toLocaleLowerCase().includes(query);
    const matchingThreads = groupMatches
      ? state.threads
      : state.threads.filter((row) => row.matches);
    if (!groupMatches && matchingThreads.length === 0) continue;

    const counts = {
      activeCount: 0,
      settledCount: 0,
      snoozedCount: 0,
      attentionCount: 0,
      workingCount: 0,
      failedCount: 0,
      readyCount: 0,
      offlineCount: 0,
    };
    for (const row of state.threads) {
      if (row.activity === "settled") counts.settledCount++;
      else counts.activeCount++;
      if (!row.connected) {
        counts.offlineCount++;
        continue;
      }
      switch (row.activity) {
        case "attention":
          counts.attentionCount++;
          break;
        case "working":
          counts.workingCount++;
          break;
        case "failed":
          counts.failedCount++;
          break;
        case "ready":
          counts.readyCount++;
          break;
        case "snoozed":
          counts.snoozedCount++;
          break;
        case "settled":
          break;
      }
    }
    const previews = [...matchingThreads].sort((left, right) => {
      // Offline snapshots must not take attention priority over live work.
      const leftPriority = left.connected ? ACTIVITY_PRIORITY[left.activity] : 6;
      const rightPriority = right.connected ? ACTIVITY_PRIORITY[right.activity] : 6;
      return (
        leftPriority - rightPriority ||
        right.updatedAt - left.updatedAt ||
        entityKey(left.thread.environmentId, left.thread.id).localeCompare(
          entityKey(right.thread.environmentId, right.thread.id),
        )
      );
    });
    entries.push({
      key: state.group.key,
      title: state.group.title,
      group: state.group,
      threadCount: state.threads.length,
      ...counts,
      environmentIds: [...new Set(state.group.projectRefs.map((ref) => ref.environmentId))],
      previewThreads: previews.slice(0, PROJECT_NAVIGATION_PREVIEW_LIMIT).map((row) => row.thread),
      hiddenThreadCount: Math.max(0, previews.length - PROJECT_NAVIGATION_PREVIEW_LIMIT),
    });
  }
  return entries;
}
