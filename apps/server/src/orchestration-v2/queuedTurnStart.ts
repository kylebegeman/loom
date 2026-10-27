import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

const QUEUED_TURN_START_GRACE_MS = 2 * 60 * 1_000;

const toMillis = (value: DateTime.Utc | null | undefined) =>
  value == null ? null : DateTime.toEpochMillis(value);

/** Absolute age bounds clock skew in both directions and expires stale pre-adoption data. */
export function threadHasQueuedTurnStart(
  thread: Pick<
    OrchestrationV2ThreadShell,
    | "latestUserMessageAt"
    | "latestRunRequestedAt"
    | "latestRunStartedAt"
    | "latestRunCompletedAt"
    | "latestRunId"
    | "status"
  >,
  nowMs: number,
): boolean {
  const messageAtMs = toMillis(thread.latestUserMessageAt);
  if (messageAtMs === null || thread.status === "failed") return false;
  const age = nowMs - messageAtMs;
  if (Number.isNaN(age) || Math.abs(age) > QUEUED_TURN_START_GRACE_MS) return false;
  if (thread.latestRunId === null) return true;
  return [
    toMillis(thread.latestRunRequestedAt),
    toMillis(thread.latestRunStartedAt),
    toMillis(thread.latestRunCompletedAt),
  ].every((value) => value === null || value < messageAtMs);
}

/** Idle workspaces have no live or queued work, including detached background commands. */
export function threadWorkspaceIdle(
  thread: Parameters<typeof threadHasQueuedTurnStart>[0] &
    Pick<
      OrchestrationV2ThreadShell,
      "activeRunId" | "pendingBackgroundTasks" | "pendingRuntimeRequest"
    >,
  now: number,
): boolean {
  return (
    thread.activeRunId === null &&
    ["idle", "completed", "interrupted", "failed", "cancelled", "rolled_back"].includes(
      thread.status,
    ) &&
    (thread.pendingBackgroundTasks?.length ?? 0) === 0 &&
    thread.pendingRuntimeRequest === null &&
    !threadHasQueuedTurnStart(thread, now)
  );
}
