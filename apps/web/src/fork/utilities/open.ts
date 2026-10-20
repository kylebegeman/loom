import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { DEFAULT_UTILITY_TOOL_ID } from "./registry-meta";
import { useUtilitiesStore } from "./store";

export const UTILITIES_PANEL_ID = "utilities";

/**
 * Opens a tool in the thread's right panel, or in the dialog when no thread is showing, so
 * the tools work from the empty state and from Settings too.
 */
export function openUtilities(toolId: string, threadRef: ScopedThreadRef | null) {
  const utilities = useUtilitiesStore.getState();
  utilities.select(toolId);
  if (threadRef === null) {
    utilities.openDialog();
    return;
  }
  utilities.closeDialog();
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(UTILITIES_PANEL_ID));
}

/** The shortcut: closes whichever Utilities view is showing, otherwise opens the last tool. */
export function toggleUtilities(threadRef: ScopedThreadRef | null) {
  const utilities = useUtilitiesStore.getState();
  if (utilities.dialogOpen) {
    utilities.closeDialog();
    return;
  }
  if (threadRef !== null) {
    const panels = useRightPanelStore.getState();
    const active = selectActiveRightPanelSurface(panels.byThreadKey, threadRef);
    if (active?.kind === "fork" && active.panelId === UTILITIES_PANEL_ID) {
      panels.closeSurface(threadRef, active.id);
      return;
    }
  }
  openUtilities(utilities.selectedToolId ?? DEFAULT_UTILITY_TOOL_ID, threadRef);
}
