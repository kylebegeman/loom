/**
 * Groups the sidebar's threads by project for its Projects view. Nothing here knows about the
 * Library: the caller supplies `keyOf`, so the same grouping works with upstream's logical project
 * key (`sidebarProjectsByLocalProject`) or with the fork's Library key.
 */

/** The project a thread is shown under. Threads with equal keys share one group. */
export interface SidebarThreadProject {
  readonly key: string;
  readonly title: string;
}

export interface SidebarProjectThreadGroup<TProject extends SidebarThreadProject, TThread> {
  readonly project: TProject;
  readonly threads: ReadonlyArray<TThread>;
}

export interface SidebarThreadsByProject<TProject extends SidebarThreadProject, TThread> {
  /** Ordered by title, so a group keeps its place while its threads change. */
  readonly groups: ReadonlyArray<SidebarProjectThreadGroup<TProject, TThread>>;
  /** Threads no project claims, shown last under their own heading. */
  readonly unclaimed: ReadonlyArray<TThread>;
}

const compareTitles = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

/**
 * Threads keep their input order inside a group, after `rankOf` (lower first). The first thread
 * seen for a key supplies its group's project, so `keyOf` should return one project per key.
 */
export function groupSidebarThreadsByProject<TThread, TProject extends SidebarThreadProject>(
  threads: ReadonlyArray<TThread>,
  keyOf: (thread: TThread) => TProject | null,
  options?: { readonly rankOf?: (thread: TThread) => number },
): SidebarThreadsByProject<TProject, TThread> {
  const rankOf = options?.rankOf;
  const byKey = new Map<string, { project: TProject; threads: TThread[] }>();
  const unclaimed: TThread[] = [];
  for (const thread of threads) {
    const project = keyOf(thread);
    if (project === null) {
      unclaimed.push(thread);
      continue;
    }
    const group = byKey.get(project.key);
    if (group) group.threads.push(thread);
    else byKey.set(project.key, { project, threads: [thread] });
  }
  // Array.prototype.sort is stable, so equal ranks keep the caller's order.
  const ranked = (list: TThread[]) =>
    rankOf ? list.sort((left, right) => rankOf(left) - rankOf(right)) : list;
  const groups = [...byKey.values()]
    .map((group) => ({ project: group.project, threads: ranked(group.threads) }))
    .sort(
      (left, right) =>
        compareTitles(left.project.title, right.project.title) ||
        (left.project.key < right.project.key ? -1 : left.project.key > right.project.key ? 1 : 0),
    );
  return { groups, unclaimed: ranked(unclaimed) };
}

/** The lookup key for one local project on one environment. */
export function sidebarLocalProjectKey(environmentId: string, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

/**
 * Upstream's grouping as a `keyOf` source: each local project maps to the logical project group
 * that holds it, so one repository on two environments shares a group.
 */
export function sidebarProjectsByLocalProject<
  TGroup extends {
    readonly projectKey: string;
    readonly displayName: string;
    readonly memberProjectRefs: ReadonlyArray<{
      readonly environmentId: string;
      readonly projectId: string;
    }>;
  },
>(groups: ReadonlyArray<TGroup>): ReadonlyMap<string, SidebarThreadProject & { group: TGroup }> {
  const byLocalProject = new Map<string, SidebarThreadProject & { group: TGroup }>();
  for (const group of groups) {
    const project = { key: group.projectKey, title: group.displayName, group };
    for (const ref of group.memberProjectRefs) {
      byLocalProject.set(sidebarLocalProjectKey(ref.environmentId, ref.projectId), project);
    }
  }
  return byLocalProject;
}
