import { describe, expect, it } from "vite-plus/test";

import { extractAgentNotificationDeepLink } from "../../features/agent-awareness/notificationPayload";
import { computerSettingsDeepLink, libraryPushDeepLink } from "./libraryPushDeepLink";

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

describe("away alert links", () => {
  it("opens the bot inbox and preserves the failed task and computer", () => {
    expect(libraryPushDeepLink("/bots/computer%201/inbox")).toBe("/bots/computer%201/inbox");
    expect(
      libraryPushDeepLink("/settings/scheduled-tasks?environmentId=computer%201&taskId=task%2F1"),
    ).toBe("/settings/scheduled-tasks?environmentId=computer%201&taskId=task%2F1");
    // A join prompt carries no thread, so its link alone must open Account.
    expect(tapOn({ environmentId: "library", requestId: "r1", deepLink: "/library/join/r1" })).toBe(
      "/library/settings",
    );
  });
  it("refuses foreign routes and extra query fields", () => {
    for (const value of [
      "https://example.test/bots/a/inbox",
      "//bots/a/inbox",
      "/bots/a/inbox?x=1",
      "/settings/scheduled-tasks?environmentId=a",
      "/settings/scheduled-tasks?environmentId=a&taskId=b&next=https://example.test",
      "/library/join/",
      "/library/join/r1?next=https://example.test",
      "/library/join/r1/approve",
    ])
      expect(libraryPushDeepLink(value)).toBeNull();
  });
});
