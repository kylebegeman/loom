import { useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotOperationMode } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotChoice, BotNotice } from "./BotControls";
import { bots, useBotsCapabilities } from "./state";

const MODES: ReadonlyArray<{ value: BotOperationMode; label: string }> = [
  { value: "paused", label: "Paused" },
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
];

export function BotOperationsControls({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const host = useBotsCapabilities(environmentId);
  const state = useEnvironmentQuery(
    host.operationsSupported && host.connected
      ? bots.operationChanges({ environmentId, input: {} })
      : null,
  );
  const canSet = useAtomValue(bots.setOperationMode.permissionAtom(environmentId));
  const canStop = useAtomValue(bots.stopAll.permissionAtom(environmentId));
  const setMode = useAtomCommand(bots.setOperationMode, { reportFailure: false });
  const stopAll = useAtomCommand(bots.stopAll, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!host.operationsSupported) return null;
  const change = async (mode: BotOperationMode) => {
    setBusy(true);
    setError(null);
    const result = await setMode({ environmentId, input: { mode } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    setBusy(false);
  };
  const stop = async () => {
    setBusy(true);
    setError(null);
    const result = await stopAll({ environmentId, input: {} });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else if (result.value.failures.length)
      setError(
        `Bots are paused. ${result.value.failures.length} jobs still need stopping: ${result.value.failures.map((failure) => `${failure.kind} ${failure.id}: ${failure.message}`).join("; ")}`,
      );
    setBusy(false);
  };
  return (
    <View className="gap-3 rounded-xl border border-border-subtle p-4">
      {state.data ? (
        <BotChoice
          label={`New jobs on ${host.label}`}
          value={state.data.mode}
          options={MODES}
          disabled={!canSet || !host.connected || busy}
          onChange={(mode) => void change(mode)}
        />
      ) : (
        <Text className="text-xs text-foreground-muted">
          {!host.connected
            ? "Connect to read the operation mode."
            : state.error
              ? "Operation mode unavailable."
              : "Loading operation mode…"}
        </Text>
      )}
      <Text className="text-xs text-foreground-muted">
        Paused refuses new jobs. Manual allows you and agents to start jobs. Automatic also allows
        triggers. Accepted work continues when the mode changes. Stop all jobs pauses new jobs and
        cancels accepted work, including jobs sent to other computers.
      </Text>
      <Button
        label="Stop all jobs"
        tone="danger"
        disabled={!canStop || !host.connected || busy}
        onPress={() => void stop()}
      />
      {error || state.error ? (
        <BotNotice error={error ?? state.error} onRetry={state.refresh} />
      ) : null}
    </View>
  );
}
