import type { ScopedThreadRef } from "@t3tools/contracts";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useRightPanelStore } from "~/rightPanelStore";
import type { InspectorAction } from "./model";

/** Runs an inspector jump; `onDone` lets the card close after it. */
export function useInspectorActions(
  threadRef: ScopedThreadRef,
  onDone?: (action: InspectorAction) => void,
): (action: InspectorAction) => void {
  const composerHandle = useComposerHandleContext();
  return (action: InspectorAction) => {
    const panels = useRightPanelStore.getState();
    switch (action.kind) {
      case "open-diff":
        // The diff panel's working tree scope, even if it last showed the branch or a turn.
        useDiffPanelStore.getState().selectGitScope(threadRef, "unstaged");
        panels.open(threadRef, "diff");
        break;
      case "open-turn-diff":
        useDiffPanelStore.getState().selectTurn(threadRef, action.runId);
        panels.open(threadRef, "diff");
        break;
      case "open-pull-request":
        panels.openPullRequest(threadRef, action.pullRequest);
        break;
      case "open-terminal":
        panels.openTerminal(threadRef, action.terminalId);
        break;
      case "focus-composer":
        composerHandle?.current?.focusAtEnd();
        break;
    }
    onDone?.(action);
  };
}
