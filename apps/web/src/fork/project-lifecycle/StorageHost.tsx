import { useCallback, useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { loomFeaturesOf } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { toastManager } from "~/components/ui/toast";
import { useServerConfigs } from "~/state/entities";
import { forkSettingsTarget } from "../settings/navigation";
import { FEATURE, formatGb, lanes, onOpenStorageSettings } from "./state";

/** Shows one notice each time an environment's free space drops below its reserve. */
function ReserveNotice({
  environmentId,
  label,
  open,
}: {
  environmentId: EnvironmentId;
  label: string;
  open: () => void;
}) {
  const status = Option.getOrNull(
    AsyncResult.value(useAtomValue(lanes.status({ environmentId, input: {} }))),
  );
  const below = status?.enabled === true && status.belowReserve;
  const wasBelow = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- raises a toast when the server's disk space status first drops below the reserve
  useEffect(() => {
    if (!status) return;
    if (below && !wasBelow.current) {
      const toastId = toastManager.add({
        type: "warning",
        title: `Low disk space on ${label}`,
        description: `${formatGb(status.hostFreeBytes)} free, below the ${formatGb(status.reserveBytes)} reserve. Running agents were asked to free space.`,
        actionProps: {
          children: "Open storage",
          onClick: () => {
            toastManager.close(toastId);
            open();
          },
        },
      });
    }
    wasBelow.current = below;
  }, [below, label, open, status]);
  return null;
}

export function ProjectLifecycleHost() {
  const navigate = useNavigate();
  const configs = useServerConfigs();
  const open = useCallback(() => void navigate(forkSettingsTarget(FEATURE)), [navigate]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the module bus for open storage settings requests and unsubscribes on unmount
  useEffect(() => onOpenStorageSettings(open), [open]);
  return [...configs]
    .filter(([, config]) => loomFeaturesOf(config.environment.capabilities).includes(FEATURE))
    .map(([environmentId, config]) => (
      <ReserveNotice
        key={environmentId}
        environmentId={environmentId}
        label={config.environment.label}
        open={open}
      />
    ));
}
