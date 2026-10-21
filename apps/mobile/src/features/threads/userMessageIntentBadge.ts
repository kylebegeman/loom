import type { OrchestrationV2UserMessageInputIntent } from "@t3tools/contracts";

export interface UserMessageIntentBadgePresentation {
  readonly label: string;
  readonly accessibilityLabel: string;
}

export function resolveUserMessageIntentBadge(
  intent: OrchestrationV2UserMessageInputIntent | undefined,
): UserMessageIntentBadgePresentation | null {
  switch (intent) {
    case "steer":
      return {
        label: "Send now",
        accessibilityLabel: "Requested delivery during the active turn",
      };
    case "promoted_queued_to_steer":
      return {
        label: "Send now",
        accessibilityLabel: "Originally queued, then requested delivery during the active turn",
      };
    case "queued_turn":
    case "turn_start":
    case undefined:
      return null;
  }
}
