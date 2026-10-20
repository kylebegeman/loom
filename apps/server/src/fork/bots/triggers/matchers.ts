import type {
  OrchestrationV2AppThread,
  ProjectId,
  ThreadId,
  ThreadPullRequestLink,
} from "@t3tools/contracts";
import {
  isBotRunThreadId,
  type BotInputValue,
  type BotTriggerEvent,
  type BotTriggerEventKind,
} from "@t3tools/contracts/fork";

/** One occurrence a trigger may fire on. */
export interface TriggerEvent {
  readonly kind: BotTriggerEventKind;
  /** Unique per occurrence; a trigger fires once per key. */
  readonly key: string;
  /** For example "acme/app#12 checks failing". */
  readonly summary: string;
  readonly fields: Readonly<Record<string, BotInputValue>>;
  readonly projectId?: ProjectId | undefined;
  readonly repository?: string | undefined;
  readonly headBranch?: string | undefined;
  /** The thread the event belongs to, whose checkout a `caller` checkout bot runs in. */
  readonly threadId?: ThreadId | undefined;
  /**
   * Set when a pull request is seen for the first time: a trigger created after this ignores it,
   * so turning a trigger on does not fire for every pull request already linked.
   */
  readonly firstSeenSince?: string | undefined;
  /** When the event happened: a trigger ignores events from before it was created. */
  readonly occurredAt?: string | undefined;
  /** A merge conflict's per-file fields: one batch item each. */
  readonly items?: ReadonlyArray<Readonly<Record<string, BotInputValue>>> | undefined;
}

/** What Loom last saw of a pull request, shared by every trigger. */
export interface PullRequestState {
  readonly checksState: string | null;
  readonly headSha: string | null;
  readonly seenOpen: boolean;
}

export const pullRequestKey = (
  link: Pick<ThreadPullRequestLink, "host" | "repository" | "number">,
) => `${link.host}/${link.repository}#${link.number}`;

/**
 * Checks failing fires on a change to `failing`, or on a new head while failing; opened fires the
 * first time a pull request is seen open. `next` is null when there is nothing to record.
 */
export const matchPullRequestLink = (
  link: ThreadPullRequestLink,
  thread: { readonly threadId: ThreadId; readonly projectId: ProjectId | null },
  previous: PullRequestState | null,
  occurredAt: string,
): { readonly next: PullRequestState | null; readonly events: ReadonlyArray<TriggerEvent> } => {
  const snapshot = link.snapshot;
  if (snapshot === null || isBotRunThreadId(thread.threadId)) return { next: null, events: [] };
  const key = pullRequestKey(link);
  const label = `${link.repository}#${link.number}`;
  const checksState = snapshot.checksState ?? null;
  const headSha = link.watch?.headSha ?? null;
  const open = snapshot.state === "open";
  const next: PullRequestState = {
    checksState,
    headSha: headSha ?? previous?.headSha ?? null,
    seenOpen: (previous?.seenOpen ?? false) || open,
  };
  const base = {
    repository: link.repository,
    number: link.number,
    url: link.url,
    title: snapshot.title,
    headBranch: snapshot.headBranch,
    baseBranch: snapshot.baseBranch,
    threadId: thread.threadId,
  };
  const shared = {
    ...(thread.projectId === null ? {} : { projectId: thread.projectId }),
    repository: link.repository,
    headBranch: snapshot.headBranch,
    threadId: thread.threadId,
    occurredAt,
    ...(previous === null ? { firstSeenSince: link.linkedAt } : {}),
  };
  const events: Array<TriggerEvent> = [];

  const newHead = headSha !== null && previous?.headSha != null && previous.headSha !== headSha;
  if (open && checksState === "failing" && (previous?.checksState !== "failing" || newHead)) {
    const failedChecks = link.watch?.failedChecks ?? [];
    events.push({
      kind: "pull-request-checks-failing",
      key: `${key}@${headSha ?? snapshot.syncedAt.slice(0, 10)}`,
      summary: `${label} checks failing`,
      fields: { ...base, failedChecks: failedChecks.join(", ") },
      ...shared,
    });
  }
  if (open && previous === null)
    events.push({
      kind: "pull-request-opened",
      key,
      summary: `${label} opened`,
      fields: base,
      ...shared,
    });
  return { next, events };
};

/** A settled thread, except bot runs and drafting threads, so a bot cannot trigger itself. */
export const matchThreadSettled = (
  thread: OrchestrationV2AppThread,
  sequence: number,
  occurredAt: string,
): TriggerEvent | null => {
  if (isBotRunThreadId(thread.id)) return null;
  return {
    kind: "thread-settled",
    key: `${thread.id}@${sequence}`,
    summary: `${thread.title} settled`,
    fields: {
      threadId: thread.id,
      title: thread.title,
      projectId: thread.projectId,
      ...(thread.branch === null ? {} : { branch: thread.branch }),
    },
    projectId: thread.projectId,
    threadId: thread.id,
    occurredAt,
  };
};

/** `*` matches any run of characters; everything else is literal. */
export const branchMatches = (pattern: string, branch: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
  ).test(branch);

/** The trigger's filters: project, repository and branch pattern. */
export const eventPasses = (
  trigger: { readonly event: BotTriggerEvent; readonly createdAt: string },
  event: TriggerEvent,
): boolean => {
  const filter = trigger.event;
  if (filter.kind !== event.kind) return false;
  if (event.occurredAt !== undefined && event.occurredAt < trigger.createdAt) return false;
  if (event.firstSeenSince !== undefined && event.firstSeenSince < trigger.createdAt) return false;
  switch (filter.kind) {
    case "pull-request-checks-failing":
    case "pull-request-opened":
      if (filter.projectId !== undefined && filter.projectId !== event.projectId) return false;
      if (
        filter.repository !== undefined &&
        filter.repository.toLowerCase() !== event.repository?.toLowerCase()
      )
        return false;
      return (
        filter.branchPattern === undefined ||
        (event.headBranch !== undefined && branchMatches(filter.branchPattern, event.headBranch))
      );
    case "thread-settled":
      return filter.projectId === event.projectId;
    default:
      return true;
  }
};
