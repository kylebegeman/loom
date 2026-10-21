import { describe, expect, it } from "vite-plus/test";

import {
  resolveThreadRecoveryPresentation,
  resolveWorkspacePreparationError,
} from "./threadRecoveryPresentation";

const ready = {
  connectionState: "connected" as const,
  queuedMessages: [],
  dispatchingMessageId: null,
  delivery: null,
  acknowledged: false,
  runtimeStatus: "idle" as const,
  workspaceError: null,
  queueHeld: false,
  canOperate: true,
};

describe("thread interruption recovery presentation", () => {
  it("keeps an unsent offline message visibly queued with a reconnect action", () => {
    expect(
      resolveThreadRecoveryPresentation({
        ...ready,
        connectionState: "offline",
        queuedMessages: [{ messageId: "one" }],
      }),
    ).toMatchObject({ title: "1 message queued on this phone", action: "reconnect" });
  });

  it("does not call an interrupted request unsent or offer a blind send retry", () => {
    const result = resolveThreadRecoveryPresentation({
      ...ready,
      connectionState: "reconnecting",
      queuedMessages: [{ messageId: "one", deliveryAttempted: true }],
    });
    expect(result).toMatchObject({
      title: "Waiting for delivery confirmation",
      action: "reconnect",
    });
    expect(result?.detail).toContain("may already have arrived");
  });

  it("recovers uncertainty after restart without needing an in-memory dispatch", () => {
    expect(
      resolveThreadRecoveryPresentation({
        ...ready,
        queuedMessages: [{ messageId: "one", deliveryAttempted: true }],
      }),
    ).toMatchObject({ title: "Checking message delivery", action: null });
  });

  it("distinguishes preparation, a first send, and acknowledgement", () => {
    const queuedMessages = [{ messageId: "one" }];
    expect(
      resolveThreadRecoveryPresentation({ ...ready, queuedMessages, dispatchingMessageId: "one" })
        ?.title,
    ).toBe("Preparing message");
    expect(
      resolveThreadRecoveryPresentation({
        ...ready,
        queuedMessages,
        dispatchingMessageId: "one",
        delivery: { messageId: "one", phase: "sending" },
      })?.title,
    ).toBe("Sending message");
    expect(resolveThreadRecoveryPresentation({ ...ready, acknowledged: true })?.title).toBe(
      "Message accepted",
    );
  });

  it("explains reconnect recovery and preserves draft editing when nothing was submitted", () => {
    expect(
      resolveThreadRecoveryPresentation({ ...ready, connectionState: "reconnecting" }),
    ).toMatchObject({
      title: "Reconnecting",
      detail: expect.stringContaining("draft"),
      action: "reconnect",
    });
    expect(resolveThreadRecoveryPresentation(ready)).toBeNull();
  });

  it("does not promise delivery while the connection cannot control a task", () => {
    expect(
      resolveThreadRecoveryPresentation({
        ...ready,
        canOperate: false,
        queuedMessages: [{ messageId: "one" }],
      }),
    ).toMatchObject({ title: "Queued messages are waiting for access", action: "connection" });
  });

  it("describes workspace preparation without inventing a separate restore phase", () => {
    const result = resolveThreadRecoveryPresentation({ ...ready, runtimeStatus: "preparing" });
    expect(result).toMatchObject({ title: "Preparing files", action: null });
    expect(result?.detail).toContain("restoring saved files if needed");
    expect(resolveThreadRecoveryPresentation({ ...ready, runtimeStatus: "starting" })?.title).toBe(
      "Starting agent",
    );
  });

  it("shows a confirmed restoration failure and clears it when another turn starts", () => {
    expect(
      resolveThreadRecoveryPresentation({
        ...ready,
        runtimeStatus: "failed",
        workspaceError: "Saved files are unavailable.",
      }),
    ).toMatchObject({
      title: "Could not prepare files",
      detail: expect.stringContaining("Saved files are unavailable."),
      action: "files",
    });
    expect(
      resolveThreadRecoveryPresentation({
        ...ready,
        runtimeStatus: "running",
        workspaceError: "Old failure",
      }),
    ).toBeNull();
  });

  it("does not let a held server queue silently appear ready to run", () => {
    expect(resolveThreadRecoveryPresentation({ ...ready, queueHeld: true })).toMatchObject({
      title: "Queue paused",
      action: "resume",
    });
  });
});

describe("workspace preparation recovery errors", () => {
  const items = [
    {
      item: {
        type: "error",
        runId: "failed-run",
        title: "Workspace preparation failed",
        failure: { message: "Cannot restore saved files." },
      },
    },
  ];
  it("uses the server's restoration failure only for the failed run", () => {
    expect(
      resolveWorkspacePreparationError({ runtimeStatus: "failed", runId: "failed-run", items }),
    ).toBe("Cannot restore saved files.");
    expect(
      resolveWorkspacePreparationError({ runtimeStatus: "failed", runId: "other-run", items }),
    ).toBeNull();
    expect(
      resolveWorkspacePreparationError({ runtimeStatus: "starting", runId: "failed-run", items }),
    ).toBeNull();
    expect(
      resolveWorkspacePreparationError({ runtimeStatus: "failed", runId: null, items }),
    ).toBeNull();
  });
  it("does not turn an unrelated provider failure into a file restoration error", () => {
    expect(
      resolveWorkspacePreparationError({
        runtimeStatus: "failed",
        runId: "failed-run",
        items: [{ item: { ...items[0]!.item, title: "Provider failed" } }],
      }),
    ).toBeNull();
  });
});
