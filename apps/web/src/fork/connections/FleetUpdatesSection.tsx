import { useAtomValue } from "@effect/atom-react";
import {
  directoryServerVersion,
  libraryProjectColor,
  runtimeManagedByOperatingSystem,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { PROVIDER_DISPLAY_NAMES } from "@t3tools/contracts";
import { DIRECTORY_FEATURE, UPDATE_PLAN_FEATURE } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { DownloadIcon, HardDriveIcon } from "lucide-react";
import { useState } from "react";
import { ServerUpdateProgress } from "~/components/ServerUpdateAction";
import { SettingsSearchTarget } from "~/components/settings/settingsLayout";
import { collectProviderUpdateCandidates } from "~/components/ProviderUpdateLaunchNotification.logic";
import {
  resolveDesktopUpdateButtonAction,
  getDesktopUpdateDownloadedVersion,
} from "~/components/desktopUpdate.logic";
import { SidebarUpdateCapsule } from "~/components/sidebar/SidebarUpdateCapsule";
import { UpdateEverythingDialog } from "~/components/sidebar/UpdateEverythingDialog";
import { useUpdateEverything } from "~/components/sidebar/useUpdateEverything";
import { useUpdateEverythingRun } from "~/components/sidebar/updateEverythingRun";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { useDesktopUpdateState } from "~/state/desktopUpdate";
import { useEnvironmentProviders } from "~/state/environments";
import { directoryComputers } from "../directory-computers/state";
import { LibraryEmpty, LibraryStateDot } from "../project-library/LibraryControls";
import { ComputerTile, projectColorStyle } from "../project-library/ProjectIdentity";
import { useLibraryAuthority } from "../project-library/state";
import { MachineUpdatePlanControls, UpdateAllWhenIdle } from "./UpdatePlans";
import { describeFleetUpdateStatus } from "./fleetUpdates";

const UPDATE_COLUMNS =
  "@min-[42rem]/updates:grid-cols-[minmax(0,1fr)_minmax(0,.6fr)_minmax(0,1.5fr)]";

/** Fleet subscriptions live on the Computers page, away from the local update control. */
export function FleetUpdatesSection() {
  const authority = useLibraryAuthority();
  const directorySupported = supportsLoomFeature(
    authority.environment?.serverConfig?.environment.capabilities,
    DIRECTORY_FEATURE,
  );
  const liveDirectory = useAtomValue(
    directoryComputers.listing(directorySupported ? authority.authorityId : null),
  );
  const keptDirectory = useAtomValue(directoryComputers.stored(authority.authorityId));
  const listing = AsyncResult.getOrElse(liveDirectory, () => keptDirectory)?.listing ?? null;
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
    <SettingsSearchTarget id="fleet-updates" className="@container/updates min-w-0 space-y-7">
      <section
        aria-label="Fleet release"
        className="grid min-w-0 gap-5 rounded-xl border border-border/60 bg-card/40 p-5 @min-[32rem]/updates:grid-cols-[minmax(0,1fr)_auto] @min-[32rem]/updates:items-center"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <DownloadIcon aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <h2 className="wrap-anywhere text-lg font-semibold tracking-tight">
              Loom {updates.targetVersion}
            </h2>
            <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
              Review runtime and provider updates across your computers. You can check what will
              restart before installing.
            </p>
          </div>
        </div>
        <div className="justify-self-start">
          <Button
            shape="pill"
            size="sm"
            disabled={!updates.hasUpdates || pending || activeRun !== null}
            onClick={() => setConfirming(true)}
          >
            {pending ? "Updating…" : "Review updates"}
          </Button>
        </div>
      </section>
      {run ? (
        <div role="status" className="flex min-w-0">
          <SidebarUpdateCapsule run={run} local={null} icon={null} />
        </div>
      ) : null}
      <section aria-label="Computer updates" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium">Your computers</h2>
          <p className="text-xs text-muted-foreground">Offline versions are last reported.</p>
        </div>
        {updates.machines.length === 0 ? (
          <LibraryEmpty icon={HardDriveIcon} title="No computers to update">
            Connect a computer to see its runtime and provider updates here.
          </LibraryEmpty>
        ) : (
          <>
            <div
              aria-hidden
              className={`hidden gap-x-5 text-xs text-muted-foreground @min-[42rem]/updates:grid ${UPDATE_COLUMNS}`}
            >
              <span>Computer</span>
              <span>Installed runtime</span>
              <span>Availability</span>
            </div>
            <ul className="divide-y divide-border/60 border-y border-border/60">
              {updates.machines.map((machine) => {
                const providers = collectProviderUpdateCandidates(
                  providersByEnvironment.get(machine.environmentId) ?? [],
                );
                const blockedReason = updates.skipped.find(
                  (entry) => entry.environmentId === machine.environmentId,
                )?.reason;
                const currentVersion =
                  machine.serverConfig?.environment.serverVersion ??
                  directoryServerVersion(machine.environmentId, listing);
                const status =
                  machine.updateState.status === "running"
                    ? "Updating runtime"
                    : machine.updateState.status === "failed"
                      ? "Update failed"
                      : describeFleetUpdateStatus({
                          connected: machine.connected,
                          currentVersion,
                          targetVersion: updates.targetVersion,
                          providerCount: providers.length,
                          localVersion: machine.hostedByThisApp ? localVersion : null,
                          blockedReason,
                          osManaged: runtimeManagedByOperatingSystem(
                            machine.serverConfig?.environment.capabilities,
                          ),
                        });
                const tone =
                  machine.updateState.status === "failed"
                    ? "danger"
                    : machine.updateState.status === "running"
                      ? "active"
                      : !machine.connected || currentVersion === null
                        ? "neutral"
                        : status === "Up to date"
                          ? "success"
                          : "warning";
                return (
                  <li
                    key={machine.environmentId}
                    style={projectColorStyle(libraryProjectColor({ id: machine.environmentId }))}
                    className="min-w-0 space-y-3 py-5"
                  >
                    <div className={`grid min-w-0 items-start gap-x-5 gap-y-3 ${UPDATE_COLUMNS}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <ComputerTile environmentId={machine.environmentId} />
                        <div className="min-w-0 space-y-1">
                          <h3 className="wrap-anywhere text-sm font-medium">{machine.label}</h3>
                          <p className="text-xs text-muted-foreground">
                            {machine.connected ? "Connected" : "Offline"}
                          </p>
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 @min-[42rem]/updates:block @min-[42rem]/updates:pt-1">
                        <span className="text-xs text-muted-foreground @min-[42rem]/updates:hidden">
                          Installed runtime
                        </span>
                        <p className="wrap-anywhere text-sm tabular-nums">
                          {currentVersion ?? "Unknown"}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-2 @min-[42rem]/updates:pt-1">
                        <p className="flex items-start gap-2 text-xs leading-relaxed">
                          <LibraryStateDot tone={tone} className="mt-1" />
                          <span className="min-w-0 wrap-anywhere">{status}</span>
                        </p>
                        {providers.length > 0 ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {providers
                              .map(
                                (provider) =>
                                  PROVIDER_DISPLAY_NAMES[provider.driver] ?? provider.driver,
                              )
                              .join(", ")}
                          </p>
                        ) : null}
                        <MachineUpdatePlanControls
                          environmentId={machine.environmentId}
                          advertised={supportsLoomFeature(
                            machine.serverConfig?.environment.capabilities,
                            UPDATE_PLAN_FEATURE,
                          )}
                          connected={machine.connected}
                          targetVersion={updates.targetVersion}
                          currentVersion={currentVersion}
                        />
                      </div>
                    </div>
                    {machine.updateState.status !== "idle" ? (
                      <ServerUpdateProgress state={machine.updateState} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <UpdateAllWhenIdle targetVersion={updates.targetVersion} />
      <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
        Install this computer’s app updates from its sidebar. Fleet runtime updates use Loom{" "}
        {updates.targetVersion}.
      </p>
      <UpdateEverythingDialog
        open={confirming}
        onOpenChange={setConfirming}
        version={updates.version}
        providerCount={updates.providerCount}
        rows={updates.rows}
        restarts={updates.restarts}
        onConfirm={() => void updateFleet()}
      />
    </SettingsSearchTarget>
  );
}
