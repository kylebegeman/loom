import { useState } from "react";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { runtimeManagedByOperatingSystem } from "@t3tools/client-runtime/fork";
import { Button } from "~/components/ui/button";
import { SettingsSection } from "~/components/settings/settingsLayout";
import { ServerUpdateProgress } from "~/components/ServerUpdateAction";
import { collectProviderUpdateCandidates } from "~/components/ProviderUpdateLaunchNotification.logic";
import {
  resolveDesktopUpdateButtonAction,
  getDesktopUpdateDownloadedVersion,
} from "~/components/desktopUpdate.logic";
import { SidebarUpdateCapsule } from "~/components/sidebar/SidebarUpdateCapsule";
import { UpdateEverythingDialog } from "~/components/sidebar/UpdateEverythingDialog";
import { useUpdateEverything } from "~/components/sidebar/useUpdateEverything";
import { useEnvironmentProviders } from "~/state/environments";
import { useUpdateEverythingRun } from "~/components/sidebar/updateEverythingRun";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import { toastManager } from "~/components/ui/toast";
import { describeFleetUpdateStatus } from "./fleetUpdates";

/** Fleet subscriptions live on the Computers page, away from the local update control. */
export function FleetUpdatesSection() {
  const state = useDesktopUpdateState();
  const localVersion =
    state && resolveDesktopUpdateButtonAction(state) !== "none"
      ? getDesktopUpdateDownloadedVersion(state)
      : null;
  const updates = useUpdateEverything(localVersion, "fleet");
  const providersByEnvironment = useEnvironmentProviders();
  const activeRun = useUpdateEverythingRun();
  const run = activeRun?.scope !== "local" ? activeRun : null;
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const updateFleet = async () => {
    setConfirming(false);
    setPending(true);
    await updates
      .run({})
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not update fleet",
          description: error instanceof Error ? error.message : "An unexpected error occurred.",
        });
      })
      .finally(() => setPending(false));
  };

  return (
    <SettingsSection
      title="Fleet updates"
      headerAction={
        <Button
          size="xs"
          variant="outline"
          disabled={!updates.hasUpdates || pending || activeRun !== null}
          onClick={() => setConfirming(true)}
        >
          {pending ? "Updating…" : "Review updates"}
        </Button>
      }
    >
      <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
        Runtime updates are compared with Loom {updates.targetVersion}. Offline computers show their
        last known version. Install this computer’s app update from its sidebar.
      </p>
      {updates.machines.length === 0 ? (
        <p role="status" className="px-3 py-3 text-sm text-muted-foreground sm:px-4">
          Connect a computer to see its updates.
        </p>
      ) : (
        updates.machines.map((machine) => {
          const providers = collectProviderUpdateCandidates(
            providersByEnvironment.get(machine.environmentId) ?? [],
          );
          const blockedReason = updates.skipped.find(
            (entry) => entry.environmentId === machine.environmentId,
          )?.reason;
          const status =
            machine.updateState.status === "running"
              ? "Updating runtime"
              : machine.updateState.status === "failed"
                ? "Update failed"
                : describeFleetUpdateStatus({
                    connected: machine.connected,
                    currentVersion: machine.serverConfig?.environment.serverVersion ?? null,
                    targetVersion: updates.targetVersion,
                    providerCount: providers.length,
                    localVersion: machine.hostedByThisApp ? localVersion : null,
                    blockedReason,
                    osManaged: runtimeManagedByOperatingSystem(
                      machine.serverConfig?.environment.capabilities,
                    ),
                  });
          return (
            <div key={machine.environmentId} className="flex flex-col gap-1 px-3 py-3 sm:px-4">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="truncate text-sm font-medium">{machine.label}</span>
                <span className="text-xs text-muted-foreground">{status}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Runtime {machine.serverConfig?.environment.serverVersion ?? "unknown"}
                {providers.length > 0
                  ? ` · Providers: ${providers
                      .map((provider) => PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver)
                      .join(", ")}`
                  : ""}
              </p>
              {machine.updateState.status !== "idle" ? (
                <ServerUpdateProgress state={machine.updateState} />
              ) : null}
            </div>
          );
        })
      )}
      {run ? (
        <div className="flex px-3 py-3 sm:px-4">
          <SidebarUpdateCapsule run={run} local={null} icon={null} />
        </div>
      ) : null}
      <UpdateEverythingDialog
        open={confirming}
        onOpenChange={setConfirming}
        summary={updates.summary}
        lines={updates.lines}
        restarts={updates.restarts}
        skipped={updates.skipped}
        onConfirm={() => void updateFleet()}
      />
    </SettingsSection>
  );
}
