import type { ScopedThreadRef } from "@t3tools/contracts";

import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { THREAD_INSPECTOR_PANEL_ID } from "./panel";

/** Closes the right panel when the inspector is its active tab, otherwise opens the inspector. */
export function toggleThreadInspectorPanel(threadRef: ScopedThreadRef): void {
  const panels = useRightPanelStore.getState();
  const active = selectActiveRightPanelSurface(panels.byThreadKey, threadRef);
  if (active?.kind === "fork" && active.panelId === THREAD_INSPECTOR_PANEL_ID) {
    panels.close(threadRef);
  } else {
    panels.openSurface(threadRef, forkPanelSurface(THREAD_INSPECTOR_PANEL_ID));
  }
}
