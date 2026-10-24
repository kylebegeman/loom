import { describe, expect, it } from "vite-plus/test";

import { alertPayload, LIBRARY_PUSH_TEST_ALERT } from "./apnsPayloads.ts";

describe("alertPayload", () => {
  it("builds the relay's alert shape", () => {
    // The object makePushNotificationRequest in infra/relay/src/agentActivity/ApnsClient.ts
    // builds for the same notification. The iPhone app reads deep links from `body`.
    expect(
      alertPayload({
        title: "Agent finished",
        body: "Ready for review",
        threadId: "environment-1/thread-1",
        data: {
          environmentId: "environment-1",
          threadId: "thread-1",
          deepLink: "/threads/environment-1/thread-1",
        },
      }),
    ).toEqual({
      aps: {
        alert: { title: "Agent finished", body: "Ready for review" },
        sound: "default",
        "thread-id": "environment-1/thread-1",
      },
      body: {
        environmentId: "environment-1",
        threadId: "thread-1",
        deepLink: "/threads/environment-1/thread-1",
      },
    });
  });
});

describe("LIBRARY_PUSH_TEST_ALERT", () => {
  it("is a plain alert with no custom data, so a tap only opens the app", () => {
    expect(LIBRARY_PUSH_TEST_ALERT).toEqual({
      payload: {
        aps: {
          alert: { title: "Loom", body: "Test notification from your Library" },
          sound: "default",
        },
      },
      priority: 10,
      expiresInSeconds: 300,
      collapseId: "loom-push-test",
    });
  });
});
