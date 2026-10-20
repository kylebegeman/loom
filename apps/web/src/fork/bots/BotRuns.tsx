import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import { isTerminalBotRunStatus, type BotRun, type BotRunStatus } from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { bots } from "./state";

const STATUS: Record<
  BotRunStatus,
  { readonly label: string; readonly variant: "secondary" | "success" | "error" | "warning" }
> = {
  queued: { label: "Queued", variant: "secondary" },
  running: { label: "Running", variant: "secondary" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "warning" },
  timed_out: { label: "Timed out", variant: "error" },
};

const time = (value: string | null) => (value ? new Date(value).toLocaleString() : null);

const inputSummary = (run: BotRun) =>
  Object.entries(run.inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");

function RunRow({
  environmentId,
  run,
  showBot,
  canCancel,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly showBot: boolean;
  readonly canCancel: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const status = STATUS[run.status];
  const active = !isTerminalBotRunStatus(run.status);
  const summary = inputSummary(run);

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await cancel({ environmentId, input: { runId: run.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel the run.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {showBot ? <span className="font-medium">{run.botName}</span> : null}
          <span className="text-xs text-muted-foreground">
            {time(run.finishedAt) ?? time(run.startedAt) ?? time(run.createdAt)}
            {run.startedBy === "agent" ? " · started by an agent" : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {run.status === "queued" ? null : (
            <Button
              size="xs"
              variant="ghost"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: run.threadId }}
                />
              }
            >
              Open thread
            </Button>
          )}
          {run.result ? (
            <Button size="xs" variant="ghost" onClick={() => setExpanded((open) => !open)}>
              {expanded ? "Hide reply" : "Show reply"}
            </Button>
          ) : null}
          {active ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={!canCancel || busy}
              onClick={() => void stop()}
            >
              {busy ? "Cancelling…" : "Cancel"}
            </Button>
          ) : null}
        </div>
      </div>
      {summary ? <p className="truncate text-xs text-muted-foreground">{summary}</p> : null}
      {run.error ? <p className="text-sm text-destructive-foreground">{run.error}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {expanded && run.result ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
          {run.result}
          {run.resultTruncated ? "\n\n[Reply shortened. Open the thread for the full text.]" : ""}
        </pre>
      ) : null}
    </li>
  );
}

export function BotRuns({
  environmentId,
  runs,
  showBot,
  canCancel,
  emptyMessage,
}: {
  readonly environmentId: EnvironmentId;
  readonly runs: ReadonlyArray<BotRun>;
  readonly showBot: boolean;
  readonly canCancel: boolean;
  readonly emptyMessage: string;
}) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <ul className="grid gap-2">
      {runs.map((run) => (
        <RunRow
          key={run.id}
          environmentId={environmentId}
          run={run}
          showBot={showBot}
          canCancel={canCancel}
        />
      ))}
    </ul>
  );
}
