import * as DateTime from "effect/DateTime";
import {
  isProviderNativeSubagentThread,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2PendingRuntimeRequestSummary,
} from "../orchestrationV2.ts";
import { isBotRunThreadId } from "./bots.ts";

export type ThreadAttentionKind = "approval" | "input" | "paused" | "failed" | "limited";

export function threadAttentionKind(
  thread: OrchestrationV2ThreadShell,
): ThreadAttentionKind | null {
  const request = thread.pendingRuntimeRequest;
  const status = thread.activityRunStatus ?? thread.status;
  if (request && request.kind !== "auth_refresh") {
    if (request.kind !== "user_input") return "approval";
    if (request.blocking !== false || !["preparing", "starting", "running"].includes(status))
      return "input";
  }
  if (thread.queueHeld) return "paused";
  if (status === "failed") return thread.lastErrorClass === "usage_limit" ? "limited" : "failed";
  return null;
}

/** A live child's question belongs in its visible parent's attention entry. */
export function pendingSubagentAttentionRequests(threads: readonly OrchestrationV2ThreadShell[]) {
  const requests = new Map<
    OrchestrationV2ThreadShell["id"],
    OrchestrationV2PendingRuntimeRequestSummary
  >();
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  for (const child of threads) {
    const request = child.pendingRuntimeRequest;
    const live =
      child.activityRunStatus !== undefined
        ? child.activityRunStatus !== null
        : ["preparing", "starting", "running", "waiting"].includes(child.status);
    if (
      child.lineage.relationshipToParent !== "subagent" ||
      isProviderNativeSubagentThread(child) ||
      child.archivedAt !== null ||
      child.deletedAt !== null ||
      !live ||
      request == null ||
      request.kind === "auth_refresh"
    )
      continue;
    const seen = new Set([child.id]);
    let current = child;
    while (current.lineage.relationshipToParent === "subagent") {
      const parentId = current.lineage.parentThreadId;
      if (parentId === null || seen.has(parentId)) break;
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      const prior = requests.get(parentId);
      if (
        prior == null ||
        (prior.kind === "user_input" && request.kind !== "user_input") ||
        ((prior.kind === "user_input") === (request.kind === "user_input") &&
          DateTime.toEpochMillis(request.createdAt) < DateTime.toEpochMillis(prior.createdAt))
      )
        requests.set(parentId, request);
      current = parent;
    }
  }
  return requests;
}

/** Shell-only classification shared by client attention counts and agent reads. */
export function selectAttentionThreadShells(
  threads: readonly OrchestrationV2ThreadShell[],
  nowMs: number,
) {
  const childRequests = pendingSubagentAttentionRequests(threads);
  return threads
    .filter((thread) => {
      const childRequest = childRequests.get(thread.id);
      const kind = childRequest
        ? childRequest.kind === "user_input"
          ? "input"
          : "approval"
        : threadAttentionKind(thread);
      if (
        !kind ||
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.lineage.relationshipToParent === "subagent" ||
        isBotRunThreadId(thread.id)
      )
        return false;
      if (thread.snoozedUntil && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs) {
        // A fresh question or failure wakes a snooze, matching the thread lists.
        const freshFailure =
          thread.status === "failed" &&
          (thread.snoozedAt == null ||
            (thread.latestRunCompletedAt != null &&
              DateTime.toEpochMillis(thread.latestRunCompletedAt) >
                DateTime.toEpochMillis(thread.snoozedAt)));
        if (
          thread.pendingRuntimeRequest === null &&
          kind !== "approval" &&
          kind !== "input" &&
          !freshFailure
        )
          return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        attentionThreadTimestamp(a, childRequests.get(a.id)) -
          attentionThreadTimestamp(b, childRequests.get(b.id)) || a.id.localeCompare(b.id),
    );
}

export function attentionThreadTimestamp(
  thread: OrchestrationV2ThreadShell,
  childRequest?: OrchestrationV2PendingRuntimeRequestSummary,
): number {
  return DateTime.toEpochMillis(
    thread.pendingRuntimeRequest?.createdAt ??
      childRequest?.createdAt ??
      thread.latestRunCompletedAt ??
      thread.latestRunRequestedAt ??
      thread.updatedAt,
  );
}
