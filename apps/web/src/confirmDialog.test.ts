import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  completeConfirmDialogClose,
  readConfirmDialogState,
  requestConfirmDialog,
  resetConfirmDialogForTests,
  respondToConfirmDialog,
  subscribeConfirmDialogHost,
} from "./confirmDialog";

const mountHost = () => subscribeConfirmDialogHost(() => {});

function requireConfirmation(confirmation: Promise<boolean> | undefined): Promise<boolean> {
  if (!confirmation) {
    throw new Error("Expected a registered confirmation host.");
  }
  return confirmation;
}

describe("confirm dialog coordinator", () => {
  beforeEach(() => {
    resetConfirmDialogForTests();
  });

  it("serializes concurrent confirmations", async () => {
    const unregister = mountHost();
    const first = requireConfirmation(requestConfirmDialog("Delete the project?"));
    const second = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    respondToConfirmDialog(false);
    await expect(first).resolves.toBe(false);
    expect(readConfirmDialogState()).toEqual({
      status: "closing",
      message: "Delete the project?",
      variant: "default",
    });

    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Delete the worktree too?",
      variant: "default",
    });

    respondToConfirmDialog(true);
    await expect(second).resolves.toBe(true);
    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
  });

  it("cancels active and queued confirmations if the last host unmounts", async () => {
    const unregister = mountHost();
    const active = requireConfirmation(requestConfirmDialog("Delete the thread?"));
    const queued = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));

    unregister();

    await expect(Promise.all([active, queued])).resolves.toEqual([false, false]);
    expect(readConfirmDialogState()).toEqual({ status: "idle" });
  });

  it("has no host until one subscribes", () => {
    expect(requestConfirmDialog("Continue?")).toBeUndefined();
    const unsubscribe = mountHost();
    expect(requestConfirmDialog("Continue?")).toBeDefined();
    unsubscribe();
    expect(requestConfirmDialog("Continue?")).toBeUndefined();
  });

  it("ignores responses after the active dialog has been closed", () => {
    const unregister = mountHost();
    const confirmation = requireConfirmation(requestConfirmDialog("Continue?"));

    respondToConfirmDialog(true);
    respondToConfirmDialog(false);
    completeConfirmDialogClose();

    expect(readConfirmDialogState()).toEqual({ status: "idle" });
    unregister();
    return expect(confirmation).resolves.toBe(true);
  });

  // fork: confirm-label: each dialog keeps its own button label while it shows and closes.
  it("keeps each confirmation's button label through closing and the queue", async () => {
    const unregister = registerConfirmDialogHost();
    const first = requireConfirmation(
      requestConfirmDialog("Turn reach off?", {
        variant: "destructive",
        confirmLabel: "Turn off",
        cancelLabel: "Keep on",
      }),
    );
    const second = requireConfirmation(requestConfirmDialog("Delete the worktree too?"));
    expect(readConfirmDialogState()).toMatchObject({
      confirmLabel: "Turn off",
      cancelLabel: "Keep on",
    });

    respondToConfirmDialog(true);
    await expect(first).resolves.toBe(true);
    expect(readConfirmDialogState()).toMatchObject({
      status: "closing",
      confirmLabel: "Turn off",
      cancelLabel: "Keep on",
    });

    completeConfirmDialogClose();
    expect(readConfirmDialogState()).toEqual({
      status: "confirming",
      message: "Delete the worktree too?",
      variant: "default",
    });

    respondToConfirmDialog(false);
    await expect(second).resolves.toBe(false);
    unregister();
  });
});
