import { useId, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { BotOperationMode } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { CircleHelpIcon, MonitorIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverPopup, PopoverTitle } from "~/components/ui/popover";
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

const MODES: ReadonlyArray<{ value: BotOperationMode; label: string; detail: string }> = [
  { value: "paused", label: "Paused", detail: "New jobs are paused. Accepted work continues." },
  {
    value: "manual",
    label: "Manual",
    detail: "You and agents can start jobs. Triggers stay paused.",
  },
  {
    value: "automatic",
    label: "Automatic",
    detail: "You, agents and enabled triggers can start jobs.",
  },
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
      className="flex flex-col gap-3 rounded-2xl bg-muted/40 px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <MonitorIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <label htmlFor={id} className="text-sm font-medium">
              {host.environment?.label ?? "This computer"}
            </label>
            <p className="text-xs text-muted-foreground">
              {MODES.find((mode) => mode.value === state.data?.mode)?.detail ??
                "Choose how new jobs start."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Run mode</span>
          {state.data ? (
            <div className="w-32">
              <Select
                value={state.data.mode}
                disabled={!canSet || !host.connected || busy}
                onValueChange={(value) => {
                  const mode = MODES.find((candidate) => candidate.value === value)?.value;
                  if (mode) void change(mode);
                }}
              >
                <SelectTrigger id={id} size="sm" aria-label="Bot run mode">
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
            </div>
          ) : !host.connected ? (
            <span className="text-xs text-muted-foreground">Connect to read the mode</span>
          ) : state.error ? (
            <span className="text-xs text-muted-foreground">Mode unavailable</span>
          ) : (
            <Skeleton className="h-8 w-28" />
          )}
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  shape="pill"
                  aria-label="About bot run modes"
                />
              }
            >
              <CircleHelpIcon />
            </PopoverTrigger>
            <PopoverPopup width="md" align="end">
              <div className="space-y-3 text-sm">
                <PopoverTitle>How jobs start</PopoverTitle>
                {MODES.map((mode) => (
                  <p key={mode.value}>
                    <span className="font-medium">{mode.label}. </span>
                    <span className="text-muted-foreground">{mode.detail}</span>
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  Changing mode affects new jobs. Stop all jobs also pauses new jobs and requests
                  cancellation of accepted work, including work sent to other computers.
                </p>
              </div>
            </PopoverPopup>
          </Popover>
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
      {error || state.error ? (
        <LibraryErrorNotice error={error ?? state.error!} onRetry={state.refresh} />
      ) : null}
    </section>
  );
}
