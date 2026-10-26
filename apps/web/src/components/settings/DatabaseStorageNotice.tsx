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
import type { EnvironmentId } from "@t3tools/contracts";
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

/** Suggests `t3 doctor` on every machine whose database still holds at least 1 GiB of freed pages. */
export function DatabaseStorageNotice({
  environments,
}: {
  environments: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>;
}) {
  const recommendations = useAtomValue(
    serverEnvironment.databaseCompactionRecommendations(
      JSON.stringify(environments.map((environment) => environment.environmentId)),
    ),
  );
  const [dismissed, setDismissed] = useLocalStorage(
    "database-storage-notice-dismissed",
    [],
    DismissedEnvironmentIds,
  );
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  const visible = recommendations.filter(
    (recommendation) => !dismissed.includes(recommendation.environmentId),
  );
  if (visible.length === 0) return null;
  const labelOf = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    environmentId;
  const dismiss = (environmentId: EnvironmentId) =>
    setDismissed((current) => [...current, environmentId]);
  // fork: restart-compaction: the desktop app compacts its own database while it restarts.
  const commandRecommendations = visible.filter(
    ({ status }) => status.restartCompaction === undefined,
  );
  return (
    <SettingsSection id="storage-database" title="Database">
      {visible.map(({ environmentId, status }) =>
        status.restartCompaction === undefined ? null : (
          <RestartCompactionRow
            key={environmentId}
            environmentId={environmentId}
            label={labelOf(environmentId)}
            reclaimableBytes={status.reclaimableBytes}
            state={status.restartCompaction}
            onDismiss={() => dismiss(environmentId)}
          />
        ),
      )}
      {commandRecommendations.length === 0 ? null : (
        <SettingsRow
          title="Reclaim freed database space"
          description="Old history is cleaned up automatically, but these databases still hold the freed space. Run the command on each machine to return it to disk; it pauses and restarts the background service. Quit the desktop app first if it hosts the environment."
        />
      )}
      {commandRecommendations.map(({ environmentId, status }) => (
        <SettingsRow
          key={environmentId}
          title={`${(status.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB on ${labelOf(environmentId)}`}
          description={<code className="select-text break-all">{status.compactCommand}</code>}
          control={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="xs"
                onClick={() => copyToClipboard(status.compactCommand, undefined)}
              >
                Copy command
              </Button>
              <Button variant="ghost" size="xs" onClick={() => dismiss(environmentId)}>
                Dismiss
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
  state,
  onDismiss,
}: {
  environmentId: EnvironmentId;
  label: string;
  reclaimableBytes: number;
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
      title={`Reclaim ${(reclaimableBytes / 1024 ** 3).toFixed(1)} GiB on ${label}`}
      description={
        <>
          Old history is cleaned up automatically, but this database still holds the freed space.{" "}
          {plan} Compacting can take several minutes while Loom starts.
          {lastAttempt === null ? null : <span className="mt-2 block">{lastAttempt}</span>}
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
              Dismiss
            </Button>
          </div>
        )
      }
    />
  );
}
