import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import type { BotRun } from "@t3tools/contracts/fork";
import {
  applyInboxChanges,
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  type BotsChanges,
  dismissRunIdBatches,
  type WaitingBotRunThread,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowUpRightIcon,
  CheckCheckIcon,
  CpuIcon,
  EllipsisIcon,
  InboxIcon,
  LayersIcon,
  MessageCircleQuestionIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  WorkflowIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibrarySection,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { BotModelPicker } from "./BotModelPicker";
import { BotRowsSkeleton, BotsEmptyList, runInputSummary } from "./BotRuns";
import { bots, inboxQueryInput, useRefreshWhenBotsChangesPruned } from "./state";
import { BotRunStatusBadge, BotTile, VerdictChip, runTime } from "./BotIdentity";
import { runDurationLabel, waitingAgeLabel } from "./runMetrics";
import type { BotDefinition as StubBot } from "@t3tools/contracts/fork";

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
          <Button shape="pill" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button shape="pill" disabled={busy || model === null} onClick={() => void submit()}>
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
  const tone = run.verdict
    ? BOT_VERDICT_STATES[run.verdict.verdict].tone
    : BOT_RUN_STATES[run.status].tone;
  const retryable = !dismissed && run.pipelineRunId == null;
  const meta = [
    runTime(run.finishedAt) ?? runTime(run.createdAt),
    runDurationLabel(run),
    run.modelSelection?.model ?? null,
  ]
    .filter(Boolean)
    .join(" · ");

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
    <li className="flex min-w-0 flex-col gap-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <BotTile bot={{ id: run.botId }} status={<LibraryStateDot tone={tone} />} />
        <div className="min-w-0 flex-1 basis-48">
          <p className="truncate text-sm font-medium">{run.botName}</p>
          <p className="truncate text-xs tabular-nums text-muted-foreground">{meta}</p>
        </div>
        {run.verdict ? (
          <VerdictChip verdict={run.verdict.verdict} />
        ) : (
          <BotRunStatusBadge status={run.status} />
        )}
        <div className="flex flex-wrap items-center gap-0.5">
          {dismissed ? null : run.pipelineRunId != null ? (
            // The server refuses to retry a pipeline's run; resuming the pipeline reruns it.
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              render={
                <Link
                  to="/loom/bots"
                  search={{ tab: "pipelines", pipelineRun: run.pipelineRunId }}
                />
              }
            >
              <WorkflowIcon />
              Open pipeline run
            </Button>
          ) : (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!canAct || busy !== null}
              onClick={() => void act("retry", "Could not retry the run.")}
            >
              <RotateCcwIcon />
              {busy === "retry" ? "Retrying…" : "Retry"}
            </Button>
          )}
          <Button
            shape="pill"
            size="xs"
            variant="ghost"
            disabled={!canAct || busy !== null}
            onClick={() => void act("open", "Could not open the run as a thread.")}
          >
            <ArrowUpRightIcon />
            {busy === "open" ? "Opening…" : "Open as thread"}
          </Button>
          <Button
            shape="pill"
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
            {dismissed ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
            {dismissed ? "Restore" : "Dismiss"}
          </Button>
          {retryable || run.batchId ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    shape="pill"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`More actions for this ${run.botName} run`}
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                {retryable ? (
                  <MenuItem
                    disabled={!canAct || busy !== null}
                    onClick={() => setRetryingElsewhere(true)}
                  >
                    <CpuIcon />
                    Retry on another model
                  </MenuItem>
                ) : null}
                {run.batchId ? (
                  <MenuItem render={<Link to="/loom/bots" search={{ batch: run.batchId }} />}>
                    <LayersIcon />
                    Open batch
                  </MenuItem>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : null}
        </div>
      </div>
      {summary || run.verdict || run.error || error ? (
        <div className="flex min-w-0 flex-col gap-1.5 ps-11">
          {summary ? <p className="truncate text-xs text-muted-foreground">{summary}</p> : null}
          {run.verdict ? (
            <p className="line-clamp-2 text-sm text-foreground/90">{run.verdict.summary}</p>
          ) : null}
          {run.error ? (
            <p className="text-sm text-destructive-foreground wrap-anywhere">{run.error}</p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {error}
            </p>
          ) : null}
        </div>
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

/** Threads blocked on a person read first and wear the warning tone, so they never blend in. */
function WaitingRuns({ waiting }: { readonly waiting: ReadonlyArray<WaitingBotRunThread> }) {
  const minute = useNowMinute();
  const now = Date.parse(`${minute}:00Z`);
  if (waiting.length === 0) return null;
  return (
    <LibrarySection title="Waiting for you" icon={MessageCircleQuestionIcon} count={waiting.length}>
      <ul
        className={cn(
          LIBRARY_OUTLINE,
          "flex flex-col divide-y divide-warning/20 overflow-hidden border-warning/40 bg-warning/5",
        )}
      >
        {waiting.map((thread) => (
          <li
            key={thread.id}
            className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
          >
            <LibraryStateDot tone="warning" className="mx-1" />
            <div className="min-w-0 flex-1 basis-48">
              <p className="truncate text-sm font-medium">{thread.title}</p>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      className="block w-fit rounded-sm text-xs tabular-nums text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  {thread.waitingSince
                    ? `Waiting ${waitingAgeLabel(thread.waitingSince, now) ?? "since an unknown time"}`
                    : `Last activity ${waitingAgeLabel(thread.updatedAt, now) ?? "an unknown time"} ago`}
                </TooltipTrigger>
                <TooltipPopup>
                  {runTime(thread.waitingSince ?? thread.updatedAt) ?? "Time unavailable"}
                </TooltipPopup>
              </Tooltip>
            </div>
            <LibraryStateBadge tone="warning">
              {thread.hasPendingApprovals ? "Needs approval" : "Has a question"}
            </LibraryStateBadge>
            <Button
              shape="pill"
              size="xs"
              variant="outline"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: thread.environmentId, threadId: thread.id }}
                />
              }
            >
              <ArrowUpRightIcon />
              Open thread
            </Button>
          </li>
        ))}
      </ul>
    </LibrarySection>
  );
}

const VIEWS = ["open", "dismissed"] as const;

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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm text-muted-foreground">
          Runs that need a person: questions and approvals first, then failed, timed out and
          undecided runs.
        </p>
        <div className="flex items-center gap-1.5">
          <ToggleGroup
            shape="pill"
            variant="segmented"
            aria-label="Inbox view"
            value={[showDismissed ? "dismissed" : "open"]}
            onValueChange={(next) => {
              const view = VIEWS.find((entry) => entry === next[0]);
              if (view) setShowDismissed(view === "dismissed");
            }}
          >
            <ToggleGroupItem value="open">Needs attention</ToggleGroupItem>
            <ToggleGroupItem value="dismissed">Dismissed</ToggleGroupItem>
          </ToggleGroup>
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh inbox"
            disabled={!connected || query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon />
          </Button>
        </div>
      </div>
      {showDismissed || waiting.length === 0 ? null : <WaitingRuns waiting={waiting} />}
      <LibrarySection
        title={showDismissed ? "Dismissed" : "Needs attention"}
        icon={showDismissed ? ArchiveIcon : InboxIcon}
        count={page?.total}
        action={
          !showDismissed && page && page.runs.length > 1 ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              disabled={!canAct || dismissing}
              onClick={() => void dismissAll(page.runs)}
            >
              <CheckCheckIcon />
              {dismissing ? "Dismissing…" : "Dismiss all shown"}
            </Button>
          ) : null
        }
      >
        <LibraryErrorNotice
          error={query.error ?? error}
          {...(query.error ? { onRetry: query.refresh } : {})}
        />
        {page === null ? (
          query.isPending ? (
            <BotRowsSkeleton label="Loading the inbox" />
          ) : null
        ) : page.runs.length === 0 ? (
          <BotsEmptyList
            icon={showDismissed ? ArchiveIcon : CheckCheckIcon}
            message={
              showDismissed
                ? "No dismissed run."
                : "Nothing needs you. Failed, timed out and undecided runs land here."
            }
          />
        ) : (
          <ul
            className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}
          >
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
      </LibrarySection>
    </div>
  );
}

// STUB(bots-redesign): replaced by the owning area's implementation.
/** The full queue of what needs a person, for the Runs view's Needs you scope. */
export function NeedsYouView(_props: {
  readonly bot: StubBot | null;
  readonly dismissed: boolean;
}) {
  return null;
}

/** The first few things that need a person, leading a page; nothing at all when the queue is clear. */
export function NeedsYouBand(_props: { readonly bot: StubBot | null }) {
  return null;
}
