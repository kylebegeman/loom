import type { ProjectNavigationThreadActivity } from "@t3tools/client-runtime/fork";

export type ProjectHomeThreadAction = "settle" | "unsettle" | "unsnooze";

export function projectHomeThreadAction(input: {
  readonly activity: ProjectNavigationThreadActivity;
  readonly connected: boolean;
  readonly canOperate: boolean;
  readonly supportsSettlement: boolean;
  readonly supportsSnooze: boolean;
}): { action: ProjectHomeThreadAction; label: string } | null {
  if (!input.connected || !input.canOperate) return null;
  if (input.activity === "settled")
    return input.supportsSettlement ? { action: "unsettle", label: "Reopen" } : null;
  if (input.activity === "snoozed")
    return input.supportsSnooze ? { action: "unsnooze", label: "Wake" } : null;
  if (input.activity === "ready" && input.supportsSettlement)
    return { action: "settle", label: "Settle" };
  return null;
}
