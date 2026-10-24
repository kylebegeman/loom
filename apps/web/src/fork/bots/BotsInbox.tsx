import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_LIST_RUNS_MAX_LIMIT,
  isTerminalBotRunStatus,
  type BotDefinition,
  type BotRun,
} from "@t3tools/contracts/fork";
import {
  applyInboxChanges,
  botColor,
  dismissRunIdBatches,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BotIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CircleXIcon,
  CloudOffIcon,
  CopyIcon,
  CpuIcon,
  EllipsisIcon,
  FileWarningIcon,
  HandIcon,
  InfoIcon,
  LayersIcon,
  ListFilterIcon,
  MessageCircleQuestionIcon,
  MessageSquareIcon,
  MessageSquareShareIcon,
  PanelRightOpenIcon,
  PlayIcon,
  ReplyIcon,
  RotateCcwIcon,
  ScanSearchIcon,
  SquareIcon,
  TimerOffIcon,
  WorkflowIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { Toggle } from "~/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LIBRARY_ROW,
  LibraryErrorNotice,
  LibraryFilterChip,
  LibraryGroupHeading,
  LibraryNotice,
  LibrarySection,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { TickStrip } from "../project-library/LibraryData";
import { ProjectColorDot } from "../project-library/ProjectIdentity";
import { useLibraryPermission } from "../project-library/state";
import { BotFindings, RawReply } from "./BotFindings";
import { BotTile, runTime } from "./BotIdentity";
import {
  combineTriagePages,
  dismissibleRunIds,
  foldRepeats,
  groupTriage,
  olderCursor,
  orderTriage,
  triageBotCounts,
  triageBotState,
  triageEvidence,
  triageInputSummary,
  triageItems,
  triageReasonLabel,
  triageRunId,
  triageTone,
  triageVerb,
  type TriageBotCount,
  type TriageBotState,
  type TriageEntry,
  type TriageGroup,
  type TriageItem,
  type TriageReason,
  type TriageSection,
  type TriageVerb,
} from "./inboxWaiting";
import { botsPageOf, useBotsNavigation, type BotsNavigation } from "./navigation";
import { rememberRuns } from "./runLog";
import { runDurationLabel, runTokensLabel, waitingAgeLabel } from "./runMetrics";
import { RetryOnModelDialog } from "./RunSheet";
import {
  bots,
  inboxQueryInput,
  useBots,
  useBotsAccess,
  useRefreshWhenBotsChangesPruned,
  useWaitingBotRuns,
} from "./state";

const BAND_ROWS = 4;
/** Only the total is read; one run is the smallest page the server returns it with. */
const DISMISSED_COUNT_INPUT = { limit: 1, dismissed: true } as const;
const OFFLINE_REASON = "Reconnect to act on runs.";
const READ_ONLY_REASON = "This device can view bot runs but not act on them.";
const ABSOLUTE_TIME = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const REASON_ICONS: Record<TriageReason, LucideIcon> = {
  approval: HandIcon,
  question: MessageCircleQuestionIcon,
  failed: CircleXIcon,
  timed_out: TimerOffIcon,
  undecided: CircleHelpIcon,
  invalid: FileWarningIcon,
  pipeline: WorkflowIcon,
};

const TONE_INK: Record<LibraryWorkflowTone, string> = {
  neutral: "text-muted-foreground",
  active: "text-(--project-color)",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
};

const GROUPS: Record<TriageGroup, { title: string; hint: string; tone: LibraryWorkflowTone }> = {
  waiting: { title: "Waiting on you", hint: "Paused until you answer", tone: "warning" },
  failed: { title: "Failed or timed out", hint: "Retry, or open one to see why", tone: "danger" },
  undecided: { title: "Undecided", hint: "The bot could not decide, so you do", tone: "warning" },
  pipeline: {
    title: "Stopped pipelines",
    hint: "Each goes on once you resume it",
    tone: "warning",
  },
};
const DISMISSED_HINT = "Restore one to put it back in Needs you";

type ActingVerb = Exclude<TriageVerb, "answer" | "review">;
type TriageBusy = ActingVerb | "dismiss" | "promote" | "cancel";

const VERBS: Record<TriageVerb, { label: string; busy: string; icon: LucideIcon }> = {
  answer: { label: "Answer", busy: "Answer", icon: ReplyIcon },
  retry: { label: "Retry", busy: "Retrying…", icon: RotateCcwIcon },
  review: { label: "Review", busy: "Review", icon: ScanSearchIcon },
  resume: { label: "Resume", busy: "Resuming…", icon: PlayIcon },
  restore: { label: "Restore", busy: "Restoring…", icon: ArchiveRestoreIcon },
};

const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message.trim() ? cause.message : fallback;

const blockedReason = (allowed: boolean, connected: boolean) =>
  allowed ? null : connected ? READ_ONLY_REASON : OFFLINE_REASON;

/** Where the queue comes from, for the band and the full view alike. */
function useTriageSources(bot: BotDefinition | null, dismissed: boolean) {
  const { host, live, changes, list, bots: definitions } = useBots();
  const environmentId = host.environmentId;
  const inboxLive = live && host.inboxSupported;
  // The input the footer count asks for, so the band adds no request of its own.
  const first = useEnvironmentQuery(
    environmentId && inboxLive
      ? bots.inbox({ environmentId, input: inboxQueryInput(dismissed) })
      : null,
  );
  // Waiting runs come from this client's thread shells, so no server feature gates them.
  const waiting = useWaitingBotRuns(dismissed ? null : environmentId);
  // A waiting thread is joined to its run for its bot and inputs. This is the input the bot pages
  // and the Runs view ask for, so it shares their request rather than adding one.
  const joined = useEnvironmentQuery(
    environmentId && live && waiting.length > 0
      ? bots.listRuns({
          environmentId,
          input: { limit: BOTS_LIST_RUNS_MAX_LIMIT, ...(bot ? { botId: bot.id } : {}) },
        })
      : null,
  );
  const findRun = (runId: string) =>
    changes.runs.get(runId) ?? joined.data?.runs.find((run) => run.id === runId);
  // A server that cannot look a run up opens one only from runs a list has shown.
  useEffect(() => {
    if (first.data) rememberRuns(first.data.runs);
  }, [first.data]);
  useEffect(() => {
    if (joined.data) rememberRuns(joined.data.runs);
  }, [joined.data]);
  return {
    host,
    environmentId,
    inboxLive,
    changes,
    first,
    waiting,
    findRun,
    definitions: list.data ? definitions : null,
  };
}

function useTriageAccess(environmentId: EnvironmentId | null, connected: boolean) {
  const access = useBotsAccess();
  const promote = useLibraryPermission(bots.promote, environmentId);
  const resume = useLibraryPermission(bots.resumePipelineRun, environmentId);
  return {
    connected,
    canRetry: access.canRetry,
    canDismiss: access.canDismiss,
    canCancel: access.canCancel,
    canPromote: promote && connected,
    canResume: resume && connected,
  };
}

type TriageAccess = ReturnType<typeof useTriageAccess>;

interface TriageContext {
  readonly environmentId: EnvironmentId;
  readonly access: TriageAccess;
  readonly definitions: readonly BotDefinition[] | null;
  readonly now: number;
  readonly dismissed: boolean;
  /** On a bot's own page every row is that bot, so its inputs lead instead of its name. */
  readonly showBot: boolean;
  /** After runs are dismissed or restored, for counts the watch cannot keep current. */
  readonly onSettled: () => void;
}

/** Changes missed while disconnected never arrive, so a reconnect refetches. */
function useRefreshOnReconnect(connected: boolean, refresh: () => void) {
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) refresh();
    wasConnected.current = connected;
  }, [connected, refresh]);
}

function useDismissal(environmentId: EnvironmentId, onSettled: () => void) {
  const command = useAtomCommand(bots.dismiss, { reportFailure: false });
  const update = async (ids: readonly string[], dismissed: boolean) => {
    const done: string[] = [];
    for (const runIds of dismissRunIdBatches(ids.map((id) => ({ id })))) {
      const result = await command({ environmentId, input: { runIds, dismissed } });
      if (result._tag === "Failure")
        return {
          done,
          error: failureMessage(
            squashAtomCommandFailure(result),
            dismissed ? "Could not dismiss these runs." : "Could not restore these runs.",
          ),
        };
      done.push(...runIds);
    }
    return { done, error: null };
  };
  const restore = async (ids: readonly string[]) => {
    const { error } = await update(ids, false);
    onSettled();
    return error;
  };
  /** The toast's Undo restores exactly the runs this dismissed, even when a later batch failed. */
  const dismiss = async (ids: readonly string[], what: string) => {
    const { done, error } = await update(ids, true);
    onSettled();
    if (done.length > 0)
      toastManager.add({
        type: "success",
        title:
          done.length < ids.length
            ? `Dismissed ${done.length} of ${ids.length} runs`
            : done.length === 1
              ? `Dismissed ${what}`
              : `Dismissed ${done.length} runs`,
        description:
          done.length === 1 ? "It stays under Show dismissed." : "They stay under Show dismissed.",
        actionProps: {
          children: "Undo",
          onClick: () =>
            void restore(done).then((failed) => {
              if (failed)
                toastManager.add({
                  type: "error",
                  title: "Could not undo the dismiss",
                  description: failed,
                });
            }),
        },
      });
    return error;
  };
  return { dismiss, restore };
}

function announceRetry(nav: BotsNavigation, botName: string, next: BotRun) {
  toastManager.add({
    type: "success",
    title: `Retrying ${botName}`,
    ...(next.modelSelection ? { description: `On ${next.modelSelection.model}.` } : {}),
    actionProps: { children: "Open run", onClick: () => nav.overlay({ runId: next.id }) },
  });
}

/** Says why a control is off; a disabled button takes no hover, so its wrapper carries the tip. */
function Guard({
  reason,
  children,
}: {
  readonly reason: string | null;
  readonly children: ReactElement;
}) {
  if (reason === null) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  );
}

function IconAction({
  label,
  reason,
  disabled,
  onClick,
  children,
}: {
  readonly label: string;
  readonly reason: string | null;
  readonly disabled: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          shape="pill"
          size="icon-xs"
          variant="ghost"
          aria-label={label}
          disabled={reason !== null || disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipPopup>{reason ?? label}</TooltipPopup>
    </Tooltip>
  );
}

function TriageTile({
  botId,
  botState,
}: {
  readonly botId: string | null;
  readonly botState: TriageBotState;
}) {
  return botId === null || botState === "deleted" ? (
    <span
      aria-hidden
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-accent"
    >
      <BotIcon className="size-4" />
    </span>
  ) : (
    <BotTile bot={{ id: botId }} />
  );
}

function VerbButton({
  verb,
  item,
  busy,
  access,
  onAct,
  onReview,
}: {
  readonly verb: TriageVerb;
  readonly item: TriageItem;
  readonly busy: TriageBusy | null;
  readonly access: TriageAccess;
  readonly onAct: (verb: ActingVerb) => void;
  readonly onReview: () => void;
}) {
  const { label, busy: busyLabel, icon: Icon } = VERBS[verb];
  const name = `${label} the ${item.botName} run`;
  if (verb === "answer" && item.kind === "waiting")
    return (
      <Button
        shape="pill"
        size="xs"
        variant="outline"
        aria-label={name}
        render={
          <Link
            to="/$environmentId/$threadId"
            params={{ environmentId: item.thread.environmentId, threadId: item.thread.id }}
          />
        }
      >
        <Icon />
        {label}
      </Button>
    );
  if (verb === "answer" || verb === "review")
    return (
      <Button shape="pill" size="xs" variant="outline" aria-label={name} onClick={onReview}>
        <Icon />
        {label}
      </Button>
    );
  const allowed =
    verb === "retry" ? access.canRetry : verb === "resume" ? access.canResume : access.canDismiss;
  const reason = blockedReason(allowed, access.connected);
  return (
    <Guard reason={reason}>
      <Button
        shape="pill"
        size="xs"
        variant="outline"
        aria-label={name}
        disabled={reason !== null || busy !== null}
        onClick={() => onAct(verb)}
      >
        <Icon />
        {busy === verb ? busyLabel : label}
      </Button>
    </Guard>
  );
}

function TriageMenu({
  item,
  verb,
  botState,
  busy,
  ctx,
  onRetry,
  onChooseModel,
  onPromote,
  onCancel,
  onCopyError,
}: {
  readonly item: TriageItem;
  readonly verb: TriageVerb;
  readonly botState: TriageBotState;
  readonly busy: TriageBusy | null;
  readonly ctx: TriageContext;
  readonly onRetry: () => void;
  readonly onChooseModel: () => void;
  readonly onPromote: () => void;
  readonly onCancel: () => void;
  readonly onCopyError: () => void;
}) {
  const nav = useBotsNavigation();
  const { access } = ctx;
  const run = item.run;
  const runId = triageRunId(item);
  const retryable =
    item.kind === "run" && !ctx.dismissed && item.reason !== "pipeline" && botState === "active";
  const links = run ? [run.pipelineRunId, run.batchId, run.callerThreadId].some(Boolean) : false;
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`More for the ${item.botName} run`}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        {runId !== null && verb !== "review" ? (
          <MenuItem onClick={() => nav.overlay({ runId })}>
            <PanelRightOpenIcon />
            Open run
          </MenuItem>
        ) : null}
        {item.kind === "run" ? (
          <MenuItem
            render={
              <Link
                to="/$environmentId/$threadId"
                // A remote run's thread lives on the computer that ran it.
                params={{
                  environmentId: item.run.ranOn?.environmentId ?? ctx.environmentId,
                  threadId: item.run.threadId,
                }}
              />
            }
          >
            <ArrowUpRightIcon />
            Go to run thread
          </MenuItem>
        ) : null}
        {/* The server forks the run's thread where it runs, which a remote run's is not. */}
        {item.kind === "run" && isTerminalBotRunStatus(item.run.status) && !item.run.ranOn ? (
          <MenuItem disabled={!access.canPromote || busy !== null} onClick={onPromote}>
            <MessageSquareShareIcon />
            {item.run.promotedThreadId ? "Open continued thread" : "Open as thread"}
            {item.run.promotedThreadId ? null : (
              <span className="ms-auto ps-4 text-xs text-muted-foreground">Makes a thread</span>
            )}
          </MenuItem>
        ) : null}
        {retryable ? (
          <>
            <MenuSeparator />
            {verb === "retry" ? null : (
              <MenuItem disabled={!access.canRetry || busy !== null} onClick={onRetry}>
                <RotateCcwIcon />
                Retry
              </MenuItem>
            )}
            <MenuItem disabled={!access.canRetry || busy !== null} onClick={onChooseModel}>
              <CpuIcon />
              Retry on another model…
            </MenuItem>
          </>
        ) : null}
        {links ? <MenuSeparator /> : null}
        {run?.pipelineRunId ? (
          <MenuItem render={<Link to="/loom/bots" search={{ pipelineRun: run.pipelineRunId }} />}>
            <WorkflowIcon />
            Open pipeline run
          </MenuItem>
        ) : null}
        {run?.batchId ? (
          <MenuItem
            render={
              <Link
                to="/loom/bots"
                // From a bot's page, so the batch page leads back to that bot's batches.
                search={{
                  batch: run.batchId,
                  ...(nav.search.bot ? { bot: nav.search.bot } : {}),
                }}
              />
            }
          >
            <LayersIcon />
            Open batch
          </MenuItem>
        ) : null}
        {run?.callerThreadId ? (
          <MenuItem
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: ctx.environmentId, threadId: run.callerThreadId }}
              />
            }
          >
            <MessageSquareIcon />
            Go to the thread that asked
          </MenuItem>
        ) : null}
        {run?.error ? (
          <MenuItem onClick={onCopyError}>
            <CopyIcon />
            Copy error
          </MenuItem>
        ) : null}
        {item.kind === "waiting" && runId !== null ? (
          <>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              disabled={!access.canCancel || busy !== null}
              onClick={onCancel}
            >
              <SquareIcon />
              Cancel run
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

/** Everything that says why, on demand: the full error, the findings or the raw reply, and facts. */
function TriageDetail({
  run,
  definition,
}: {
  readonly run: BotRun;
  readonly definition: BotDefinition | null;
}) {
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : Number.NaN;
  const facts = [
    run.modelSelection?.model ?? null,
    runDurationLabel(run),
    runTokensLabel(run),
    definition && definition.version !== run.botVersion
      ? `Ran v${run.botVersion}, the bot is now v${definition.version}`
      : `v${run.botVersion}`,
    Number.isFinite(finished) ? `Ended ${ABSOLUTE_TIME.format(finished)}` : null,
  ].filter(Boolean);
  return (
    <div className="col-span-full flex min-w-0 flex-col gap-3 pt-1 pb-2 ps-11">
      {run.error ? (
        <pre className="max-h-48 overflow-auto rounded-lg bg-muted/40 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap wrap-anywhere dark:bg-accent/40">
          {run.error}
        </pre>
      ) : null}
      {run.verdict?.source === "decoded" ? (
        <>
          <p className="text-sm text-foreground/90 wrap-anywhere">{run.verdict.summary}</p>
          <BotFindings verdict={run.verdict} />
        </>
      ) : run.result ? (
        // Without a verdict to read, the reply is the evidence. A decoded one's reply stays in
        // the run sheet.
        <RawReply run={run} />
      ) : null}
      <p className="text-xs tabular-nums text-muted-foreground">{facts.join(" · ")}</p>
    </div>
  );
}

/**
 * One item of the queue, whatever its kind: who (the bot's tile, name and inputs), why (a reason
 * word with its mark and one line of evidence) and the one thing to do next. Compact rows, for the
 * band, keep only that verb.
 */
function TriageRow({
  item,
  density,
  ctx,
}: {
  readonly item: TriageItem;
  readonly density: "full" | "compact";
  readonly ctx: TriageContext;
}) {
  const nav = useBotsNavigation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<TriageBusy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [choosingModel, setChoosingModel] = useState(false);
  const retry = useAtomCommand(bots.retry, { reportFailure: false });
  const resume = useAtomCommand(bots.resumePipelineRun, { reportFailure: false });
  const promote = useAtomCommand(bots.promote, { reportFailure: false });
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const dismissal = useDismissal(ctx.environmentId, ctx.onSettled);
  const { copyToClipboard } = useCopyToClipboard({
    target: "error",
    onCopy: () => toastManager.add({ type: "success", title: "Copied the error" }),
  });
  const { environmentId, access } = ctx;
  const run = item.run;
  const runId = triageRunId(item);
  const definition = ctx.definitions?.find((entry) => entry.id === item.botId) ?? null;
  const botState = triageBotState(item.botId, ctx.definitions);
  const verb = triageVerb(item, { dismissed: ctx.dismissed, botState });
  const tone = triageTone(item);
  const ReasonIcon = REASON_ICONS[item.reason];
  const full = density === "full";
  const inputs = run ? triageInputSummary(run.inputs) : "";
  const title = ctx.showBot || run === null ? item.botName : inputs || "No inputs";
  const subtitle = ctx.showBot ? inputs : "";
  const evidence =
    item.kind === "waiting"
      ? item.thread.waitingSince
        ? `Waiting ${waitingAgeLabel(item.thread.waitingSince, ctx.now) ?? "a while"}`
        : `Last activity ${waitingAgeLabel(item.thread.updatedAt, ctx.now) ?? "a while"} ago`
      : triageEvidence(item);
  const facts = run
    ? [
        item.kind === "run" ? runTime(item.at, ctx.now) : null,
        run.ranOn ? `on ${run.ranOn.label}` : null,
        run.retryOf ? "a retry" : null,
        run.triggerId
          ? "from a trigger"
          : run.batchId
            ? "from a batch"
            : run.startedBy === "agent"
              ? "started by an agent"
              : null,
        ctx.dismissed && run.dismissedAt ? `dismissed ${runTime(run.dismissedAt, ctx.now)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const expandable =
    full && item.kind === "run" && Boolean(item.run.error || item.run.verdict || item.run.result);
  const canDismissHere =
    full && !ctx.dismissed && item.kind === "run" && isTerminalBotRunStatus(item.run.status);

  const perform = async (kind: TriageBusy, work: () => Promise<string | null>) => {
    setBusy(kind);
    setError(null);
    const failed = await work().catch((cause: unknown) =>
      failureMessage(cause, "Something went wrong."),
    );
    setError(failed);
    setBusy(null);
  };

  const doRetry = () =>
    void perform("retry", async () => {
      if (item.kind !== "run") return null;
      const result = await retry({ environmentId, input: { runId: item.run.id } });
      if (result._tag === "Failure")
        return failureMessage(squashAtomCommandFailure(result), "Could not retry the run.");
      rememberRuns([result.value]);
      announceRetry(nav, item.botName, result.value);
      return null;
    });

  const doResume = () =>
    void perform("resume", async () => {
      const pipelineRunId = run?.pipelineRunId;
      if (!pipelineRunId) return null;
      const result = await resume({ environmentId, input: { pipelineRunId } });
      if (result._tag === "Failure")
        return failureMessage(squashAtomCommandFailure(result), "Could not resume the pipeline.");
      toastManager.add({
        type: "success",
        title: `Resumed ${result.value.pipelineName}`,
        actionProps: {
          children: "Open pipeline run",
          onClick: () => nav.open({ pipelineRun: pipelineRunId }),
        },
      });
      return null;
    });

  const doRestore = () =>
    void perform("restore", async () => (runId ? dismissal.restore([runId]) : null));

  const doDismiss = () =>
    void perform("dismiss", async () =>
      runId ? dismissal.dismiss([runId], `the ${item.botName} run`) : null,
    );

  const doPromote = () =>
    void perform("promote", async () => {
      if (item.kind !== "run") return null;
      const result = await promote({ environmentId, input: { runId: item.run.id } });
      if (result._tag === "Failure")
        return failureMessage(
          squashAtomCommandFailure(result),
          "Could not open the run as a thread.",
        );
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
      return null;
    });

  const doCancel = () =>
    void perform("cancel", async () => {
      if (runId === null) return null;
      const result = await cancel({ environmentId, input: { runId } });
      return result._tag === "Failure"
        ? failureMessage(squashAtomCommandFailure(result), "Could not cancel the run.")
        : null;
    });

  const act = (next: ActingVerb) => {
    if (next === "retry") doRetry();
    else if (next === "resume") doResume();
    else doRestore();
  };

  return (
    <li
      className={cn(
        LIBRARY_ROW,
        "grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]",
        busy !== null && "opacity-60",
      )}
    >
      <TriageTile botId={item.botId} botState={botState} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="min-w-0 truncate font-medium">{title}</span>
          {subtitle ? (
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{subtitle}</span>
          ) : null}
          {botState === "active" ? null : (
            <LibraryStateBadge tone="neutral">
              {botState === "deleted" ? "Bot deleted" : "Bot archived"}
            </LibraryStateBadge>
          )}
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs">
          <ReasonIcon aria-hidden className={cn("size-3.5 shrink-0", TONE_INK[tone])} />
          <span className="shrink-0 font-medium">{triageReasonLabel(item.reason)}</span>
          {evidence ? (
            <span className="min-w-0 truncate text-foreground/75">{evidence}</span>
          ) : null}
          {full && facts ? (
            <span className="hidden shrink-0 tabular-nums text-muted-foreground sm:inline">
              · {facts}
            </span>
          ) : null}
        </p>
      </div>
      <div className="col-start-2 flex items-center gap-0.5 sm:col-start-auto">
        <VerbButton
          verb={verb}
          item={item}
          busy={busy}
          access={access}
          onAct={act}
          onReview={() => {
            if (runId !== null) nav.overlay({ runId });
          }}
        />
        {canDismissHere ? (
          <IconAction
            label={busy === "dismiss" ? "Dismissing…" : "Dismiss"}
            reason={blockedReason(access.canDismiss, access.connected)}
            disabled={busy !== null}
            onClick={doDismiss}
          >
            <ArchiveIcon />
          </IconAction>
        ) : null}
        {expandable ? (
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-expanded={open}
            aria-label={open ? "Hide why" : "Show why"}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDownIcon
              className={cn("transition-transform duration-200", open && "rotate-180")}
            />
          </Button>
        ) : null}
        {full ? (
          <TriageMenu
            item={item}
            verb={verb}
            botState={botState}
            busy={busy}
            ctx={ctx}
            onRetry={doRetry}
            onChooseModel={() => setChoosingModel(true)}
            onPromote={doPromote}
            onCancel={doCancel}
            onCopyError={() => {
              if (run?.error) copyToClipboard(run.error);
            }}
          />
        ) : null}
      </div>
      {open && expandable && item.kind === "run" ? (
        <TriageDetail run={item.run} definition={definition} />
      ) : null}
      {error ? (
        <p role="alert" className="col-span-full ps-11 text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
      {choosingModel && item.kind === "run" ? (
        <RetryOnModelDialog
          environmentId={environmentId}
          run={item.run}
          bot={definition}
          onClose={() => setChoosingModel(false)}
          onRetried={(next) => {
            setChoosingModel(false);
            rememberRuns([next]);
            announceRetry(nav, item.botName, next);
          }}
        />
      ) : null}
    </li>
  );
}

/** A bot's repeats in one group: its newest leads, the rest open under it on demand. */
function TriageFold({ entry, ctx }: { readonly entry: TriageEntry; readonly ctx: TriageContext }) {
  const [open, setOpen] = useState(false);
  const all = [entry.lead, ...entry.rest];
  return (
    <>
      <TriageRow item={entry.lead} density="full" ctx={ctx} />
      <li className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2.5 ps-11">
          <Button
            shape="pill"
            size="xs"
            variant="ghost-muted"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronRightIcon
              className={cn("transition-transform duration-150", open && "rotate-90")}
            />
            {open
              ? `Hide ${entry.rest.length} earlier`
              : `${entry.rest.length} earlier from ${entry.lead.botName}`}
          </Button>
          <TickStrip
            label={`${all.length} runs from ${entry.lead.botName}, oldest first`}
            ticks={all.toReversed().map((item) => ({ key: item.key, tone: triageTone(item) }))}
          />
        </div>
        {open ? (
          <ul
            aria-label={`Earlier from ${entry.lead.botName}`}
            className="flex flex-col gap-0.5 ps-11"
          >
            {entry.rest.map((item) => (
              <TriageRow key={item.key} item={item} density="full" ctx={ctx} />
            ))}
          </ul>
        ) : null}
      </li>
    </>
  );
}

function TriageGroupSection({
  section,
  ctx,
}: {
  readonly section: TriageSection;
  readonly ctx: TriageContext;
}) {
  const dismissal = useDismissal(ctx.environmentId, ctx.onSettled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = GROUPS[section.group];
  const ids = ctx.dismissed ? [] : dismissibleRunIds(section.items);
  const reason = blockedReason(ctx.access.canDismiss, ctx.access.connected);
  const dismissAll = async () => {
    setBusy(true);
    setError(null);
    setError(await dismissal.dismiss(ids, "these runs"));
    setBusy(false);
  };
  return (
    <section aria-label={copy.title} className="flex min-w-0 flex-col gap-1.5">
      <LibraryGroupHeading
        title={copy.title}
        count={section.items.length}
        hint={ctx.dismissed ? DISMISSED_HINT : copy.hint}
        marker={<LibraryStateDot tone={copy.tone} />}
        action={
          ids.length > 1 ? (
            <Guard reason={reason}>
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                aria-label={`Dismiss these ${ids.length} runs`}
                disabled={reason !== null || busy}
                onClick={() => void dismissAll()}
              >
                <CheckCheckIcon />
                {busy ? "Dismissing…" : `Dismiss ${ids.length}`}
              </Button>
            </Guard>
          ) : null
        }
      />
      <ul aria-label={copy.title} className="flex flex-col gap-0.5">
        {foldRepeats(section).map((entry) =>
          entry.rest.length > 0 ? (
            <TriageFold key={entry.lead.key} entry={entry} ctx={ctx} />
          ) : (
            <TriageRow key={entry.lead.key} item={entry.lead} density="full" ctx={ctx} />
          ),
        )}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-destructive-foreground">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const SKELETON_ROWS = ["first", "second", "third"] as const;

function TriageSkeleton() {
  return (
    <div role="status" aria-label="Loading runs that need you" className="flex flex-col gap-1.5">
      <Skeleton className="h-3.5 w-40" />
      <div className="flex flex-col gap-0.5">
        {SKELETON_ROWS.map((key) => (
          <div
            key={key}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2"
          >
            <Skeleton shape="card" className="size-8" />
            <div className="flex min-w-0 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <Skeleton shape="pill" className="h-6 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The calm end state: one line, not a box shouting that nothing is wrong. */
function TriageClear({
  tone,
  title,
  children,
  action,
}: {
  readonly tone: "success" | "neutral";
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className={cn(LIBRARY_OUTLINE, "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5")}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-lg",
          tone === "success"
            ? "bg-success/12 text-success-foreground"
            : "bg-muted text-muted-foreground dark:bg-accent",
        )}
      >
        {tone === "success" ? (
          <CheckCheckIcon className="size-4" />
        ) : (
          <ArchiveIcon className="size-4" />
        )}
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
      {action}
    </div>
  );
}

function BotFilterMenu({
  options,
  value,
  onChange,
}: {
  readonly options: readonly TriageBotCount[];
  readonly value: string | null;
  readonly onChange: (botId: string | null) => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
        <ListFilterIcon />
        By bot
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        <MenuRadioGroup
          value={value ?? "all"}
          onValueChange={(next) =>
            onChange(options.find((option) => option.botId === next)?.botId ?? null)
          }
        >
          <MenuRadioItem value="all">Every bot</MenuRadioItem>
          {options.map((option) => (
            <MenuRadioItem key={option.botId} value={option.botId}>
              <span className="flex w-full min-w-0 items-center gap-2">
                <ProjectColorDot color={botColor({ id: option.botId })} className="size-2.5" />
                <span className="min-w-0 flex-1 truncate">{option.botName}</span>
                <span className="ps-4 text-xs tabular-nums text-muted-foreground">
                  {option.count}
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

interface Paging {
  /** The first page these older pages were loaded behind; a refetch of it starts paging over. */
  readonly stamp: string;
  /** Older pages already behind the one in flight. */
  readonly earlier: readonly BotRun[];
  readonly before: string | null;
}

const NO_PAGING: Paging = { stamp: "", earlier: [], before: null };

/**
 * The whole queue of what needs a person, for the Runs view's Needs you and Dismissed scopes:
 * grouped by why, most urgent first, each item ending in the one thing to do next.
 */
export function NeedsYouView({
  bot,
  dismissed,
  toolbarEnd,
}: {
  readonly bot: BotDefinition | null;
  readonly dismissed: boolean;
  /** The Runs scope switch, kept on this view's one toolbar row. */
  readonly toolbarEnd?: ReactNode | undefined;
}) {
  const nav = useBotsNavigation();
  const minute = useNowMinute();
  const sources = useTriageSources(bot, dismissed);
  const { host, environmentId, inboxLive, changes, first } = sources;
  const access = useTriageAccess(environmentId, host.connected);
  const [paging, setPaging] = useState<Paging>(NO_PAGING);
  // The Runs log's bot filter, so narrowing to a bot holds across scopes, reloads and Back.
  const botFilter = bot === null ? (nav.search.runBot ?? null) : null;
  const setBotFilter = (next: string | null) =>
    nav.show({ ...botsPageOf(nav.search), runBot: next ?? undefined });
  const stamp = `${dismissed}:${first.dataUpdatedAt}`;
  const current = paging.stamp === stamp ? paging : NO_PAGING;
  const older = useEnvironmentQuery(
    environmentId && inboxLive && current.before !== null
      ? bots.inbox({
          environmentId,
          input: { ...inboxQueryInput(dismissed), before: current.before },
        })
      : null,
  );
  // The dismissed total spans every bot, so a bot's page does not show it.
  const countQuery = useEnvironmentQuery(
    environmentId && inboxLive && !dismissed && !bot
      ? bots.inbox({ environmentId, input: DISMISSED_COUNT_INPUT })
      : null,
  );
  const refresh = () => {
    first.refresh();
    countQuery.refresh();
  };
  useRefreshOnReconnect(host.connected, refresh);
  useRefreshWhenBotsChangesPruned(changes, refresh);
  useEffect(() => {
    if (older.data) rememberRuns(older.data.runs);
  }, [older.data]);

  if (environmentId === null) return null;

  const page = first.data
    ? applyInboxChanges(
        combineTriagePages(first.data, current.earlier, {
          before: current.before,
          page: older.data,
        }),
        changes,
        { dismissed },
      )
    : null;
  const items = triageItems({
    runs: page?.runs ?? [],
    waiting: sources.waiting,
    findRun: sources.findRun,
    bot,
  });
  const counts = bot ? [] : triageBotCounts(items);
  const filterName =
    botFilter === null
      ? null
      : (counts.find((entry) => entry.botId === botFilter)?.botName ??
        sources.definitions?.find((entry) => entry.id === botFilter)?.name ??
        "this bot");
  const options =
    botFilter === null || counts.some((entry) => entry.botId === botFilter)
      ? counts
      : [...counts, { botId: botFilter, botName: filterName ?? "this bot", count: 0 }];
  const shown = botFilter === null ? items : items.filter((item) => item.botId === botFilter);
  const sections = groupTriage(shown);
  const dismissedCount = bot
    ? null
    : dismissed
      ? (page?.total ?? null)
      : countQuery.data
        ? applyInboxChanges(countQuery.data, changes, { dismissed: true }).total
        : null;
  const waitingFirst = inboxLive && page === null && !first.error;
  const loading = waitingFirst && host.connected;
  const loadingOlder = current.before !== null && older.data === null && !older.error;
  const ctx: TriageContext = {
    environmentId,
    access,
    definitions: sources.definitions,
    now: Date.parse(`${minute}:00Z`),
    dismissed,
    showBot: bot === null,
    onSettled: countQuery.refresh,
  };

  const loadMore = () => {
    if (!first.data) return;
    const earlier =
      current.before === null ? [] : [...current.earlier, ...(older.data?.runs ?? [])];
    const before = olderCursor([...first.data.runs, ...earlier]);
    if (before !== null) setPaging({ stamp, earlier, before });
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-h-8 flex-wrap items-center gap-2">
        {options.length > 1 || botFilter !== null ? (
          <BotFilterMenu options={options} value={botFilter} onChange={setBotFilter} />
        ) : null}
        {botFilter !== null ? (
          <LibraryFilterChip
            label={filterName}
            removeLabel={`Stop showing only ${filterName}`}
            marker={<ProjectColorDot color={botColor({ id: botFilter })} />}
            onRemove={() => setBotFilter(null)}
          />
        ) : null}
        {inboxLive ? (
          <Toggle
            shape="pill"
            size="sm"
            variant="outline"
            pressed={dismissed}
            onPressedChange={(pressed) =>
              nav.show({ ...botsPageOf(nav.search), scope: pressed ? "dismissed" : "attention" })
            }
          >
            <ArchiveIcon />
            Show dismissed
            {dismissedCount === null ? null : (
              <span className="tabular-nums opacity-60">({dismissedCount})</span>
            )}
          </Toggle>
        ) : null}
        {host.connected ? null : (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudOffIcon aria-hidden className="size-3.5" />
            Offline, so these may be out of date
          </span>
        )}
        {toolbarEnd ? <div className="ms-auto flex items-center gap-1.5">{toolbarEnd}</div> : null}
      </div>
      {inboxLive ? null : (
        <LibraryNotice icon={InfoIcon}>
          This server does not list failed or undecided runs. Update it to triage them here; runs
          waiting on you still show.
        </LibraryNotice>
      )}
      {waitingFirst && !host.connected ? (
        <LibraryNotice icon={CloudOffIcon}>Reconnect to load the runs that need you.</LibraryNotice>
      ) : null}
      <LibraryErrorNotice error={first.error} onRetry={first.refresh} />
      {sections.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-7">
          {sections.map((section) => (
            <TriageGroupSection key={section.group} section={section} ctx={ctx} />
          ))}
        </div>
      ) : null}
      {loading ? <TriageSkeleton /> : null}
      {sections.length === 0 && (page !== null || !inboxLive) ? (
        page?.hasMore ? (
          // Older pages may hold this bot's runs, so the newest page alone cannot say none do.
          <TriageClear
            tone="neutral"
            title={`Nothing from ${filterName ?? bot?.name ?? "here"} yet`}
          >
            None of the newest {page.runs.length} runs that need someone are its. Load more to look
            further back.
          </TriageClear>
        ) : botFilter !== null ? (
          <TriageClear
            tone="success"
            title={`Nothing from ${filterName} needs you`}
            action={
              <Button shape="pill" size="sm" variant="outline" onClick={() => setBotFilter(null)}>
                Show every bot
              </Button>
            }
          >
            Other bots still have runs here.
          </TriageClear>
        ) : dismissed ? (
          <TriageClear tone="neutral" title="No dismissed runs">
            Runs you dismiss wait here, so you can bring one back.
          </TriageClear>
        ) : (
          <TriageClear
            tone="success"
            title={bot ? `Nothing from ${bot.name} needs you` : "Nothing needs you"}
          >
            Runs that fail, time out, cannot decide or stop to ask you something show up here.
          </TriageClear>
        )
      ) : null}
      {page?.hasMore ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={loadingOlder || !host.connected}
            onClick={loadMore}
          >
            {loadingOlder ? "Loading…" : "Load more"}
          </Button>
          <span className="text-xs tabular-nums text-muted-foreground">
            {bot || botFilter !== null
              ? `Looked through ${page.runs.length} of ${page.total} across every bot`
              : `${page.runs.length} of ${page.total} loaded`}
          </span>
        </div>
      ) : null}
      <LibraryErrorNotice error={older.error} onRetry={older.refresh} />
    </div>
  );
}

/**
 * The head of the queue, leading the Bots index or a bot's overview. It renders nothing while
 * nothing needs a person, and never a skeleton: waiting threads show at once, failed runs join
 * when the inbox arrives.
 */
export function NeedsYouBand({ bot }: { readonly bot: BotDefinition | null }) {
  const minute = useNowMinute();
  const sources = useTriageSources(bot, false);
  const { environmentId, first, changes } = sources;
  const access = useTriageAccess(environmentId, sources.host.connected);
  const page = first.data ? applyInboxChanges(first.data, changes, { dismissed: false }) : null;
  const items = orderTriage(
    triageItems({
      runs: page?.runs ?? [],
      waiting: sources.waiting,
      findRun: sources.findRun,
      bot,
    }),
  );
  if (environmentId === null || (items.length === 0 && !first.error)) return null;
  const waiting = items.filter((item) => item.kind === "waiting").length;
  const total = bot ? items.length : (page?.total ?? 0) + waiting;
  const ctx: TriageContext = {
    environmentId,
    access,
    definitions: sources.definitions,
    now: Date.parse(`${minute}:00Z`),
    dismissed: false,
    showBot: bot === null,
    onSettled: () => {},
  };
  return (
    <LibrarySection
      title="Needs you"
      icon={HandIcon}
      count={total}
      action={
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          render={
            <Link
              to="/loom/bots"
              search={
                bot
                  ? { bot: bot.id, tab: "runs", scope: "attention" }
                  : { tab: "runs", scope: "attention" }
              }
              // A change of view, like the tabs, so Back leaves Bots rather than reopening this.
              replace
            />
          }
        >
          Review all
          <ArrowRightIcon />
        </Button>
      }
    >
      <LibraryErrorNotice error={first.error} onRetry={first.refresh} />
      {items.length > 0 ? (
        <ul aria-label="Needs you" className="flex flex-col gap-0.5">
          {items.slice(0, BAND_ROWS).map((item) => (
            <TriageRow key={item.key} item={item} density="compact" ctx={ctx} />
          ))}
        </ul>
      ) : null}
    </LibrarySection>
  );
}
