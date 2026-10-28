import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { usePrimaryEnvironment } from "~/state/environments";
import { useServerConfigs } from "~/state/entities";
import { onForkCommand } from "../keybindings/forkCommandBus";
import { openPanel, projectIdOf } from "../code-graph/state";
import { openMini } from "../mini-offload/state";
import { useRouteThread } from "../routeThread";
import { onOpenSettingsAction } from "./action-navigation";

export function SettingsActionHost() {
  const navigate = useNavigate();
  const threadRef = useRouteThread()?.threadRef ?? null;
  const primary = usePrimaryEnvironment();
  const environmentId = threadRef?.environmentId ?? primary?.environmentId;
  const configs = useServerConfigs();
  const capabilities = environmentId
    ? configs.get(environmentId)?.environment.capabilities
    : undefined;
  const canOpenBots = supportsLoomFeature(primary?.serverConfig?.environment.capabilities, "bots");
  const canOpenMap = supportsLoomFeature(capabilities, "code-graph");
  const canOpenJobs = supportsLoomFeature(capabilities, "mini-offload");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens for settings navigation actions from the command palette
  useEffect(
    () =>
      onOpenSettingsAction((target) => {
        void navigate({
          to: target === "published-pages" ? "/settings/access" : "/settings/connections",
          hash: target,
          search: {
            machine: target === "published-pages" ? environmentId : undefined,
            project: undefined,
            checkout: undefined,
          },
        });
      }),
    [navigate, environmentId],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the existing feature open actions on the keyboard command bus
  useEffect(() => {
    const stopBots = canOpenBots
      ? onForkCommand("loom.bots.open", () => {
          void navigate({ to: "/loom/bots", search: {} });
        })
      : undefined;
    const stopMap =
      canOpenMap && threadRef
        ? onForkCommand("loom.code-graph.open", () => {
            if (projectIdOf(threadRef)) openPanel(threadRef);
          })
        : undefined;
    const stopJobs =
      canOpenJobs && threadRef
        ? onForkCommand("loom.mini-offload.open", () => {
            openMini(threadRef);
          })
        : undefined;
    return () => {
      stopBots?.();
      stopMap?.();
      stopJobs?.();
    };
  }, [canOpenBots, canOpenMap, canOpenJobs, navigate, threadRef]);
  return null;
}
