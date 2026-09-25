import { useEffect } from "react";

import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { useInspectorCardStore } from "./cardStore";
import { toggleThreadInspectorPanel } from "./commands";

/**
 * Handles the inspector's keybinding commands. Mounted by ForkRoot. Like the eye button they
 * act on sent threads only; elsewhere nothing subscribes, so the keys fall through.
 */
export function InspectorCommandsHost() {
  const routeThread = useRouteThread();
  useEffect(() => {
    if (routeThread === null || routeThread.isDraft) return;
    const { threadRef } = routeThread;
    const offPanel = onForkCommand("loom.thread-inspector.toggle", () =>
      toggleThreadInspectorPanel(threadRef),
    );
    const offCard = onForkCommand("loom.thread-inspector.card", () =>
      useInspectorCardStore.getState().toggle(),
    );
    return () => {
      offPanel();
      offCard();
    };
  }, [routeThread]);
  return null;
}
