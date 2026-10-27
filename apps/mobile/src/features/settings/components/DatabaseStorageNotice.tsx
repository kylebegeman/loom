import { useAtomSet, useAtomValue } from "@effect/atom-react";
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
import type { RestartCompactionState } from "@t3tools/contracts/fork"; // fork: restart-compaction
import { AsyncResult } from "effect/reactivity";
import { useState } from "react"; // fork: restart-compaction
import { View } from "react-native"; // fork: restart-compaction

import { AppText as Text } from "../../../components/ui/AppText"; // fork: restart-compaction
import { connectionAtomRuntime } from "../../../connection/runtime"; // fork: restart-compaction
import { copyTextWithHaptic } from "../../../lib/copyTextWithHaptic";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../../state/preferences";
import { serverEnvironment } from "../../../state/server";
import { useAtomCommand } from "../../../state/use-atom-command"; // fork: restart-compaction
import type { SettingsTarget } from "../settings-environment-filter";
import { SettingsActionRow } from "./SettingsActionRow";
import { SettingsSection } from "./SettingsSection";

const databaseCompaction = createDatabaseCompactionAtoms(connectionAtomRuntime); // fork: restart-compaction

/** Suggests `t3 doctor` on every machine whose database still holds at least 1 GiB of freed pages. */
export function DatabaseStorageNotice({
  targets,
}: {
  readonly targets: readonly SettingsTarget[];
}) {
  const recommendations = useAtomValue(
    serverEnvironment.databaseCompactionRecommendations(
      JSON.stringify(targets.map((target) => target.environmentId)),
    ),
  );
  const preferences = useAtomValue(mobilePreferencesAtom);
  const updatePreferences = useAtomSet(updateMobilePreferencesAtom);
  const dismissed = AsyncResult.isSuccess(preferences)
    ? (preferences.value.dismissedDatabaseStorageNotices ?? [])
    : [];
  const visible = recommendations.filter(
    (recommendation) => !dismissed.includes(recommendation.environmentId),
  );
  if (visible.length === 0) return null;
  // fork: restart-compaction: both notices dismiss the same way.
  const dismiss = (environmentIds: readonly string[]) =>
    updatePreferences({
      transform: (current) => ({
        dismissedDatabaseStorageNotices: [
          ...new Set([...(current.dismissedDatabaseStorageNotices ?? []), ...environmentIds]),
        ],
      }),
    });
  // fork: restart-compaction: the desktop app compacts its own database while it restarts.
  const restartCompactions = visible.flatMap(({ environmentId, status }) => {
    const target = targets.find((entry) => entry.environmentId === environmentId);
    return target && status.restartCompaction !== undefined
      ? [{ target, status, state: status.restartCompaction }]
      : [];
  });
  // fork: restart-compaction
  const commands = visible.filter(({ status }) => status.restartCompaction === undefined);
  return (
    // fork: restart-compaction
    <>
      {restartCompactions.map(({ target, status, state }) => (
        <RestartCompactionSection
          key={target.environmentId}
          target={target}
          gib={(status.reclaimableBytes / 1024 ** 3).toFixed(1)}
          state={state}
          onDismiss={() => dismiss([target.environmentId])}
        />
      ))}
      {commands.length === 0 ? null : (
        <SettingsSection
          title="Reclaim database space"
          footer="Old history is cleaned up automatically, but these databases still hold the freed space. Run the command on each machine to return it to disk; it pauses and restarts the background service. Quit the desktop app first if it hosts the environment."
        >
          {commands.map(({ environmentId, status }) => (
            <SettingsActionRow
              key={environmentId}
              icon="doc.on.doc"
              label={targets.find((target) => target.environmentId === environmentId)?.label ?? ""}
              description={status.compactCommand}
              detail={`${(status.reclaimableBytes / 1024 ** 3).toFixed(1)} GiB`}
              onPress={() => copyTextWithHaptic(status.compactCommand, { target: "command" })}
            />
          ))}
          <SettingsActionRow
            icon="xmark"
            label="Dismiss"
            onPress={() => dismiss(commands.map((recommendation) => recommendation.environmentId))}
          />
        </SettingsSection>
      )}
    </>
  );
}

// fork: restart-compaction
function RestartCompactionSection({
  target,
  gib,
  state,
  onDismiss,
}: {
  readonly target: SettingsTarget;
  readonly gib: string;
  readonly state: RestartCompactionState;
  readonly onDismiss: () => void;
}) {
  const allowed = useAtomValue(databaseCompaction.setRequest.permissionAtom(target.environmentId));
  const setRequest = useAtomCommand(databaseCompaction.setRequest, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = async (requested: boolean) => {
    setPending(true);
    setError(null);
    const result = await setRequest({
      environmentId: target.environmentId,
      input: { requested },
    }).finally(() => setPending(false));
    if (AsyncResult.isFailure(result) && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const { plan, lastAttempt } = describeRestartCompaction(state, target.label);
  return (
    <SettingsSection title={`Reclaim ${gib} GiB on ${target.label}`}>
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          Old history is cleaned up automatically, but this database still holds the freed space.{" "}
          {plan} Compacting can take several minutes while Loom starts.
        </Text>
        {lastAttempt === null ? null : (
          <Text className="text-sm text-foreground-muted">{lastAttempt}</Text>
        )}
        {allowed ? null : (
          <Text className="text-sm text-foreground-muted">
            Settings permission is required to change this.
          </Text>
        )}
        {error === null ? null : (
          <Text selectable className="text-sm text-danger-foreground">
            {error}
          </Text>
        )}
      </View>
      {state.requested ? (
        <SettingsActionRow
          icon="arrow.uturn.backward"
          label="Cancel compaction"
          disabled={!allowed}
          loading={pending}
          onPress={() => void update(false)}
        />
      ) : (
        <>
          <SettingsActionRow
            icon="arrow.clockwise"
            label="Compact at next restart"
            disabled={!allowed}
            loading={pending}
            onPress={() => void update(true)}
          />
          <SettingsActionRow icon="xmark" label="Dismiss" onPress={onDismiss} />
        </>
      )}
    </SettingsSection>
  );
}
