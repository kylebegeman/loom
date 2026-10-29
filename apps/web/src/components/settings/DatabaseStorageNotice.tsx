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
import { shouldRecommendDatabaseCompaction, type EnvironmentId } from "@t3tools/contracts"; // fork: project-lifecycle
import type { RestartCompactionState } from "@t3tools/contracts/fork"; // fork: restart-compaction
import * as Schema from "effect/Schema";
import { useState } from "react"; // fork: restart-compaction

import { connectionAtomRuntime } from "../../connection/runtime"; // fork: restart-compaction
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command"; // fork: restart-compaction
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast"; // fork: restart-compaction
import { SettingsRow, SettingsSection } from "./settingsLayout";

const databaseCompaction = createDatabaseCompactionAtoms(connectionAtomRuntime); // fork: restart-compaction

const DismissedEnvironmentIds = Schema.Array(Schema.String);

// fork: project-lifecycle -- every supported database stays visible, including successful repairs.
export function DatabaseStorageNotice({
  environments,
}: {
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>;
}) {
  const recommendations = useAtomValue(
    serverEnvironment.databaseStorageStatuses(
      JSON.stringify(environments.map((environment) => environment.environmentId)),
    ),
  );
  const [dismissed, setDismissed] = useLocalStorage(
    "database-storage-notice-dismissed",
    [],
    DismissedEnvironmentIds,
  );
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  // fork: project-lifecycle -- previous dismissals now collapse details instead of hiding storage.
  const visible = recommendations;
  if (visible.length === 0) return null;
  // fork: restart-compaction
  const labelOf = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    environmentId;
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
        .map(({ environmentId, status }) => (
          <SettingsRow
            key={environmentId}
            title={`Database on ${labelOf(environmentId)}`}
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
      {visible.map(({ environmentId, status }) =>
        status.restartCompaction === undefined || dismissed.includes(environmentId) ? null : (
          <RestartCompactionRow
            key={environmentId}
            environmentId={environmentId}
            label={labelOf(environmentId)}
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
        .map(({ environmentId, status }) => (
          <SettingsRow
            key={environmentId}
            title={`Database on ${labelOf(environmentId)}`}
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
          description="Old history is cleaned up automatically, but these databases still hold the freed space. Run the command on each machine to return it to disk; it pauses and restarts the background service. Quit the desktop app first if it hosts the environment."
        />
      )}
      {/* fork: restart-compaction */}
      {commandRecommendations.map(({ environmentId, status }) => (
        <SettingsRow
          key={environmentId}
          title={`${(status.databaseBytes / 1024 ** 3).toFixed(2)} GiB stored on ${
            environments.find((environment) => environment.environmentId === environmentId)
              ?.label ?? environmentId
          }`}
          description={
            <>
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
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setDismissed((current) => [...current, environmentId])}
              >
                Collapse
              </Button>
            </div>
          }
        />
      ))}
    </SettingsSection>
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
