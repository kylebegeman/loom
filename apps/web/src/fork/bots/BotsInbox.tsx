import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import type { BotRun } from "@t3tools/contracts/fork";
import {
  applyInboxChanges,
  type BotsChanges,
  dismissRunIdBatches,
  type WaitingBotRunThread,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { BotModelPicker } from "./BotModelPicker";
import { runInputSummary } from "./BotRuns";
import { bots, inboxQueryInput, useRefreshWhenBotsChangesPruned } from "./state";
import { BotRunStatusBadge, VerdictChip, runTime } from "./BotIdentity";
import { runDurationLabel, waitingAgeLabel } from "./runMetrics";

const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

function RetryDialog({
  environmentId,
  run,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly onClose: () => void;
}) {
  const [model, setModel] = useState<ModelSelection | null>(run.modelSelection ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useAtomCommand(bots.retry, { reportFailure: false });

  const submit = async () => {
    if (model === null) return;
    setBusy(true);
    setError(null);
    const result = await retry({
      environmentId,
      input: { runId: run.id, modelSelection: model },
    });
    setBusy(false);
    if (result._tag === "Failure")
      setError(failureMessage(squashAtomCommandFailure(result), "Could not retry the run."));
    else onClose();
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Retry ${run.botName} on another model`}
      description="Only this retry uses the model you choose; the bot keeps its own."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || model === null} onClick={() => void submit()}>
            {busy ? "Retrying…" : "Retry"}
          </Button>
        </>
      }
    >
      <LibraryField label="Model">
        <BotModelPicker environmentId={environmentId} value={model} onChange={setModel} />
      </LibraryField>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </LibraryDialog>
  );
}

function InboxRow({
  environmentId,
  run,
  canAct,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly canAct: boolean;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<"retry" | "dismiss" | "open" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryingElsewhere, setRetryingElsewhere] = useState(false);
  const retry = useAtomCommand(bots.retry, { reportFailure: false });
  const dismiss = useAtomCommand(bots.dismiss, { reportFailure: false });
  const promote = useAtomCommand(bots.promote, { reportFailure: false });
  const dismissed = run.dismissedAt != null;
  const summary = runInputSummary(run);

  const act = async (kind: "retry" | "dismiss" | "open", fallback: string) => {
    setBusy(kind);
    setError(null);
    const result =
      kind === "retry"
        ? await retry({ environmentId, input: { runId: run.id } })
        : kind === "dismiss"
          ? await dismiss({ environmentId, input: { runIds: [run.id], dismissed: !dismissed } })
          : await promote({ environmentId, input: { runId: run.id } });
    if (result._tag === "Failure")
      setError(failureMessage(squashAtomCommandFailure(result), fallback));
    else if (kind === "open" && "threadId" in result.value) {
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      }).catch((cause: unknown) => setError(failureMessage(cause, fallback)));
    }
    setBusy(null);
  };

  return (
    <li className="grid gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {run.verdict ? (
            <VerdictChip verdict={run.verdict.verdict} />
          ) : (
            <BotRunStatusBadge status={run.status} />
          )}
          <span className="font-medium">{run.botName}</span>
          <span className="text-xs text-muted-foreground">{runDurationLabel(run)}</span>
          <span className="text-xs text-muted-foreground">
            {runTime(run.finishedAt) ?? runTime(run.createdAt)}
            {run.modelSelection ? ` · ${run.modelSelection.model}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {run.batchId ? (
            <Button
              size="xs"
              variant="ghost"
              render={<Link to="/loom/bots" search={{ tab: "batches", batch: run.batchId }} />}
            >
              Open batch
            </Button>
          ) : null}
          {dismissed ? null : run.pipelineRunId != null ? (
            // The server refuses to retry a pipeline's run; resuming the pipeline reruns it.
            <Button
              size="xs"
              variant="ghost"
              render={
                <Link
                  to="/loom/bots"
                  search={{ tab: "pipelines", pipelineRun: run.pipelineRunId }}
                />
              }
            >
              Open pipeline run
            </Button>
          ) : (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={!canAct || busy !== null}
                onClick={() => void act("retry", "Could not retry the run.")}
              >
                {busy === "retry" ? "Retrying…" : "Retry"}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={!canAct || busy !== null}
                onClick={() => setRetryingElsewhere(true)}
              >
                Retry on another model
              </Button>
            </>
          )}
          <Button
            size="xs"
            variant="ghost"
            disabled={!canAct || busy !== null}
            onClick={() => void act("open", "Could not open the run as a thread.")}
          >
            {busy === "open" ? "Opening…" : "Open as thread"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!canAct || busy !== null}
            onClick={() =>
              void act(
                "dismiss",
                dismissed ? "Could not restore the run." : "Could not dismiss it.",
              )
            }
          >
            {dismissed ? "Restore" : "Dismiss"}
          </Button>
        </div>
      </div>
      {summary ? <p className="truncate text-xs text-muted-foreground">{summary}</p> : null}
      {run.verdict ? <p className="line-clamp-2 text-sm">{run.verdict.summary}</p> : null}
      {run.error ? <p className="text-sm text-destructive-foreground">{run.error}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {retryingElsewhere ? (
        <RetryDialog
          environmentId={environmentId}
          run={run}
          onClose={() => setRetryingElsewhere(false)}
        />
      ) : null}
    </li>
  );
}

function WaitingRuns({ waiting }: { readonly waiting: ReadonlyArray<WaitingBotRunThread> }) {
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  if (waiting.length === 0) return null;
  return (
    <section className="space-y-2" aria-label="Waiting for you">
      <h3 className="font-medium">Waiting for you</h3>
      <ul className="grid gap-2">
        {waiting.map((thread) => (
          <li
            key={thread.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant="warning">
                {thread.hasPendingApprovals ? "Needs approval" : "Has a question"}
              </Badge>
              <span className="min-w-0">
                <span className="block truncate">{thread.title}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={<span tabIndex={0} className="block text-xs text-muted-foreground" />}
                  >
                    {thread.waitingSince
                      ? `Waiting ${waitingAgeLabel(thread.waitingSince, now) ?? "since an unknown time"}`
                      : `Last activity ${waitingAgeLabel(thread.updatedAt, now) ?? "an unknown time"} ago`}
                  </TooltipTrigger>
                  <TooltipPopup>
                    {runTime(thread.waitingSince ?? thread.updatedAt) ?? "Time unavailable"}
                  </TooltipPopup>
                </Tooltip>
              </span>
            </div>
            <Button
              size="xs"
              variant="ghost"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: thread.environmentId, threadId: thread.id }}
                />
              }
            >
              Open thread
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Runs that need a person: waiting on an answer first, then failed or undecided runs. */
export function BotsInbox({
  environmentId,
  changes,
  waiting,
  connected,
  canAct,
}: {
  readonly environmentId: EnvironmentId;
  readonly changes: BotsChanges;
  readonly waiting: ReadonlyArray<WaitingBotRunThread>;
  readonly connected: boolean;
  readonly canAct: boolean;
}) {
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismiss = useAtomCommand(bots.dismiss, { reportFailure: false });
  const query = useEnvironmentQuery(
    bots.inbox({ environmentId, input: inboxQueryInput(showDismissed) }),
  );
  // Changes missed while disconnected never arrive, so a reconnect refetches the inbox.
  const refresh = query.refresh;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
  useRefreshWhenBotsChangesPruned(changes, refresh);
  const page = query.data
    ? applyInboxChanges(query.data, changes, { dismissed: showDismissed })
    : null;

  const dismissAll = async (runs: ReadonlyArray<BotRun>) => {
    setDismissing(true);
    setError(null);
    for (const runIds of dismissRunIdBatches(runs)) {
      const result = await dismiss({ environmentId, input: { runIds, dismissed: true } });
      if (result._tag === "Failure") {
        setError(failureMessage(squashAtomCommandFailure(result), "Could not dismiss these runs."));
        break;
      }
    }
    setDismissing(false);
  };

  return (
    <div className="space-y-4">
      {showDismissed || waiting.length === 0 ? null : <WaitingRuns waiting={waiting} />}
      <section className="space-y-3" aria-label="Needs attention">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{showDismissed ? "Dismissed" : "Needs attention"}</h3>
          <div className="flex flex-wrap gap-1">
            {!showDismissed && page && page.runs.length > 1 ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={!canAct || dismissing}
                onClick={() => void dismissAll(page.runs)}
              >
                {dismissing ? "Dismissing…" : "Dismiss all shown"}
              </Button>
            ) : null}
            <Button
              size="xs"
              variant={showDismissed ? "secondary" : "ghost"}
              aria-pressed={showDismissed}
              onClick={() => setShowDismissed((shown) => !shown)}
            >
              Dismissed
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={!connected || query.isPending}
              onClick={query.refresh}
            >
              Refresh
            </Button>
          </div>
        </div>
        {query.error || error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {query.error ?? error}
          </p>
        ) : null}
        {page === null ? (
          query.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading the inbox…
            </p>
          ) : null
        ) : page.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showDismissed
              ? "No dismissed run."
              : "Nothing needs you. Failed, timed out and undecided runs land here."}
          </p>
        ) : (
          <ul className="grid gap-2">
            {page.runs.map((run) => (
              <InboxRow key={run.id} environmentId={environmentId} run={run} canAct={canAct} />
            ))}
          </ul>
        )}
        {page?.hasMore ? (
          <p className="text-xs text-muted-foreground">
            Showing the newest {page.runs.length} of {page.total}.
          </p>
        ) : null}
      </section>
    </div>
  );
}
