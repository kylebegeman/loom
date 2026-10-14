import type { MenuAction } from "@react-native-menu/menu";
import type { ProjectNavigationThreadActivity } from "@t3tools/client-runtime/fork";

/** Lifecycle controls use the current destination's capability and operation grant. */
export function projectHomeThreadActions(input: {
  readonly activity: ProjectNavigationThreadActivity;
  readonly connected: boolean;
  readonly permitted: boolean;
  readonly settlementSupported: boolean;
  readonly snoozeSupported: boolean;
}): ReadonlyArray<MenuAction> {
  if (!input.connected || !input.permitted) return [];
  if (input.activity === "snoozed")
    return input.snoozeSupported ? [{ id: "wake", title: "Wake thread", image: "clock" }] : [];
  if (!input.settlementSupported) return [];
  return input.activity === "settled"
    ? [{ id: "reopen", title: "Reopen", image: "arrow.uturn.backward" }]
    : [{ id: "settle", title: "Settle", image: "checkmark" }];
}
