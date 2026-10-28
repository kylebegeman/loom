import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useEffect } from "react";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { useFileOutlineStore } from "./store";

export function FileOutlineShortcuts() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const source = useFileOutlineStore((state) =>
    threadRef ? state.sources[scopedThreadKey(threadRef)] : undefined,
  );
  const surface = useRightPanelStore((state) =>
    selectActiveRightPanelSurface(state.byThreadKey, threadRef),
  );
  const available = surface?.kind === "file" && source?.path === surface.relativePath;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the outline toggle fork command while a matching file surface is shown
  useEffect(() => {
    if (!available) return;
    return onForkCommand("loom.file-outline.toggle", () => useFileOutlineStore.getState().toggle());
  }, [available]);
  return null;
}
