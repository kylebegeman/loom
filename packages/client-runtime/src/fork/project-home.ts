import type { EnvironmentId, ProjectId, ScopedProjectRef } from "@t3tools/contracts";

import type {
  ProjectNavigationThread,
  ProjectNavigationThreadActivity,
} from "./project-navigation.ts";

export type ProjectHomeSectionId =
  | "attention"
  | "working"
  | "ready"
  | "snoozed"
  | "history"
  | "offline";

export interface ProjectHomeThreadRow<TThread extends ProjectNavigationThread> {
  readonly thread: TThread;
  readonly activity: ProjectNavigationThreadActivity;
  readonly connected: boolean;
}

const SECTIONS = [
  { id: "attention", title: "Needs attention" },
  { id: "working", title: "Working" },
  { id: "ready", title: "Ready to continue" },
  { id: "snoozed", title: "Snoozed" },
  { id: "history", title: "Settled history" },
  { id: "offline", title: "Last known on offline computers" },
] as const;

function entityKey(environmentId: string, id: string): string {
  return JSON.stringify([environmentId, id]);
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sectionFor(activity: ProjectNavigationThreadActivity): ProjectHomeSectionId {
  switch (activity) {
    case "attention":
    case "failed":
      return "attention";
    case "settled":
      return "history";
    default:
      return activity;
  }
}

/** The full project view keeps cached conversations, without treating old host activity as live.
 * Supply the client's existing classifier so provider, pending-work and capability rules agree
 * with its thread list. Consumers page these shell rows without loading conversation bodies.
 */
export function buildProjectHome<TThread extends ProjectNavigationThread>(input: {
  readonly projectRefs: ReadonlyArray<ScopedProjectRef>;
  readonly threads: ReadonlyArray<TThread>;
  readonly getThreadActivity: (thread: TThread) => ProjectNavigationThreadActivity;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
}) {
  const projects = new Set(
    input.projectRefs.map((ref) => entityKey(ref.environmentId, ref.projectId)),
  );
  const unique = new Map<string, TThread>();
  for (const thread of input.threads) {
    const key = entityKey(thread.environmentId, thread.id);
    const previous = unique.get(key);
    if (!previous || timestamp(thread.updatedAt) > timestamp(previous.updatedAt)) {
      unique.set(key, thread);
    }
  }
  const buckets: Record<ProjectHomeSectionId, Array<ProjectHomeThreadRow<TThread>>> = {
    attention: [],
    working: [],
    ready: [],
    snoozed: [],
    history: [],
    offline: [],
  };
  let settledCount = 0;
  for (const thread of unique.values()) {
    if (
      thread.archivedAt != null ||
      thread.deletedAt != null ||
      !projects.has(entityKey(thread.environmentId, thread.projectId))
    )
      continue;
    const activity = input.getThreadActivity(thread);
    const connected = input.connectedEnvironmentIds.has(thread.environmentId);
    if (activity === "settled") settledCount++;
    buckets[connected ? sectionFor(activity) : "offline"].push({ thread, activity, connected });
  }
  const sections = SECTIONS.map((section) => ({
    ...section,
    rows: buckets[section.id].sort(
      (left, right) =>
        Number(left.activity === "failed") - Number(right.activity === "failed") ||
        Math.max(timestamp(right.thread.updatedAt), timestamp(right.thread.createdAt)) -
          Math.max(timestamp(left.thread.updatedAt), timestamp(left.thread.createdAt)) ||
        entityKey(left.thread.environmentId, left.thread.id).localeCompare(
          entityKey(right.thread.environmentId, right.thread.id),
        ),
    ),
  }));
  return {
    sections,
    counts: {
      total: sections.reduce((count, section) => count + section.rows.length, 0),
      attention: buckets.attention.length,
      working: buckets.working.length,
      ready: buckets.ready.length,
      snoozed: buckets.snoozed.length,
      settled: settledCount,
      offline: buckets.offline.length,
    },
  } as const;
}

/** An explicit computer choice stays explicit when its host loses access or disconnects. */
export function resolveProjectHomeDestination<
  TProject extends { readonly environmentId: EnvironmentId; readonly id: ProjectId },
>(input: {
  readonly memberProjects: ReadonlyArray<TProject>;
  readonly preferredProjectRef?: ScopedProjectRef;
  readonly chosenProjectRef?: ScopedProjectRef | null;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly permittedEnvironmentIds: ReadonlySet<EnvironmentId>;
}): TProject | null {
  const eligible = (project: TProject) =>
    input.connectedEnvironmentIds.has(project.environmentId) &&
    input.permittedEnvironmentIds.has(project.environmentId);
  const matches = (project: TProject, ref: ScopedProjectRef) =>
    project.environmentId === ref.environmentId && project.id === ref.projectId;
  const chosenProjectRef = input.chosenProjectRef;
  if (chosenProjectRef != null) {
    return (
      input.memberProjects.find(
        (project) => matches(project, chosenProjectRef) && eligible(project),
      ) ?? null
    );
  }
  return (
    input.memberProjects.find(
      (project) =>
        input.preferredProjectRef != null &&
        matches(project, input.preferredProjectRef) &&
        eligible(project),
    ) ??
    input.memberProjects.find(eligible) ??
    null
  );
}
