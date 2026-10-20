import { useEffect, useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  BOTS_REPLAY_MAX_RUNS,
  type BotDefinition,
  type BotDefinitionInput,
  type BotReplay,
  type BotReplayComparison,
  type BotRun,
} from "@t3tools/contracts/fork";
import { applyRunChanges, formatReplaySummary } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog } from "../project-library/LibraryControls";
import { RUN_STATUS, runInputSummary, runTime } from "./BotRuns";
import { defaultReplaySelection, replayCandidates } from "./replay";
import { bots, useBotsChanges } from "./state";
import { VerdictChip } from "./VerdictChip";

export type BotReplaySourceChoice =
  | { readonly kind: "draft"; readonly draft: BotDefinitionInput }
  | { readonly kind: "version"; readonly version: number };

const COMPARISONS: Record<
  BotReplayComparison,
  {
    readonly label: string;
    readonly variant: "secondary" | "success" | "error" | "warning" | "info";
  }
> = {
  fixed: { label: "Fixed", variant: "success" },
  broke: { label: "Broke", variant: "error" },
  same: { label: "Same", variant: "secondary" },
  changed: { label: "Changed", variant: "info" },
  pending: { label: "Waiting", variant: "secondary" },
  failed: { label: "Failed", variant: "error" },
};

function RunOutcome({ title, run }: { readonly title: string; readonly run: BotRun | undefined }) {
  if (run === undefined)
    return (
      <div className="grid gap-1 rounded-md bg-muted p-2 text-xs">
        <span className="text-muted-foreground">{title}</span>
        <span className="text-muted-foreground">Not started</span>
      </div>
    );
  const status = RUN_STATUS[run.status];
  return (
    <div className="grid content-start gap-1 rounded-md bg-muted p-2 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-muted-foreground">{title}</span>
        <Badge variant={status.variant}>{status.label}</Badge>
        {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
      </div>
      <p className="line-clamp-4 whitespace-pre-wrap">
        {run.verdict?.summary ?? run.result ?? run.error ?? ""}
      </p>
    </div>
  );
}

/**
 * Runs earlier inputs again with a draft or a saved version and shows each new result beside the
 * original. Nothing about the bot changes; a draft is only saved from the editor.
 */
export function BotReplayDialog({
  environmentId,
  bot,
  source,
  canRun,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly bot: BotDefinition;
  readonly source: BotReplaySourceChoice;
  readonly canRun: boolean;
  readonly onClose: () => void;
}) {
  const changes = useBotsChanges(environmentId, true);
  const runsQuery = useEnvironmentQuery(
    bots.listRuns({ environmentId, input: { botId: bot.id, limit: BOTS_LIST_RUNS_MAX_LIMIT } }),
  );
  const runs = applyRunChanges(runsQuery.data?.runs ?? [], changes, {
    botId: bot.id,
    includeNew: true,
  });
  const candidates = replayCandidates(runs, bot.id);
  const [selected, setSelected] = useState<ReadonlyArray<string> | null>(null);
  const chosen = selected ?? (runsQuery.data ? defaultReplaySelection(candidates) : []);
  const [started, setStarted] = useState<BotReplay | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replay = useAtomCommand(bots.replay, { reportFailure: false });
  const cancel = useAtomCommand(bots.cancelReplay, { reportFailure: false });
  const replayQuery = useEnvironmentQuery(
    started ? bots.getReplay({ environmentId, input: { replayId: started.id } }) : null,
  );
  const current = replayQuery.data ?? started;
  const runById = new Map(runs.map((run) => [run.id, run]));

  // The replay itself is not watched; its runs are, so each of their changes refetches it.
  const replayId = started?.id;
  const progress = [...changes.runs.values()]
    .filter((run) => replayId !== undefined && run.replayId === replayId)
    .map((run) => `${run.id}:${run.status}`)
    .join(",");
  const refreshReplay = replayQuery.refresh;
  useEffect(() => {
    if (progress !== "") refreshReplay();
  }, [progress, refreshReplay]);

  const toggle = (runId: string, on: boolean) =>
    setSelected(
      on
        ? [...chosen.filter((id) => id !== runId), runId].slice(0, BOTS_REPLAY_MAX_RUNS)
        : chosen.filter((id) => id !== runId),
    );

  const start = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await replay({
        environmentId,
        input: {
          botId: bot.id,
          runIds: chosen,
          ...(source.kind === "draft" ? { draft: source.draft } : { version: source.version }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setStarted(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the replay.");
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await cancel({ environmentId, input: { replayId: current.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setStarted(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not cancel the replay.");
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel =
    source.kind === "draft" ? "your unsaved edit" : `v${source.version} of ${bot.name}`;

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Replay ${bot.name}`}
      description={`Runs earlier inputs again with ${sourceLabel} and compares each result with the original. Replays count toward the bot's budget.`}
      actions={
        current ? (
          <>
            {current.status === "running" ? (
              <Button variant="outline" className="sm:me-auto" disabled={busy} onClick={stop}>
                Cancel replay
              </Button>
            ) : null}
            <Button variant="ghost" onClick={replayQuery.refresh}>
              Refresh
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!canRun || busy || chosen.length === 0} onClick={() => void start()}>
              {busy
                ? "Starting…"
                : chosen.length === 1
                  ? "Replay 1 run"
                  : `Replay ${chosen.length} runs`}
            </Button>
          </>
        )
      }
    >
      <div className="grid gap-3">
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {current ? (
          <>
            <p role="status" className="text-sm">
              {current.status === "running"
                ? "Replaying. "
                : current.status === "cancelled"
                  ? "Cancelled. "
                  : "Done. "}
              {formatReplaySummary(current.summary)}
            </p>
            <ul className="grid gap-2">
              {current.items.map((item) => {
                const original = runById.get(item.originalRunId);
                const comparison = COMPARISONS[item.comparison];
                return (
                  <li
                    key={item.originalRunId}
                    className="grid gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={comparison.variant}>{comparison.label}</Badge>
                      <span className="truncate text-xs text-muted-foreground">
                        {original ? runInputSummary(original) || "No inputs" : item.originalRunId}
                      </span>
                    </div>
                    {item.reason ? (
                      <p className="text-sm text-destructive-foreground">{item.reason}</p>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <RunOutcome title="Before" run={original} />
                      <RunOutcome
                        title="After"
                        run={item.replayRunId === null ? undefined : runById.get(item.replayRunId)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        ) : runsQuery.error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {runsQuery.error}
          </p>
        ) : runsQuery.isPending && !runsQuery.data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading runs…
          </p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {bot.name} has no finished runs to replay yet.
          </p>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm text-muted-foreground">
              Choose up to {BOTS_REPLAY_MAX_RUNS} runs. Rated runs are chosen first.
            </legend>
            {candidates.map((run) => {
              const status = RUN_STATUS[run.status];
              return (
                <label key={run.id} className="flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={chosen.includes(run.id)}
                    disabled={!chosen.includes(run.id) && chosen.length >= BOTS_REPLAY_MAX_RUNS}
                    onCheckedChange={(checked) => toggle(run.id, checked === true)}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex flex-wrap items-center gap-1">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      {run.verdict ? <VerdictChip verdict={run.verdict.verdict} /> : null}
                      {run.rating ? (
                        <Badge variant={run.rating === "up" ? "success" : "error"}>
                          {run.rating === "up" ? "Good" : "Bad"}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        v{run.botVersion} · {runTime(run.finishedAt ?? run.createdAt)}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {runInputSummary(run) || "No inputs"}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
      </div>
    </LibraryDialog>
  );
}
