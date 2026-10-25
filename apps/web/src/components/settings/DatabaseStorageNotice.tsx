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
import { shouldRecommendDatabaseCompaction, type EnvironmentId } from "@t3tools/contracts";
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
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow, SettingsSection } from "./settingsLayout";

const databaseCompaction = createDatabaseCompactionAtoms(connectionAtomRuntime); // fork: restart-compaction

/** Suggests `t3 doctor` for a database that still holds at least 1 GiB of freed pages. */
export function DatabaseStorageNotice({
  environmentId,
  label,
}: {
  environmentId: EnvironmentId;
  label: string;
}) {
  const result = useAtomValue(serverEnvironment.databaseStorage({ environmentId, input: {} }));
  const [dismissed, setDismissed] = useLocalStorage(
    `database-storage-notice-dismissed:${environmentId}`,
    false,
    Schema.Boolean,
  );
  const { copyToClipboard } = useCopyToClipboard({ target: "command" });
  const status = result._tag === "Success" ? result.value : null;
  if (dismissed || status === null || !shouldRecommendDatabaseCompaction(status)) return null;
  // fork: restart-compaction: the desktop app compacts its own database while it restarts.
  if (status.restartCompaction !== undefined) {
    return (
      <SettingsSection id={`storage-database-${environmentId}`} title="Database">
        <SettingsGroup>
          <RestartCompactionRow
            environmentId={environmentId}
            label={label}
            reclaimableBytes={status.reclaimableBytes}
            state={status.restartCompaction}
            onDismiss={() => setDismissed(true)}
          />
        </SettingsGroup>
      </SettingsSection>
    );
  }
  return (
    <SettingsSection id={`storage-database-${environmentId}`} title="Database">
      <SettingsGroup>
        <SettingsRow
          title={`Reclaim ${(status.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB on ${label}`}
          description={
            <>
              Old history is cleaned up automatically, but this database still holds the freed
              space. Run the command on {label} to return it to disk; it pauses and restarts the
              background service. Quit the desktop app first if it hosts this environment.
              <code className="mt-2 block select-text break-all">{status.compactCommand}</code>
            </>
          }
          control={
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(status.compactCommand, undefined)}
              >
                Copy command
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
                Dismiss
              </Button>
            </div>
          }
        />
      </SettingsGroup>
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
            size="sm"
            disabled={!allowed || pending}
            onClick={() => void update(false)}
          >
            Cancel compaction
          </Button>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || pending}
              onClick={() => void update(true)}
            >
              Compact at next restart
            </Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        )
      }
    />
  );
}
