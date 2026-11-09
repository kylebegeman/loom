import { useAtomValue } from "@effect/atom-react";
// fork: restart-compaction
import {
  createDatabaseCompactionAtoms,
  describeRestartCompaction,
} from "@t3tools/client-runtime/fork";
// fork: restart-compaction
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  databaseReclaimMinutes,
  type DatabaseStorageStatus,
  type EnvironmentId,
  shouldRecommendDatabaseCompaction, // fork: project-lifecycle
} from "@t3tools/contracts";
import type { RestartCompactionState } from "@t3tools/contracts/fork"; // fork: restart-compaction
import * as Schema from "effect/Schema";
import { type ReactNode, useState } from "react";

import { connectionAtomRuntime } from "../../connection/runtime"; // fork: restart-compaction
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { environmentAtomList, environmentIdsKey } from "../../state/environmentAtomList";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const databaseCompaction = createDatabaseCompactionAtoms(connectionAtomRuntime); // fork: restart-compaction

const DismissedEnvironmentIds = Schema.Array(Schema.String);
const reclaimPermissionsAtom = environmentAtomList(
  "web-database-reclaim-permissions",
  serverEnvironment.reclaimDatabaseSpace.permissionAtom,
);

const formatGiB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

// fork: project-lifecycle -- every supported database stays visible, including successful repairs.
export function DatabaseStorageNotice({
  environments,
}: {
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>;
}) {
  const environmentIds = environments.map((environment) => environment.environmentId);
  const recommendations = useAtomValue(
    // fork: project-lifecycle
    serverEnvironment.databaseStorageStatuses(JSON.stringify(environmentIds)),
  );
  const permissions = useAtomValue(reclaimPermissionsAtom(environmentIdsKey(environmentIds)));
  const [dismissed, setDismissed] = useLocalStorage(
    "database-storage-notice-dismissed",
    [],
    DismissedEnvironmentIds,
  );
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  // fork: project-lifecycle -- previous dismissals now collapse details instead of hiding storage.
  const visible = recommendations.map((recommendation) => ({
    ...recommendation,
    label:
      environments.find(
        (environment) => environment.environmentId === recommendation.environmentId,
      )?.label ?? recommendation.environmentId,
    reclaimable:
      recommendation.status.canReclaim === true &&
      permissions[environmentIds.indexOf(recommendation.environmentId)] === true &&
      shouldRecommendDatabaseCompaction(recommendation.status), // fork: project-lifecycle
  }));
  if (visible.length === 0) return null;
  // fork: restart-compaction: the desktop app compacts its own database while it restarts.
  const commandRecommendations = visible.filter(
    ({ environmentId, status }) =>
      status.restartCompaction === undefined &&
      !status.incrementalVacuumEnabled &&
      !dismissed.includes(environmentId),
  );
  return (
    <SettingsSection id="storage-database" title="Database">
      {/* fork: project-lifecycle */}
      {visible
        .filter(({ environmentId }) => dismissed.includes(environmentId))
        .map(({ environmentId, status, label }) => (
          <SettingsRow
            key={environmentId}
            title={`Database on ${label}`}
            description={`${(status.databaseBytes / 1024 ** 3).toFixed(2)} GiB stored`}
            control={
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  setDismissed((current) => current.filter((id) => id !== environmentId))
                }
              >
                Show details
              </Button>
            }
          />
        ))}
      {/* fork: restart-compaction */}
      {visible.map(({ environmentId, status, label }) =>
        status.restartCompaction === undefined || dismissed.includes(environmentId) ? null : (
          <RestartCompactionRow
            key={environmentId}
            environmentId={environmentId}
            label={label}
            reclaimableBytes={status.reclaimableBytes}
            databaseBytes={status.databaseBytes} // fork: project-lifecycle
            state={status.restartCompaction}
            onDismiss={() => setDismissed((current) => [...current, environmentId])}
          />
        ),
      )}
      {/* fork: project-lifecycle */}
      {visible
        .filter(
          ({ environmentId, status }) =>
            status.restartCompaction === undefined &&
            status.incrementalVacuumEnabled &&
            !dismissed.includes(environmentId),
        )
        .map(({ environmentId, status, label }) => (
          <SettingsRow
            key={environmentId}
            title={`Database on ${label}`}
            description={`${(status.databaseBytes / 1024 ** 3).toFixed(2)} GiB stored. Freed pages return to disk automatically.`}
            control={
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDismissed((current) => [...current, environmentId])}
              >
                Collapse
              </Button>
            }
          />
        ))}
      {/* fork: restart-compaction */}
      {commandRecommendations.length === 0 ? null : (
        <SettingsRow
          title="Reclaim freed database space"
          description={`These databases still hold space freed by history cleanup.${
            commandRecommendations.every((recommendation) => recommendation.reclaimable) // fork: restart-compaction
              ? ""
              : " Run the command on each machine to reclaim it. It restarts the background service. Quit the desktop app first if it hosts the environment."
          }`}
        />
      )}
      {/* fork: restart-compaction */}
      {commandRecommendations.map(({ environmentId, status, label, reclaimable }) => {
        const dismiss = (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setDismissed((current) => [...current, environmentId])}
          >
            {/* fork: project-lifecycle */}
            Collapse
          </Button>
        );
        return reclaimable ? (
          <ReclaimRow
            key={environmentId}
            environmentId={environmentId}
            label={label}
            status={status}
            dismiss={dismiss}
          />
        ) : (
          <SettingsRow
            key={environmentId}
            title={`${(status.databaseBytes / 1024 ** 3).toFixed(2)} GiB stored on ${label}`} // fork: project-lifecycle
            description={
              <>
                {/* fork: project-lifecycle */}
                <span className="block">
                  {shouldRecommendDatabaseCompaction(status)
                    ? `${(status.reclaimableBytes / 1024 ** 3).toFixed(2)} GiB can be reclaimed.`
                    : "Compaction is not needed now."}
                </span>
                <code className="select-text break-all">{status.compactCommand}</code>
              </>
            }
            control={
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => copyToClipboard(status.compactCommand, undefined)}
                >
                  Copy command
                </Button>
                {dismiss}
              </div>
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function ReclaimRow({
  environmentId,
  label,
  status,
  dismiss,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly status: DatabaseStorageStatus;
  readonly dismiss: ReactNode;
}) {
  const reclaim = useAtomCommand(serverEnvironment.reclaimDatabaseSpace);
  const [confirming, setConfirming] = useState(false);
  const [requested, setRequested] = useState(false);
  // A failed repair reports back after the restart, which ends the wait.
  const restarting = requested && status.reclaimFailure === undefined;
  const minutes = databaseReclaimMinutes(status);
  const amount = formatGiB(status.reclaimableBytes);
  const start = async () => {
    setConfirming(false);
    setRequested(true);
    const result = await reclaim({ environmentId, input: {} });
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Reclaiming ${amount} on ${label}`,
        description: `T3 Code there restarts and is back in about ${minutes} min.`,
      });
      return;
    }
    setRequested(false);
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: `Could not reclaim space on ${label}`,
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  };
  return (
    <SettingsRow
      title={`${amount} on ${label}`}
      description={
        status.reclaimFailure === undefined
          ? `Restarts T3 Code there. It is offline for about ${minutes} min.`
          : `The last attempt failed: ${status.reclaimFailure}`
      }
      control={
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            disabled={restarting}
            onClick={() => setConfirming(true)}
          >
            {restarting ? "Restarting…" : "Reclaim"}
          </Button>
          {dismiss}
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Reclaim {amount} on {label}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  T3 Code on {label} stops, rebuilds its database, and starts again. It is offline
                  for about {minutes} min. Running agents stop when it restarts.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
                <Button onClick={() => void start()}>Restart and reclaim</Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      }
    />
  );
}

// fork: restart-compaction
function RestartCompactionRow({
  environmentId,
  label,
  reclaimableBytes,
  databaseBytes, // fork: project-lifecycle
  state,
  onDismiss,
}: {
  environmentId: EnvironmentId;
  label: string;
  reclaimableBytes: number;
  databaseBytes: number; // fork: project-lifecycle
  state: RestartCompactionState;
  onDismiss: () => void;
}) {
  const allowed = useAtomValue(databaseCompaction.setRequest.permissionAtom(environmentId));
  const setRequest = useAtomCommand(databaseCompaction.setRequest, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const update = async (requested: boolean) => {
    setPending(true);
    const result = await setRequest({ environmentId, input: { requested } }).finally(() =>
      setPending(false),
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: `Could not change compaction on ${label}`,
        description: cause instanceof Error ? cause.message : String(cause),
      });
    }
  };
  const { plan, lastAttempt } = describeRestartCompaction(state, label);
  return (
    <SettingsRow
      title={`Database on ${label}`} // fork: project-lifecycle
      description={
        <>
          {/* fork: project-lifecycle */}
          {(databaseBytes / 1024 ** 3).toFixed(2)} GiB stored;{" "}
          {(reclaimableBytes / 1024 ** 3).toFixed(2)} GiB can be reclaimed. {plan} Compacting can
          take several minutes while Loom starts.
          {lastAttempt === null ? null : (
            <span className="mt-2 block">
              {lastAttempt}
              {state.lastAttempt ? ` (${new Date(state.lastAttempt.at).toLocaleString()})` : ""}
            </span>
          )}
        </>
      }
      control={
        state.requested ? (
          <Button
            variant="outline"
            size="xs"
            disabled={!allowed || pending}
            onClick={() => void update(false)}
          >
            Cancel compaction
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="xs"
              disabled={!allowed || pending}
              onClick={() => void update(true)}
            >
              Compact at next restart
            </Button>
            <Button variant="ghost" size="xs" onClick={onDismiss}>
              Collapse
            </Button>
          </div>
        )
      }
    />
  );
}
