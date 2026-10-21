import { describe, expect, it } from "@effect/vitest";

import { resolveUserMessageIntentBadge } from "./userMessageIntentBadge";

describe("user message intent badge", () => {
  it("does not label turn-start or queued messages", () => {
    expect(resolveUserMessageIntentBadge(undefined)).toBeNull();
    expect(resolveUserMessageIntentBadge("turn_start")).toBeNull();
    expect(resolveUserMessageIntentBadge("queued_turn")).toBeNull();
  });

  it("explains the intent to steer without claiming delivery", () => {
    expect(resolveUserMessageIntentBadge("steer")).toEqual({
      label: "Send now",
      accessibilityLabel: "Requested delivery during the active turn",
    });
  });

  it("preserves the queued origin after promotion to steer", () => {
    expect(resolveUserMessageIntentBadge("promoted_queued_to_steer")).toEqual({
      label: "Send now",
      accessibilityLabel: "Originally queued, then requested delivery during the active turn",
    });
  });
});
