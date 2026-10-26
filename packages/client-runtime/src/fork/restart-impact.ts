import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { backgroundWorkHoldsCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";

/**
 * Pull request watches come back from the thread's links when its server starts, so a restart
 * does not stop them. This is the task id prefix the shared pending-work roster gives them.
 */
const PULL_REQUEST_WATCH_TASK_PREFIX = "pull-request-watch:";
const NAMED_BACKGROUND_THREADS = 3;

export type RestartImpactThread = Pick<
  OrchestrationV2ThreadShell,
  "title" | "status" | "activityRunStatus" | "pendingBackgroundTasks"
>;

/**
 * The shell's status skips held queues, so a queued run here is one that would otherwise start,
 * and a waiting run is still capturing its checkpoint. A settled turn counts when work that holds
 * its completion would stop: a subagent, a background task, or a command or monitor it awaits.
 */
export function threadRestartImpact(thread: RestartImpactThread): "working" | "background" | null {
  if (
    thread.activityRunStatus != null ||
    thread.status === "preparing" ||
    thread.status === "queued" ||
    thread.status === "starting" ||
    thread.status === "running" ||
    thread.status === "waiting"
  ) {
    return "working";
  }
  const stopping = (thread.pendingBackgroundTasks ?? []).filter(
    (task) => !task.taskId.startsWith(PULL_REQUEST_WATCH_TASK_PREFIX),
  );
  return backgroundWorkHoldsCompletion(stopping) ? "background" : null;
}

export interface RestartImpact {
  /** Interrupted threads on servers that do not continue threads after a restart. */
  readonly stopped: number;
  /** Interrupted threads that resume once their server is back. */
  readonly continuing: number;
  /** Interrupted threads whose turn ended but whose background work would stop, by title. */
  readonly background: ReadonlyArray<string>;
}

export const NO_RESTART_IMPACT: RestartImpact = { stopped: 0, continuing: 0, background: [] };

export function collectRestartImpact(
  servers: Iterable<{
    readonly continuesThreads: boolean;
    readonly threads: ReadonlyArray<RestartImpactThread>;
  }>,
): RestartImpact {
  let stopped = 0;
  let continuing = 0;
  const background: string[] = [];
  for (const server of servers) {
    for (const thread of server.threads) {
      const impact = threadRestartImpact(thread);
      if (impact === null) continue;
      if (server.continuesThreads) continuing += 1;
      else stopped += 1;
      if (impact === "background") background.push(thread.title);
    }
  }
  return stopped + continuing === 0 ? NO_RESTART_IMPACT : { stopped, continuing, background };
}

export function restartInterruptsWork(impact: RestartImpact): boolean {
  return impact.stopped + impact.continuing > 0;
}

export function sameRestartImpact(left: RestartImpact, right: RestartImpact): boolean {
  return (
    left.stopped === right.stopped &&
    left.continuing === right.continuing &&
    left.background.length === right.background.length &&
    left.background.every((title, index) => title === right.background[index])
  );
}

function joinList(parts: ReadonlyArray<string>): string {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

export function describeRestartImpact(impact: RestartImpact): ReadonlyArray<string> {
  const interrupted = impact.stopped + impact.continuing;
  if (interrupted === 0) return [];
  const threads = `${interrupted} ${interrupted === 1 ? "thread" : "threads"} with work in progress`;
  const lines = [
    impact.stopped === 0
      ? `${threads} will be interrupted and can resume after the restart.`
      : impact.continuing === 0
        ? `${threads} will be interrupted.`
        : `${threads} will be interrupted. ${impact.continuing} can resume after the restart.`,
  ];
  if (impact.background.length > 0) {
    const named = impact.background.slice(0, NAMED_BACKGROUND_THREADS).map((title) => `"${title}"`);
    const more = impact.background.length - named.length;
    lines.push(
      `Waiting on background work: ${joinList(more > 0 ? [...named, `${more} more`] : named)}.`,
    );
  }
  return lines;
}
