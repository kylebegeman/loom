import { describe, expect, it } from "vite-plus/test";

import { extractAgentNotificationDeepLink } from "../../features/agent-awareness/notificationPayload";
import { computerSettingsDeepLink } from "./libraryPushDeepLink";

const tapOn = (data: Record<string, unknown>) =>
  extractAgentNotificationDeepLink({ notification: { request: { content: { data } } } });

describe("Vault approval alert taps", () => {
  it("open the computer's settings, where Vault access lists the request", () => {
    expect(
      tapOn({
        environmentId: "computer 1",
        threadId: "thread-1",
        deepLink: "/settings/environments/computer%201",
      }),
    ).toBe("/settings/environments/computer%201");
  });

  it("fall back to the requesting thread when the link is not one the app opens", () => {
    expect(
      tapOn({
        environmentId: "computer-1",
        threadId: "thread-1",
        deepLink: "/settings/environments/computer-1/vault",
      }),
    ).toBe("/threads/computer-1/thread-1");
  });

  it("accept only the computer settings route", () => {
    for (const link of [
      "/settings",
      "/settings/environments/",
      "/settings/environments/a?x=1",
      "/settings/environments/a#top",
      "/settings/legal/a",
      " /settings/environments/a",
      "//settings/environments/a",
      "/settings/environments/%E0%A4%A",
    ]) {
      expect(computerSettingsDeepLink(link)).toBeNull();
    }
  });
});
