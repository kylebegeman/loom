import { PROVIDER_DISPLAY_NAMES, type EnvironmentId } from "@t3tools/contracts"; // fork: machine-updates
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react"; // fork: machine-updates
import { Atom } from "effect/reactivity"; // fork: machine-updates

import { useEnvironmentProviders, useEnvironments } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  canOneClickUpdateProviderCandidate,
  collectProviderUpdateCandidates,
  getProviderUpdateRunToastView,
  type ProviderUpdateRun,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { stackedThreadToast, toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

// fork: machine-updates - Scoped callers must not send provider updates to other computers.
export function useProviderUpdates(environmentIds?: ReadonlySet<EnvironmentId>) {
  const { environments } = useEnvironments();
  // fork: machine-updates - Only computers this session may maintain are offered.
  const permittedAtom = Atom.make(
    (get) =>
      new Set(
        environments
          .filter((environment) =>
            get(serverEnvironment.updateProvider.permissionAtom(environment.environmentId)),
          )
          .map((environment) => environment.environmentId),
      ),
  );
  const permitted = useAtomValue(permittedAtom); // fork: machine-updates
  const providersByEnvironment = useEnvironmentProviders();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const machines = environments.flatMap((environment) => {
    if (!permitted.has(environment.environmentId)) return []; // fork: machine-updates
    // fork: machine-updates
    if (environmentIds !== undefined && !environmentIds.has(environment.environmentId)) return [];
    const providers = providersByEnvironment.get(environment.environmentId) ?? [];
    // fork: machine-updates - Switched-off computers are not updated.
    if (!environment.entry.enabled || environment.connection.phase !== "connected") {
      return [];
    }
    const candidates = collectProviderUpdateCandidates(providers).filter((candidate) =>
      canOneClickUpdateProviderCandidate(candidate, providers),
    );
    return candidates.length > 0
      ? [{ environmentId: environment.environmentId, label: environment.label, candidates }]
      : [];
  });

  const updateAll = async ({ quiet = false }: { readonly quiet?: boolean } = {}) => {
    const runs = await Promise.all(
      machines.flatMap(({ environmentId, label, candidates }) =>
        candidates.map(async (candidate): Promise<ProviderUpdateRun> => ({
          environmentId,
          machineLabel: label,
          driver: candidate.driver,
          instanceId: candidate.instanceId,
          result: await updateProvider({
            environmentId,
            input: { provider: candidate.driver, instanceId: candidate.instanceId },
          }),
        })),
      ),
    );
    const view = quiet ? null : getProviderUpdateRunToastView(runs);
    if (view) {
      toastManager.add(
        stackedThreadToast({
          ...view,
          description: <span className="whitespace-pre-line">{view.description}</span>,
        }),
      );
    }
    return runs;
  };

  return { machines, updateAll };
}

export function ProviderUpdatesAction() {
  const { machines, updateAll } = useProviderUpdates();
  const pending = useRef(false);
  const [isPending, setIsPending] = useState(false);
  if (machines.length === 0 && !isPending) {
    return null;
  }

  const handleUpdate = async () => {
    if (pending.current) return;
    pending.current = true;
    setIsPending(true);
    await settlePromise(() => updateAll());
    pending.current = false;
    setIsPending(false);
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            disabled={isPending}
            onClick={() => void handleUpdate()}
          >
            {isPending ? "Updating…" : "Update all"}
          </Button>
        }
      />
      <TooltipPopup side="top">
        {machines.map((machine) => (
          <div key={machine.environmentId}>
            {machine.label}:{" "}
            {machine.candidates
              .map((candidate) => PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver)
              .join(", ")}
          </div>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
}
