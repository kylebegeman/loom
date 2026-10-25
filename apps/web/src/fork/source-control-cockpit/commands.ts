import type { ScopedThreadRef } from "@t3tools/contracts";
import { create } from "zustand";
import { useRightPanelStore } from "~/rightPanelStore";

export type GitActionRequest = {
  threadRef: ScopedThreadRef;
  action: "commit" | "commit_push" | "create_pr";
};

// The Git control lives in details, which may be unmounted when a shortcut is pressed.
export const useGitActionRequestStore = create<{
  pending: GitActionRequest | null;
  consume: (request: GitActionRequest) => boolean;
}>((set, get) => ({
  pending: null,
  consume: (request) => {
    if (get().pending !== request) return false;
    set({ pending: null });
    return true;
  },
}));

export function requestGitAction(
  threadRef: ScopedThreadRef,
  action: GitActionRequest["action"],
): void {
  useGitActionRequestStore.setState({ pending: { threadRef, action } });
  const panels = useRightPanelStore.getState();
  panels.setThreadPanelOpen(threadRef, "inline", true);
  panels.setThreadPanelOpen(threadRef, "popover", true);
}
