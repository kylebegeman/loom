import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ModelSelection } from "@t3tools/contracts";
import {
  BOTS_RUN_DETAILS_FEATURE,
  isBotInboxRun,
  isTerminalBotRunStatus,
  type BotDefinition,
  type BotId,
  type BotRun,
  type BotTriggerId,
} from "@t3tools/contracts/fork";
import { canRetryBotRun, isBotTriageRun, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArchiveIcon,
  ArrowUpRightIcon,
  CloudOffIcon,
  CopyIcon,
  EllipsisIcon,
  LinkIcon,
  LockIcon,
  MessageSquareIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  TriangleAlertIcon,
  UndoIcon,
  XIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibrarySpecSheet,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { useLibraryPermission } from "../project-library/state";
import { BotFindings, RunReply } from "./BotFindings";
import { BotTile } from "./BotIdentity";
import { BotModelPicker } from "./BotModelPicker";
import { BotRunFeedback } from "./BotRunFeedback";
import { BotRunForm } from "./BotRunForm";
import { botsPageOf, useBotsNavigation } from "./navigation";
import {
  knownRun,
  rememberRuns,
  runInputSummary,
  runOrigin,
  runOutcome,
  runsListInput,
} from "./runLog";
import {
  elapsedLabel,
  formatDuration,
  runDurationLabel,
  runQueuedMs,
  runTokensLabel,
} from "./runMetrics";
import { bots, useBots, useBotsAccess, useBotsHost } from "./state";

/** The run sheet (`runId`) and the Run dialog (`run`), over whichever page is open. */
export function RunsOverlays() {
  const nav = useBotsNavigation();
  const { runId, run: runBotId } = nav.search;
  // "Run again" hands its run to the dialog it opens. It lasts while that dialog is open, so the
  // next Run from anywhere else starts from the bot's defaults.
  const [again, setAgain] = useState<BotRun | null>(null);
  const [openFor, setOpenFor] = useState(runBotId);
  if (openFor !== runBotId) {
    setOpenFor(runBotId);
    if (runBotId === undefined && again !== null) setAgain(null);
  }
  return (
    <>
      {runId ? (
        <RunSheet
          key={runId}
          runId={runId}
          onRunAgain={(run) => {
            setAgain(run);
            nav.overlay({ run: run.botId });
          }}
        />
      ) : null}
      {runBotId ? (
        <RunDialog
          key={runBotId}
          botId={runBotId}
          from={again !== null && again.botId === runBotId ? again : null}
        />
      ) : null}
    </>
  );
}

function RunDialog({ botId, from }: { readonly botId: BotId; readonly from: BotRun | null }) {
  const nav = useBotsNavigation();
  const { host, list, bots: definitions } = useBots();
  const bot = definitions.find((definition) => definition.id === botId);
  if (host.environmentId === null) return null;
  if (bot === undefined) {
    // Wait for the list before calling a bot missing, or a deep link flashes the notice.
    if (list.data === null && !list.error) return null;
    return (
      <LibraryDialog
        open
        onOpenChange={(open) => {
          if (!open) nav.close();
        }}
        title="This bot is gone"
        description="It was deleted, or the link points at a bot this server does not have."
        actions={
          <Button shape="pill" variant="ghost" onClick={nav.close}>
            Close
          </Button>
        }
      >
        <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
      </LibraryDialog>
    );
  }
  return (
    <BotRunForm
      environmentId={host.environmentId}
      bot={bot}
      from={from}
      onClose={nav.close}
      onStarted={(run) => {
        rememberRuns([run]);
        nav.overlay({ runId: run.id });
      }}
      onRunOnMany={host.batchesSupported ? () => nav.overlay({ many: bot.id }) : undefined}
    />
  );
}

/**
 * One run, wherever it was opened from: the run lists know most runs already, and the server is
 * asked only for one outside them.
 */
function RunSheet({
  runId,
  onRunAgain,
}: {
  readonly runId: BotRun["id"];
  readonly onRunAgain: (run: BotRun) => void;
}) {
  const nav = useBotsNavigation();
  const { host, live, changes, bots: definitions } = useBots();
  const environmentId = live ? host.environmentId : null;
  const lookupSupported = supportsLoomFeature(
    host.environment?.serverConfig?.environment.capabilities,
    BOTS_RUN_DETAILS_FEATURE,
  );
  const local = changes.runs.get(runId) ?? knownRun(runId);
  const lookup = useEnvironmentQuery(
    environmentId && local === null && lookupSupported
      ? bots.getRun({ environmentId, input: { runId } })
      : null,
  );
  // An older server cannot look a run up, so the shared recent list is the only place to find it.
  const recent = useEnvironmentQuery(
    environmentId && local === null && !lookupSupported
      ? bots.listRuns({ environmentId, input: runsListInput({}) })
      : null,
  );
  const run =
    local ??
    lookup.data?.run ??
    recent.data?.runs.find((candidate) => candidate.id === runId) ??
    null;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) nav.close();
      }}
    >
      <SheetPopup side="right" size="wide">
        {run !== null && environmentId !== null ? (
          <RunDetail
            environmentId={environmentId}
            run={run}
            bot={definitions.find((definition) => definition.id === run.botId) ?? null}
            onRunAgain={onRunAgain}
          />
        ) : lookup.error || recent.error ? (
          <RunSheetMessage title="Could not load this run" onClose={nav.close}>
            <LibraryErrorNotice
              error={lookup.error ?? recent.error}
              onRetry={lookup.error ? lookup.refresh : recent.refresh}
            />
          </RunSheetMessage>
        ) : lookup.data?.run === null ? (
          <RunSheetMessage title="This run is gone" onClose={nav.close}>
            <p className="text-sm text-muted-foreground">
              It was deleted with its bot, or the link points at a run this server never had.
            </p>
          </RunSheetMessage>
        ) : recent.data && !lookupSupported ? (
          <RunSheetMessage title="This run is out of reach" onClose={nav.close}>
            <p className="text-sm text-muted-foreground">
              It is older than the recent runs this server lists. Update Loom on the server to open
              any run.
            </p>
          </RunSheetMessage>
        ) : (
          <RunSheetSkeleton />
        )}
      </SheetPopup>
    </Sheet>
  );
}

function RunSheetMessage({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <>
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
      </SheetHeader>
      <SheetPanel>{children}</SheetPanel>
      <SheetFooter>
        <Button shape="pill" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </SheetFooter>
    </>
  );
}

function RunSheetSkeleton() {
  return (
    <div role="status" aria-label="Loading the run" className="flex flex-col gap-6 p-6">
      <div className="sr-only">
        <SheetTitle>Loading the run</SheetTitle>
      </div>
      <div className="flex items-center gap-3">
        <Skeleton shape="card" className="size-8" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3.5 w-3/4" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

const WHEN = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const when = (value: string | null) => {
  const at = value === null ? Number.NaN : Date.parse(value);
  return Number.isFinite(at) ? WHEN.format(at) : null;
};

const TEXT_LINK =
  "rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const ORIGIN_SENTENCES = {
  batch: "A batch",
  pipeline: "A pipeline",
  replay: "A replay",
  trigger: "A trigger",
  retry: "A retry",
  agent: "An agent",
  person: "You",
} as const;

type RunAction = "cancel" | "retry" | "promote" | "dismiss" | "restore";

function RunDetail({
  environmentId,
  run,
  bot,
  onRunAgain,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly bot: BotDefinition | null;
  readonly onRunAgain: (run: BotRun) => void;
}) {
  const nav = useBotsNavigation();
  const navigate = useNavigate();
  const host = useBotsHost();
  const access = useBotsAccess();
  const canPromote = useLibraryPermission(bots.promote, environmentId) && host.connected;
  const now = Date.parse(`${useNowMinute()}:00Z`);
  const projects = useProjects();
  const threads = useThreadShells(
    Boolean(run.callerThreadId || run.checkoutThreadId || run.promotedThreadId),
  );
  const cancel = useAtomCommand(bots.cancel, { reportFailure: false });
  const retry = useAtomCommand(bots.retry, { reportFailure: false });
  const promote = useAtomCommand(bots.promote, { reportFailure: false });
  const dismiss = useAtomCommand(bots.dismiss, { reportFailure: false });
  const [pending, setPending] = useState<RunAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosingModel, setChoosingModel] = useState(false);
  const { copyToClipboard: copyId } = useCopyToClipboard({
    target: "run ID",
    onCopy: () => toastManager.add({ type: "success", title: "Copied the run ID" }),
  });
  const { copyToClipboard: copyLink } = useCopyToClipboard({
    target: "run link",
    onCopy: () => toastManager.add({ type: "success", title: "Copied a link to this run" }),
  });

  const outcome = runOutcome(run);
  const active = !isTerminalBotRunStatus(run.status);
  const page = botsPageOf(nav.search);
  const origin = runOrigin(run);
  // A remote run's thread lives on the computer that ran it.
  const threadEnvironmentId = run.ranOn?.environmentId ?? environmentId;
  const project = projects.find(
    (candidate) => candidate.id === run.projectId && candidate.environmentId === environmentId,
  );
  const threadTitle = (threadId: string | null | undefined) =>
    threadId ? threads.find((thread) => thread.id === threadId)?.title : undefined;
  const inInbox = host.inboxSupported && isBotInboxRun(run);
  // The Dismissed list's own test, so every run it lists can be restored from here.
  const restorable = host.inboxSupported && isBotTriageRun(run, true);
  // Retry and continuing in a thread arrived with Needs you; older servers have neither.
  const retryable = host.inboxSupported && canRetryBotRun(run);
  // The server forks the run's thread where it runs, which a remote run's is not.
  const promotable = host.inboxSupported && !active && !run.ranOn;
  const runnable = bot !== null && bot.archivedAt === null && !active;
  const queued = runQueuedMs(run);
  const parameterLabel = (name: string) =>
    bot?.parameters.find((parameter) => parameter.name === name)?.label ?? name;
  const inputs = Object.entries(run.inputs);

  const perform = async (action: RunAction, work: () => Promise<string | null>) => {
    if (pending) return;
    setPending(action);
    setError(null);
    try {
      setError(await work());
    } finally {
      setPending(null);
    }
  };
  const failure = (result: Parameters<typeof squashAtomCommandFailure>[0], fallback: string) => {
    const cause = squashAtomCommandFailure(result);
    return cause instanceof Error && cause.message ? cause.message : fallback;
  };
  const doCancel = () =>
    void perform("cancel", async () => {
      const result = await cancel({ environmentId, input: { runId: run.id } });
      return result._tag === "Failure" ? failure(result, "Could not cancel the run.") : null;
    });
  const doRetry = () =>
    void perform("retry", async () => {
      const result = await retry({ environmentId, input: { runId: run.id } });
      if (result._tag === "Failure") return failure(result, "Could not retry the run.");
      rememberRuns([result.value]);
      nav.overlay({ runId: result.value.id });
      return null;
    });
  const doPromote = () =>
    void perform("promote", async () => {
      const result = await promote({ environmentId, input: { runId: run.id } });
      if (result._tag === "Failure")
        return failure(result, "Could not continue the run in a thread.");
      await navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId: result.value.threadId },
      });
      return null;
    });
  const doDismiss = (dismissed: boolean) =>
    void perform(dismissed ? "dismiss" : "restore", async () => {
      const result = await dismiss({ environmentId, input: { runIds: [run.id], dismissed } });
      if (result._tag === "Failure")
        return failure(
          result,
          dismissed ? "Could not dismiss the run." : "Could not restore the run.",
        );
      toastManager.add({
        type: "success",
        title: dismissed ? `Dismissed the ${run.botName} run` : `Back in Needs you`,
      });
      return null;
    });

  const facts = [
    { label: "Model", value: run.modelSelection?.model ?? "Not recorded" },
    { label: "Tokens", value: active ? "Counted when it ends" : runTokensLabel(run) },
    {
      label: "Duration",
      value: active
        ? `${run.status === "queued" ? "Waiting" : "Running"} for ${elapsedLabel(run.startedAt ?? run.createdAt, now) ?? "a moment"}`
        : runDurationLabel(run),
    },
    ...(queued !== null && queued >= 1000
      ? [{ label: "Waited to start", value: formatDuration(queued) }]
      : []),
    { label: "Started by", value: ORIGIN_SENTENCES[origin.kind] },
    ...(run.requestedBy ? [{ label: "Asked for by", value: run.requestedBy.label }] : []),
    ...(run.ranOn ? [{ label: "Ran on", value: run.ranOn.label }] : []),
    {
      label: "Version",
      value:
        bot !== null && bot.version !== run.botVersion
          ? `v${run.botVersion} (bot is now v${bot.version})`
          : `v${run.botVersion}`,
    },
    ...(project ? [{ label: "Project", value: project.title }] : []),
    ...(run.checkoutThreadId
      ? [{ label: "Checkout of", value: threadTitle(run.checkoutThreadId) ?? "A thread" }]
      : []),
    { label: "Started", value: when(run.startedAt) ?? `Asked for ${when(run.createdAt) ?? ""}` },
    ...(run.finishedAt ? [{ label: "Finished", value: when(run.finishedAt) }] : []),
  ];
  const related = [
    ...(run.batchId
      ? [
          {
            label: "Batch",
            value: (
              <Link
                to="/loom/bots"
                // From a bot's page, so the batch page leads back to that bot's batches.
                search={{ batch: run.batchId, ...(page.bot ? { bot: page.bot } : {}) }}
                className={TEXT_LINK}
              >
                Open batch
              </Link>
            ),
          },
        ]
      : []),
    ...(run.pipelineRunId
      ? [
          {
            label: "Pipeline",
            value: (
              <Link
                to="/loom/bots"
                search={{ pipelineRun: run.pipelineRunId }}
                className={TEXT_LINK}
              >
                Open pipeline run
              </Link>
            ),
          },
        ]
      : []),
    ...(run.replayId
      ? [
          {
            label: "Replay",
            value: (
              <Link
                to="/loom/bots"
                search={{ ...page, replay: run.replayId }}
                replace
                className={TEXT_LINK}
              >
                Open replay
              </Link>
            ),
          },
        ]
      : []),
    ...(run.triggerId && host.triggersSupported
      ? [
          {
            label: "Trigger",
            value: (
              <Link
                to="/loom/bots"
                search={{ ...page, trigger: run.triggerId as BotTriggerId }}
                replace
                className={TEXT_LINK}
              >
                Open trigger
              </Link>
            ),
          },
        ]
      : []),
    ...(run.retryOf
      ? [
          {
            label: "Retry of",
            value: (
              <Link
                to="/loom/bots"
                search={{ ...page, runId: run.retryOf }}
                replace
                className={TEXT_LINK}
              >
                Open the earlier run
              </Link>
            ),
          },
        ]
      : []),
    ...(run.retriedBy
      ? [
          {
            label: "Retried by",
            value: (
              <Link
                to="/loom/bots"
                search={{ ...page, runId: run.retriedBy }}
                replace
                className={TEXT_LINK}
              >
                Open the retry
              </Link>
            ),
          },
        ]
      : []),
    // A run asked for by another computer was called from a thread over there.
    ...(run.callerThreadId && !run.requestedBy
      ? [
          {
            label: run.notify ? "Called from, replies to" : "Called from",
            value: (
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: run.callerThreadId }}
                className={TEXT_LINK}
              >
                {threadTitle(run.callerThreadId) ?? "Open thread"}
              </Link>
            ),
          },
        ]
      : []),
    ...(run.promotedThreadId
      ? [
          {
            label: "Continued in",
            value: (
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: run.promotedThreadId }}
                className={TEXT_LINK}
              >
                {threadTitle(run.promotedThreadId) ?? "Open thread"}
              </Link>
            ),
          },
        ]
      : []),
  ];

  const blocked = !host.connected
    ? { icon: CloudOffIcon, text: "Offline. Reconnect to act on this run." }
    : active && !access.canCancel
      ? { icon: LockIcon, text: "This connection cannot cancel runs." }
      : !active && retryable && !access.canRetry
        ? { icon: LockIcon, text: "This connection cannot retry runs." }
        : !active && !retryable && runnable && !access.canRun
          ? { icon: LockIcon, text: "This connection cannot run bots." }
          : !active && bot === null
            ? { icon: ArchiveIcon, text: `${run.botName} was deleted, so it cannot run again.` }
            : !active && bot !== null && bot.archivedAt !== null
              ? { icon: ArchiveIcon, text: `${bot.name} is archived. Restore it to run it again.` }
              : null;
  const showFeedback =
    !active &&
    host.versionsSupported &&
    (access.canRate || run.rating != null || Boolean(run.note));
  const retryPrimary = retryable && !active;
  const runActions = retryable || promotable || inInbox || restorable;

  return (
    <>
      <SheetHeader>
        <div className="flex min-w-0 items-center gap-3 pe-8">
          <BotTile bot={{ id: run.botId }} size="lg" />
          <div className="flex min-w-0 flex-col gap-1">
            <SheetTitle>
              <span className="block truncate">
                {bot ? (
                  <Link to="/loom/bots" search={{ bot: run.botId }} className={TEXT_LINK}>
                    {run.botName}
                  </Link>
                ) : (
                  run.botName
                )}
              </span>
            </SheetTitle>
            <SheetDescription>
              <span className="block truncate tabular-nums">
                {[
                  active
                    ? `Started ${when(run.startedAt ?? run.createdAt) ?? ""}`
                    : when(run.finishedAt ?? run.startedAt ?? run.createdAt),
                  active ? null : runDurationLabel(run),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </SheetDescription>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <LibraryStateBadge tone={outcome.tone}>{outcome.label}</LibraryStateBadge>
          {inInbox ? <LibraryStateBadge tone="warning">In Needs you</LibraryStateBadge> : null}
          {run.dismissedAt != null ? (
            <LibraryStateBadge tone="neutral">Dismissed</LibraryStateBadge>
          ) : null}
          {run.retriedBy ? <LibraryStateBadge tone="neutral">Retried</LibraryStateBadge> : null}
        </div>
      </SheetHeader>
      <SheetPanel>
        <div className="flex min-w-0 flex-col gap-6">
          {run.verdict?.summary ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
              {run.verdict.summary}
            </p>
          ) : null}
          {run.error ? <RunError error={run.error} /> : null}
          {run.pipelineStopped && run.pipelineRunId ? (
            <LibraryNotice
              icon={TriangleAlertIcon}
              tone="warning"
              action={
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  render={<Link to="/loom/bots" search={{ pipelineRun: run.pipelineRunId }} />}
                >
                  Open pipeline run
                </Button>
              }
            >
              This run stopped its pipeline. Resume or cancel the pipeline from its run.
            </LibraryNotice>
          ) : null}
          <RunSection title="Inputs">
            {inputs.length ? (
              <LibrarySpecSheet
                label="Inputs"
                rows={inputs.map(([name, value]) => ({
                  label: parameterLabel(name),
                  value: <span className="whitespace-pre-wrap">{String(value)}</span>,
                }))}
              />
            ) : (
              <p className="text-xs text-muted-foreground">{run.botName} took no inputs.</p>
            )}
          </RunSection>
          {run.verdict && (run.verdict.findings.length || run.verdict.findingsTruncated) ? (
            <RunSection title="Findings" count={run.verdict.findings.length}>
              <BotFindings verdict={run.verdict} />
            </RunSection>
          ) : null}
          <RunReply
            run={run}
            defaultOpen={!run.verdict?.summary || run.verdict.source === "invalid"}
          />
          {showFeedback ? (
            <RunSection title="Feedback">
              <BotRunFeedback environmentId={environmentId} run={run} canRate={access.canRate} />
            </RunSection>
          ) : null}
          <RunSection title="Details">
            <LibrarySpecSheet label="Details" rows={facts} />
          </RunSection>
          {related.length ? (
            <RunSection title="Related">
              <LibrarySpecSheet label="Related" rows={related} />
            </RunSection>
          ) : null}
        </div>
      </SheetPanel>
      <SheetFooter>
        <div className="flex min-w-0 flex-col gap-2 sm:me-auto sm:flex-row sm:items-center">
          <Menu>
            <MenuTrigger
              render={
                <Button shape="pill" size="icon" variant="ghost" aria-label="More for this run" />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup side="top" align="start">
              {runActions ? (
                <>
                  <MenuGroup>
                    {retryable ? (
                      <MenuItem
                        disabled={!access.canRetry || pending !== null}
                        onClick={() => setChoosingModel(true)}
                      >
                        <RotateCcwIcon />
                        Retry on another model…
                      </MenuItem>
                    ) : null}
                    {promotable ? (
                      <MenuItem disabled={!canPromote || pending !== null} onClick={doPromote}>
                        <MessageSquareIcon />
                        {run.promotedThreadId ? "Open continued thread" : "Continue in a thread"}
                      </MenuItem>
                    ) : null}
                    {inInbox ? (
                      <MenuItem
                        disabled={!access.canDismiss || pending !== null}
                        onClick={() => doDismiss(true)}
                      >
                        <XIcon />
                        Dismiss from Needs you
                      </MenuItem>
                    ) : null}
                    {restorable ? (
                      <MenuItem
                        disabled={!access.canDismiss || pending !== null}
                        onClick={() => doDismiss(false)}
                      >
                        <UndoIcon />
                        Restore to Needs you
                      </MenuItem>
                    ) : null}
                  </MenuGroup>
                  <MenuSeparator />
                </>
              ) : null}
              <MenuGroup>
                <MenuItem onClick={() => copyLink(window.location.href)}>
                  <LinkIcon />
                  Copy link
                </MenuItem>
                <MenuItem onClick={() => copyId(run.id)}>
                  <CopyIcon />
                  Copy run ID
                </MenuItem>
              </MenuGroup>
            </MenuPopup>
          </Menu>
          {error ? (
            <p role="alert" className="text-xs text-destructive-foreground">
              {error}
            </p>
          ) : blocked ? (
            <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <blocked.icon aria-hidden className="size-3.5 shrink-0" />
              {blocked.text}
            </p>
          ) : null}
        </div>
        {active ? (
          <Button
            shape="pill"
            variant="destructive-outline"
            disabled={!access.canCancel || pending !== null}
            onClick={doCancel}
          >
            <SquareIcon />
            {pending === "cancel" ? "Cancelling…" : "Cancel run"}
          </Button>
        ) : null}
        {run.status === "queued" ? null : (
          <Button
            shape="pill"
            variant="outline"
            render={
              <Link
                to="/$environmentId/$threadId"
                params={{ environmentId: threadEnvironmentId, threadId: run.threadId }}
              />
            }
          >
            <ArrowUpRightIcon />
            Open thread
          </Button>
        )}
        {runnable ? (
          <Button
            shape="pill"
            variant={retryPrimary ? "outline" : "default"}
            disabled={!access.canRun || pending !== null}
            onClick={() => onRunAgain(run)}
          >
            <PlayIcon />
            Run again
          </Button>
        ) : null}
        {retryPrimary ? (
          <Button shape="pill" disabled={!access.canRetry || pending !== null} onClick={doRetry}>
            <RotateCcwIcon />
            {pending === "retry" ? "Retrying…" : "Retry"}
          </Button>
        ) : null}
      </SheetFooter>
      {choosingModel ? (
        <RetryOnModelDialog
          environmentId={environmentId}
          run={run}
          bot={bot}
          onClose={() => setChoosingModel(false)}
          onRetried={(next) => {
            setChoosingModel(false);
            rememberRuns([next]);
            nav.overlay({ runId: next.id });
          }}
        />
      ) : null}
    </>
  );
}

function RunSection({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count?: number;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
        {title}
        {count ? (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
        ) : null}
      </h3>
      {children}
    </section>
  );
}

// A stack trace can run to hundreds of lines; the first few say what went wrong.
const LONG_ERROR_LINES = 6;
const LONG_ERROR_CHARS = 480;

function RunError({ error }: { readonly error: string }) {
  const [open, setOpen] = useState(false);
  const long = error.length > LONG_ERROR_CHARS || error.split("\n").length > LONG_ERROR_LINES;
  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl bg-destructive/8 px-3.5 py-3">
      <p
        className={cn(
          "font-mono text-xs leading-relaxed whitespace-pre-wrap text-destructive-foreground wrap-anywhere",
          long && !open && "line-clamp-6",
        )}
      >
        {error}
      </p>
      {long ? (
        <Button
          shape="pill"
          size="micro"
          variant="ghost-muted"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show the whole error"}
        </Button>
      ) : null}
    </div>
  );
}

const sameModel = (left: ModelSelection, right: ModelSelection) =>
  left.instanceId === right.instanceId && left.model === right.model;

/** Runs a run again on another model, for comparing; the bot keeps its own. */
export function RetryOnModelDialog({
  environmentId,
  run,
  bot,
  onClose,
  onRetried,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotRun;
  readonly bot: BotDefinition | null;
  readonly onClose: () => void;
  readonly onRetried: (run: BotRun) => void;
}) {
  // A plain retry runs the bot as saved now, so that is the model this one differs from.
  const current = bot?.modelSelection ?? run.modelSelection ?? null;
  const [model, setModel] = useState<ModelSelection | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = useAtomCommand(bots.retry, { reportFailure: false });
  const { canRetry } = useBotsAccess();
  const { connected } = useBotsHost();
  const unchanged = model === null || (current !== null && sameModel(model, current));
  const inputs = runInputSummary(run);

  const submit = async () => {
    if (model === null || busy) return;
    setBusy(true);
    setError(null);
    const result = await retry({ environmentId, input: { runId: run.id, modelSelection: model } });
    setBusy(false);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error && cause.message ? cause.message : "Could not retry the run.",
      );
      return;
    }
    onRetried(result.value);
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="Retry on another model"
      description={`Runs ${run.botName} again with the same inputs on the model you pick. The bot keeps its own model.`}
      actions={
        <>
          <Button shape="pill" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button
            shape="pill"
            disabled={!canRetry || busy || unchanged}
            onClick={() => void submit()}
          >
            <RotateCcwIcon />
            {busy ? "Retrying…" : model && !unchanged ? `Retry on ${model.model}` : "Retry"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className={cn(LIBRARY_OUTLINE, "flex min-w-0 items-center gap-3 px-3 py-2.5")}>
          <BotTile bot={{ id: run.botId }} />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{run.botName}</p>
            <p className="truncate text-xs text-muted-foreground">{inputs || "No inputs"}</p>
          </div>
        </div>
        <LibraryField label="Model">
          <BotModelPicker environmentId={environmentId} value={model} onChange={setModel} />
        </LibraryField>
        <p className="text-xs text-muted-foreground">
          {run.modelSelection ? `This run used ${run.modelSelection.model}. ` : null}
          {current
            ? unchanged
              ? `A plain retry already uses ${current.model}; pick another to compare.`
              : `Only this retry uses ${model?.model ?? "it"}.`
            : null}
          {canRetry
            ? null
            : connected
              ? " This connection cannot retry runs."
              : " Reconnect to retry it."}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
      </div>
    </LibraryDialog>
  );
}
