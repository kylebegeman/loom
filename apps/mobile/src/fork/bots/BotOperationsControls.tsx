import { useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import type { BotOperationMode } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { SymbolView } from "../../components/ui/AppSymbol";
import { RowPressable } from "../../components/ui/RowPressable";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { BotsOutline } from "./BotIdentity";
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
  const [expanded, setExpanded] = useState(false);
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
  const mode = state.data?.mode;
  const label = MODES.find((entry) => entry.value === mode)?.label;
  const summary =
    mode === "paused"
      ? "New jobs are paused"
      : mode === "automatic"
        ? "You, agents and triggers can start jobs"
        : mode === "manual"
          ? "You and agents can start jobs"
          : !host.connected
            ? "Connect to read the mode"
            : state.error
              ? "Mode unavailable"
              : "Loading mode…";
  return (
    <BotsOutline>
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`Bot operation: ${label ?? summary}`}
        accessibilityHint="Shows operation modes and the control to stop all jobs"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        className="min-h-16 flex-row items-center gap-3 px-4 py-3"
      >
        <SymbolView
          name={mode === "paused" ? "pause" : "bolt.circle"}
          size={21}
          tintColorClassName="accent-icon-muted"
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-sm font-t3-medium">New jobs on {host.label}</Text>
          <Text className="text-xs text-foreground-muted">{summary}</Text>
        </View>
        {label ? (
          <LibraryStateBadge tone={mode === "paused" ? "warning" : "neutral"} label={label} />
        ) : null}
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          size={12}
          tintColorClassName="accent-icon-muted"
        />
      </RowPressable>
      {expanded ? (
        <View className="gap-4 border-t border-border-subtle p-4">
          {state.data ? (
            <BotChoice
              label="Allow new jobs"
              value={state.data.mode}
              options={MODES}
              disabled={!canSet || !host.connected || busy}
              onChange={(next) => void change(next)}
            />
          ) : null}
          <Text className="text-xs text-foreground-muted">
            Automatic also allows triggers. Changing the mode leaves accepted work running. Stop all
            jobs pauses new jobs and cancels accepted work, including jobs sent to other computers.
          </Text>
          <Button
            label="Stop all jobs"
            tone="danger"
            disabled={!canStop || !host.connected || busy}
            onPress={() => void stop()}
          />
        </View>
      ) : null}
      {error || state.error ? (
        <View className="px-4 pb-4">
          <BotNotice error={error ?? state.error} onRetry={state.refresh} />
        </View>
      ) : null}
    </BotsOutline>
  );
}
