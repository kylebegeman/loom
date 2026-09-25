import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useComposerHandleContext } from "~/composerHandleContext";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useRightPanelStore } from "~/rightPanelStore";
import { buildThreadRouteParams } from "~/threadRoutes";
import type { InspectorAction } from "./model";

/** Runs an inspector jump; `onDone` lets the card close after it. */
export function useInspectorActions(
  threadRef: ScopedThreadRef,
  onDone?: (action: InspectorAction) => void,
): (action: InspectorAction) => void {
  const navigate = useNavigate();
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
        useDiffPanelStore.getState().selectTurn(threadRef, action.turnId);
        panels.open(threadRef, "diff");
        break;
      case "open-agents":
        panels.open(threadRef, "agents");
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
      case "open-thread":
        void navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(scopeThreadRef(threadRef.environmentId, action.threadId)),
        });
        break;
    }
    onDone?.(action);
  };
}
