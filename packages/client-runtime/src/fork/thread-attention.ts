import {
  attentionThreadTimestamp,
  selectAttentionThreadShells,
  pendingSubagentAttentionRequests,
} from "@t3tools/contracts/fork";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "../state/models.ts";

export function attentionThreads(
  threads: readonly EnvironmentThreadShell[],
  nowMs: number,
): EnvironmentThreadShell[] {
  const byEnvironment = new Map<EnvironmentId, EnvironmentThreadShell[]>();
  for (const thread of threads) {
    const group = byEnvironment.get(thread.environmentId);
    if (group) group.push(thread);
    else byEnvironment.set(thread.environmentId, [thread]);
  }
  const attentionTimes = new Map<EnvironmentThreadShell, number>();
  return [...byEnvironment.values()]
    .flatMap((group) => {
      const childRequests = pendingSubagentAttentionRequests(group.map((thread) => thread.source));
      for (const thread of group)
        attentionTimes.set(
          thread,
          attentionThreadTimestamp(thread.source, childRequests.get(thread.id)),
        );
      const selected = new Set(
        selectAttentionThreadShells(
          group.map((thread) => thread.source),
          nowMs,
        ).map((thread) => thread.id),
      );
      return group.filter((thread) => selected.has(thread.id));
    })
    .sort(
      (a, b) =>
        attentionTimes.get(a)! - attentionTimes.get(b)! ||
        a.environmentId.localeCompare(b.environmentId) ||
        a.id.localeCompare(b.id),
    );
}

export function nextAttentionThread(
  threads: readonly EnvironmentThreadShell[],
  current: ScopedThreadRef | null,
): EnvironmentThreadShell | null {
  const index =
    current === null
      ? -1
      : threads.findIndex(
          (thread) =>
            thread.environmentId === current.environmentId && thread.id === current.threadId,
        );
  return threads[(index + 1) % threads.length] ?? null;
}
