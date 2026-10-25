import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * A thread its owner parked, snoozed until later or settled, keeps quiet about its own completed
 * runs: PR watches and background tasks wake it without anyone asking. Approvals, questions and
 * failures still alert, because the snooze contract lets exactly those bring a thread back early.
 * Every alert surface (desktop, in-app and phone pushes) applies the same rule.
 */
export function threadCompletionAlertMuted(
  thread: Pick<OrchestrationV2ThreadShell, "settledOverride" | "snoozedUntil">,
  now: DateTime.Utc,
): boolean {
  if (thread.settledOverride === "settled") return true;
  return thread.snoozedUntil != null && DateTime.isGreaterThan(thread.snoozedUntil, now);
}
