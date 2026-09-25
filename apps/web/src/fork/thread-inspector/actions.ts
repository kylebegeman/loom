import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { toastManager } from "~/components/ui/toast";
import { useComposerHandleContext } from "~/composerHandleContext";
import { useDiffPanelStore } from "~/diffPanelStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useRightPanelStore } from "~/rightPanelStore";
import { buildThreadRouteParams } from "~/threadRoutes";
import type { InspectorAction } from "./model";

/** Runs an inspector row action; `onDone` lets the card close after a jump. */
export function useInspectorActions(
  threadRef: ScopedThreadRef,
  onDone?: () => void,
): (action: InspectorAction) => void {
  const navigate = useNavigate();
  const composerHandle = useComposerHandleContext();
  const { copyToClipboard } = useCopyToClipboard<string>({
    onCopy: (label) => toastManager.add({ type: "success", title: `${label} copied` }),
    onError: (error) =>
      toastManager.add({ type: "error", title: "Failed to copy", description: error.message }),
  });
  return (action: InspectorAction) => {
    const panels = useRightPanelStore.getState();
    switch (action.kind) {
      case "open-diff":
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
      case "copy":
        copyToClipboard(action.text, action.label);
        break;
    }
    onDone?.();
  };
}
