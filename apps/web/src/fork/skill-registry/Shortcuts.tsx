import { useEffect } from "react";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { forkPanelSurface } from "../panels/registry";
import { FEATURE, useSkillsSupported } from "./state";
export function SkillsShortcuts() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const supported = useSkillsSupported(threadRef?.environmentId ?? null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the Skills command on the application command bus
  useEffect(() => {
    if (!threadRef || !supported) return;
    return onForkCommand("loom.skill-registry.toggle", () => {
      const panels = useRightPanelStore.getState();
      const active = selectActiveRightPanelSurface(panels.byThreadKey, threadRef);
      if (active?.kind === "fork" && active.panelId === FEATURE)
        panels.closeSurface(threadRef, active.id);
      else panels.openSurface(threadRef, forkPanelSurface(FEATURE));
    });
  }, [threadRef, supported]);
  return null;
}
