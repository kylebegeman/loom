import { MessageId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { act, render } from "../../../test/render";
import { openRevertConfirm, RevertConfirmHost } from "./ChatOverlayHosts";

// fork: project-lifecycle
const messageId = MessageId.make("message-1");
const pending = {
  turnCount: 2,
  messageId,
  checkpointId: "checkpoint-1",
  scopeId: "scope-1",
  canRestoreFiles: true,
  reason: null,
};
const dialog = () => document.querySelector('[role="alertdialog"]');

describe("RevertConfirmHost", () => {
  it("shows only its thread's request, confirms it once, and drops it when the thread changes", async () => {
    const onConfirm = vi.fn();
    const host = (threadKey: string) => (
      <AppAtomRegistryProvider>
        {/* fork: project-lifecycle */}
        <RevertConfirmHost
          threadKey={threadKey}
          canOperate
          onConfirm={onConfirm}
          onFork={vi.fn()}
        />
      </AppAtomRegistryProvider>
    );
    await using screen = await render(host("env:a"));

    await act(() => openRevertConfirm("env:b", pending)); // fork: project-lifecycle
    expect(dialog()).toBeNull();

    await act(() => openRevertConfirm("env:a", pending)); // fork: project-lifecycle
    const keep = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Revert and keep changes",
    );
    await act(() => keep?.click());
    // fork: project-lifecycle
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(pending, false);
    await vi.waitFor(() => expect(dialog()).toBeNull());

    await act(() => openRevertConfirm("env:a", { ...pending, turnCount: 3 })); // fork: project-lifecycle
    expect(dialog()).not.toBeNull();
    await screen.rerender(host("env:b"));
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });
});

// fork: project-lifecycle
it("explains shared workspace restrictions and forks without confirming a restore", async () => {
  const onFork = vi.fn();
  const onConfirm = vi.fn();
  await using _screen = await render(
    <AppAtomRegistryProvider>
      <RevertConfirmHost threadKey="env:shared" canOperate onConfirm={onConfirm} onFork={onFork} />
    </AppAtomRegistryProvider>,
  );
  await act(() =>
    openRevertConfirm("env:shared", {
      ...pending,
      canRestoreFiles: false,
      reason: "This workspace is shared.",
    }),
  );
  expect(dialog()?.textContent).toContain("This workspace is shared.");
  const buttons = [...(dialog()?.querySelectorAll("button") ?? [])];
  expect(buttons.find((button) => button.textContent === "Revert files too")?.disabled).toBe(true);
  await act(() => buttons.find((button) => button.textContent === "Fork from here")?.click());
  expect(onFork).toHaveBeenCalledExactlyOnceWith("checkpoint-1");
  expect(onConfirm).not.toHaveBeenCalled();
});
