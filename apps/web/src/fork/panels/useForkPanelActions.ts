import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useRightPanelStore } from "~/rightPanelStore";
import { useServerConfigs } from "~/state/entities";
import { FORK_PANELS, forkPanelSurface } from "./registry";
import type { ForkSurfaceAction } from "./surface";

export function useForkPanelActions(
  threadRef: ScopedThreadRef | null,
): ReadonlyArray<ForkSurfaceAction> {
  const serverConfig = useServerConfigs().get(threadRef?.environmentId ?? ("" as EnvironmentId));
  const loomFeatures = loomFeaturesOf(serverConfig?.environment.capabilities);
  return useMemo(
    () =>
      FORK_PANELS.map((panel) => ({
        label: panel.title,
        icon: panel.icon,
        shortcut: panel.shortcut,
        ...(panel.description === undefined ? {} : { description: panel.description }),
        available: panel.isAvailable({ threadRef, loomFeatures }),
        disabledReason: panel.unavailableHint,
        badgeCount: 0,
        onClick: () => {
          if (threadRef)
            useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(panel.id));
        },
      })),
    [threadRef, loomFeatures],
  );
}
