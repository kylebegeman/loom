import { useEffect } from "react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useRouteThread } from "../routeThread";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { forkPanelSurface } from "../panels/registry";
import { useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { dispatchModelAction } from "./actions";
export function ModelPreview3dShortcuts() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const configs = useServerConfigs();
  const available =
    threadRef &&
    loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities).includes(
      "model-preview-3d",
    );
  useEffect(() => {
    if (!available || !threadRef) return;
    const open = onForkCommand("loom.model-preview-3d.open", () =>
      useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface("model-preview-3d")),
    );
    const capture = onForkCommand("loom.model-preview-3d.capture", () =>
      dispatchModelAction(threadRef, "capture"),
    );
    return () => {
      open();
      capture();
    };
  }, [available, threadRef]);
  return null;
}
