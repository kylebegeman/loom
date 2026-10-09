import { useEffect } from "react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { FEATURE, captureScreenshot, runLastFlow, togglePanel } from "./state";

/** Binds the Device QA keybinding commands to the thread the chat route shows. */
export function DeviceQaShortcuts() {
  const threadRef = useRouteThread()?.threadRef ?? null;
  const configs = useServerConfigs();
  const available =
    threadRef !== null &&
    loomFeaturesOf(configs.get(threadRef.environmentId)?.environment.capabilities).includes(
      FEATURE,
    );
  useEffect(() => {
    if (!available || !threadRef) return;
    const unsubscribe = [
      onForkCommand("loom.device-qa.toggle", () => togglePanel(threadRef)),
      onForkCommand("loom.device-qa.capture", () => void captureScreenshot(threadRef)),
      onForkCommand("loom.device-qa.run-last-flow", () => void runLastFlow(threadRef)),
    ];
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [available, threadRef]);
  return null;
}
