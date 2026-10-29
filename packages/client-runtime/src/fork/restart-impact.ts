import { threadRestartImpact, type RestartImpactThread } from "@t3tools/shared/fork/restart-impact";
export { threadRestartImpact, type RestartImpactThread } from "@t3tools/shared/fork/restart-impact";

const NAMED_BACKGROUND_THREADS = 3;

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
