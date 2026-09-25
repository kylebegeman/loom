import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";

import { useHandleNewThread } from "~/hooks/useHandleNewThread";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useInspectorCardStore } from "./cardStore";
import { toggleThreadInspectorPanel } from "./commands";

/** Handles the inspector's keybinding commands and palette items. Mounted by ForkRoot. */
export function InspectorCommandsHost() {
  const { activeThread } = useHandleNewThread();
  const environmentId = activeThread?.environmentId ?? null;
  const threadId = activeThread?.id ?? null;
  useEffect(() => {
    const offPanel = onForkCommand("loom.thread-inspector.toggle", () => {
      if (environmentId !== null && threadId !== null)
        toggleThreadInspectorPanel(scopeThreadRef(environmentId, threadId));
    });
    const offCard = onForkCommand("loom.thread-inspector.card", () =>
      useInspectorCardStore.getState().toggle(),
    );
    return () => {
      offPanel();
      offCard();
    };
  }, [environmentId, threadId]);
  return null;
}
