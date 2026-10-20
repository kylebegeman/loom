import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  isTerminalBotRunStatus,
  type BotRun,
  type BotRunStatus,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useAtomCommand } from "~/state/use-atom-command";
import { BotFindings, RawReply } from "./BotFindings";
import { bots } from "./state";
import { VERDICT_LABELS, VerdictChip } from "./VerdictChip";

export const RUN_STATUS: Record<
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

export const runTime = (value: string | null) => (value ? new Date(value).toLocaleString() : null);

export const runInputSummary = (run: BotRun) =>
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
  const status = RUN_STATUS[run.status];
  const active = !isTerminalBotRunStatus(run.status);
  const summary = runInputSummary(run);
  const verdict = run.verdict ?? null;

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
          {verdict ? <VerdictChip verdict={verdict.verdict} /> : null}
          {showBot ? <span className="font-medium">{run.botName}</span> : null}
          <span className="text-xs text-muted-foreground">
            {runTime(run.finishedAt) ?? runTime(run.startedAt) ?? runTime(run.createdAt)}
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
          {verdict || run.result ? (
            <Button size="xs" variant="ghost" onClick={() => setExpanded((open) => !open)}>
              {verdict
                ? expanded
                  ? "Hide findings"
                  : "Show findings"
                : expanded
                  ? "Hide reply"
                  : "Show reply"}
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
      {verdict && !expanded ? <p className="line-clamp-2 text-sm">{verdict.summary}</p> : null}
      {run.error ? <p className="text-sm text-destructive-foreground">{run.error}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {expanded && verdict ? (
        <BotFindings run={run} verdict={verdict} />
      ) : expanded && run.result ? (
        <RawReply run={run} />
      ) : null}
    </li>
  );
}

const FILTERS: ReadonlyArray<BotVerdictValue | null> = [null, "pass", "fail", "needs_attention"];

/** Narrows the run list to one verdict; runs without a verdict only show under All. */
export function VerdictFilter({
  value,
  onChange,
}: {
  readonly value: BotVerdictValue | null;
  readonly onChange: (value: BotVerdictValue | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Filter runs by verdict">
      {FILTERS.map((filter) => (
        <Button
          key={filter ?? "all"}
          size="xs"
          variant={value === filter ? "secondary" : "ghost"}
          aria-pressed={value === filter}
          onClick={() => onChange(filter)}
        >
          {filter === null ? "All" : VERDICT_LABELS[filter]}
        </Button>
      ))}
    </div>
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
