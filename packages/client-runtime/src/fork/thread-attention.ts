import {
  attentionThreadTimestamp,
  isBotRunThreadId,
  threadAttentionKind,
} from "@t3tools/contracts/fork";
import { isListedThreadLineage, type ScopedThreadRef } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import type { EnvironmentThreadShell } from "../state/models.ts";
import { effectiveSnoozed } from "../state/threadSettled.ts";

export function attentionThreads(
  threads: readonly EnvironmentThreadShell[],
  nowMs: number,
): EnvironmentThreadShell[] {
  const now = DateTime.formatIso(DateTime.makeUnsafe(nowMs));
  return threads
    .filter(
      (thread) =>
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        isListedThreadLineage(thread.lineage) &&
        !isBotRunThreadId(thread.id) &&
        (thread.pendingSubagentRequest != null || threadAttentionKind(thread.source) !== null) &&
        !effectiveSnoozed(thread, { now }),
    )
    .sort(
      (a, b) =>
        attentionThreadTimestamp(a.source) - attentionThreadTimestamp(b.source) ||
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
