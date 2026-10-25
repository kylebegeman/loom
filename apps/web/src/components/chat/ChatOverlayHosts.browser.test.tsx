import { MessageId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { openRevertConfirm, RevertConfirmHost } from "./ChatOverlayHosts";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

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
    await act(() => root.render(host("env:a")));

    await act(() => openRevertConfirm("env:b", pending));
    expect(dialog()).toBeNull();

    await act(() => openRevertConfirm("env:a", pending));
    const keep = [...(dialog()?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Revert and keep changes",
    );
    await act(() => keep?.click());
    // fork: project-lifecycle
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(pending, false);
    await vi.waitFor(() => expect(dialog()).toBeNull());

    await act(() => openRevertConfirm("env:a", { ...pending, turnCount: 3 }));
    expect(dialog()).not.toBeNull();
    await act(() => root.render(host("env:b")));
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });
});

// fork: project-lifecycle
it("explains shared workspace restrictions and forks without confirming a restore", async () => {
  const onFork = vi.fn();
  const onConfirm = vi.fn();
  await act(() =>
    root.render(
      <AppAtomRegistryProvider>
        <RevertConfirmHost
          threadKey="env:shared"
          canOperate
          onConfirm={onConfirm}
          onFork={onFork}
        />
      </AppAtomRegistryProvider>,
    ),
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
