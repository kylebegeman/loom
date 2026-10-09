import { useEffect } from "react";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import { useServerConfigs } from "~/state/entities";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { useRouteThread } from "../routeThread";
import { FEATURE, startRemembered, togglePanel } from "./state";

/** Binds the Apple build keybinding commands to the thread the chat route shows. */
export function AppleBuildToolingShortcuts() {
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
      onForkCommand("loom.apple-build-tooling.toggle", () => togglePanel(threadRef)),
      onForkCommand(
        "loom.apple-build-tooling.build",
        () => void startRemembered(threadRef, "build"),
      ),
      onForkCommand("loom.apple-build-tooling.test", () => void startRemembered(threadRef, "test")),
      onForkCommand("loom.apple-build-tooling.run", () => void startRemembered(threadRef, "run")),
    ];
    return () => {
      for (const stop of unsubscribe) stop();
    };
  }, [available, threadRef]);
  return null;
}
