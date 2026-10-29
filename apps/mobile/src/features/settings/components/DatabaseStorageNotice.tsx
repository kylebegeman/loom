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
import { ListActionRow as SettingsActionRow } from "../../../components/ui/ListActionRow";
import { SettingsSection } from "./SettingsSection";

const databaseCompaction = createDatabaseCompactionAtoms(connectionAtomRuntime); // fork: restart-compaction

// fork: project-lifecycle -- collapse keeps every supported database visible.
export function DatabaseStorageNotice({
  targets,
}: {
  readonly targets: readonly SettingsTarget[];
}) {
  const recommendations = useAtomValue(
    serverEnvironment.databaseStorageStatuses(
      JSON.stringify(targets.map((target) => target.environmentId)),
    ),
  );
  const preferences = useAtomValue(mobilePreferencesAtom);
  const updatePreferences = useAtomSet(updateMobilePreferencesAtom);
  const dismissed = AsyncResult.isSuccess(preferences)
    ? (preferences.value.dismissedDatabaseStorageNotices ?? [])
    : [];
  const dismiss = (environmentId: string, collapse: boolean) =>
    updatePreferences({
      transform: (current) => ({
        dismissedDatabaseStorageNotices: collapse
          ? [...new Set([...(current.dismissedDatabaseStorageNotices ?? []), environmentId])]
          : (current.dismissedDatabaseStorageNotices ?? []).filter((id) => id !== environmentId),
      }),
    });
  return (
    <>
      {recommendations.map(({ environmentId, status }) => {
        const target = targets.find((entry) => entry.environmentId === environmentId);
        if (!target) return null;
        const summary = `${(status.databaseBytes / 1024 ** 3).toFixed(2)} GiB stored; ${(status.reclaimableBytes / 1024 ** 3).toFixed(2)} GiB reclaimable.`;
        if (dismissed.includes(environmentId))
          return (
            <SettingsSection key={environmentId} title={`Database on ${target.label}`}>
              <View className="gap-3 p-4">
                <Text className="text-sm text-foreground-muted">{summary}</Text>
                <SettingsActionRow
                  icon="chevron.down"
                  label="Show details"
                  onPress={() => dismiss(environmentId, false)}
                />
              </View>
            </SettingsSection>
          );
        if (status.restartCompaction)
          return (
            <RestartCompactionSection
              key={environmentId}
              target={target}
              summary={summary}
              state={status.restartCompaction}
              onDismiss={() => dismiss(environmentId, true)}
            />
          );
        return (
          <SettingsSection key={environmentId} title={`Database on ${target.label}`}>
            <View className="gap-2 p-4">
              <Text className="text-sm text-foreground-muted">{summary}</Text>
              <Text className="text-sm text-foreground-muted">
                {status.incrementalVacuumEnabled
                  ? "Freed pages return to disk automatically."
                  : "Run the repair command on this computer. It pauses and restarts the background service; quit the desktop app first if it hosts the environment."}
              </Text>
            </View>
            {!status.incrementalVacuumEnabled ? (
              <SettingsActionRow
                icon="doc.on.doc"
                label="Copy repair command"
                description={status.compactCommand}
                onPress={() => copyTextWithHaptic(status.compactCommand, { target: "command" })}
              />
            ) : null}
            <SettingsActionRow
              icon="chevron.up"
              label="Collapse details"
              onPress={() => dismiss(environmentId, true)}
            />
          </SettingsSection>
        );
      })}
    </>
  );
}

// fork: restart-compaction
function RestartCompactionSection({
  target,
  summary, // fork: project-lifecycle
  state,
  onDismiss,
}: {
  readonly target: SettingsTarget;
  readonly summary: string; // fork: project-lifecycle
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
    <SettingsSection title={`Database on ${target.label}`}>
      <View className="gap-3 p-4">
        <Text className="text-sm text-foreground-muted">
          {summary} {plan} Compacting can take several minutes while Loom starts.
        </Text>
        {lastAttempt === null ? null : (
          <Text className="text-sm text-foreground-muted">
            {lastAttempt}{" "}
            {state.lastAttempt ? `(${new Date(state.lastAttempt.at).toLocaleString()})` : ""}
          </Text>
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
          <SettingsActionRow icon="xmark" label="Collapse details" onPress={onDismiss} />
        </>
      )}
    </SettingsSection>
  );
}
