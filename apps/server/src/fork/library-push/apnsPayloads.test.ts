import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { agentAlertRequest, alertPayload, LIBRARY_PUSH_TEST_ALERT } from "./apnsPayloads.ts";

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

describe("agentAlertRequest", () => {
  const environmentId = EnvironmentId.make("environment-1");
  const threadId = ThreadId.make("thread-1");

  it("names no thread, project, computer or model, and carries what a tap needs", () => {
    expect(agentAlertRequest({ environmentId, threadId, kind: "input" })).toEqual({
      payload: {
        aps: {
          alert: { title: "Loom", body: "An agent is waiting for your answer." },
          sound: "default",
          "thread-id": "environment-1/thread-1",
        },
        body: {
          environmentId: "environment-1",
          threadId: "thread-1",
          deepLink: "/threads/environment-1/thread-1",
        },
      },
      priority: 10,
      expiresInSeconds: 300,
      collapseId: expect.stringMatching(/^loom-agent-[\w-]{22}$/),
    });
  });

  it("collapses every kind for one thread into one notification within Apple's 64 bytes", () => {
    const kinds = ["approval", "input", "failed", "limited", "completed"] as const;
    const collapseIds = new Set(
      kinds.map((kind) => agentAlertRequest({ environmentId, threadId, kind }).collapseId),
    );
    expect(collapseIds.size).toBe(1);
    expect(
      collapseIds.has(
        agentAlertRequest({ environmentId, threadId: ThreadId.make("thread-2"), kind: "input" })
          .collapseId,
      ),
    ).toBe(false);
    const longest = agentAlertRequest({
      environmentId: EnvironmentId.make("e".repeat(256)),
      threadId: ThreadId.make("t".repeat(256)),
      kind: "completed",
    });
    expect(new TextEncoder().encode(longest.collapseId).length).toBeLessThanOrEqual(64);
  });
});
