import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { BotOperationMode } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryErrorNotice } from "../project-library/LibraryControls";
import { bots, useBotsHost } from "./state";

const MODES: ReadonlyArray<{ value: BotOperationMode; label: string }> = [
  { value: "paused", label: "Paused" },
  { value: "manual", label: "Manual" },
  { value: "automatic", label: "Automatic" },
];

export function BotOperationsControls() {
  const host = useBotsHost();
  const environmentId = host.environmentId;
  const id = useId();
  const state = useEnvironmentQuery(
    environmentId && host.operationsSupported && host.connected
      ? bots.operationChanges({ environmentId, input: {} })
      : null,
  );
  const canSet = useAtomValue(bots.setOperationMode.permissionAtom(environmentId));
  const canStop = useAtomValue(bots.stopAll.permissionAtom(environmentId));
  const setMode = useAtomCommand(bots.setOperationMode, { reportFailure: false });
  const stopAll = useAtomCommand(bots.stopAll, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!host.operationsSupported || !environmentId) return null;

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
    <section
      aria-label="Bot operation"
      className="flex flex-col gap-3 rounded-xl border border-border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          New jobs on {host.environment?.label ?? "this computer"}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          {state.data ? (
            <Select
              value={state.data.mode}
              disabled={!canSet || !host.connected || busy}
              onValueChange={(value) => {
                const mode = MODES.find((candidate) => candidate.value === value)?.value;
                if (mode) void change(mode);
              }}
            >
              <SelectTrigger id={id} size="sm">
                <SelectValue>
                  {MODES.find((mode) => mode.value === state.data?.mode)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : !host.connected ? (
            <span className="text-xs text-muted-foreground">Connect to read the mode</span>
          ) : state.error ? (
            <span className="text-xs text-muted-foreground">Mode unavailable</span>
          ) : (
            <Skeleton className="h-8 w-28" />
          )}
          <Button
            variant="destructive-outline"
            size="sm"
            disabled={!canStop || !host.connected || busy}
            onClick={() => void stop()}
          >
            Stop all jobs
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Paused refuses new jobs. Manual allows you and agents to start jobs. Automatic also allows
        triggers. Accepted work continues when the mode changes; Stop all jobs pauses new jobs and
        cancels accepted work, including jobs sent to other computers.
      </p>
      {error || state.error ? (
        <LibraryErrorNotice error={error ?? state.error!} onRetry={state.refresh} />
      ) : null}
    </section>
  );
}
