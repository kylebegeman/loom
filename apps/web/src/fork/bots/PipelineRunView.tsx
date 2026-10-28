import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  BOTS_MAX_ACTIVE_PIPELINES,
  isActiveBotPipelineRunStatus,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineAttempt,
  type BotPipelineId,
  type BotPipelineRun,
  type BotPipelineRunDetail,
} from "@t3tools/contracts/fork";
import {
  applyPipelineAttemptChanges,
  initialRunValues,
  needsProject,
  runInputs,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArrowUpRightIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  FileTextIcon,
  FolderIcon,
  InfoIcon,
  LayersIcon,
  LockIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
  TextCursorInputIcon,
  WorkflowIcon,
} from "lucide-react";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "~/components/ui/collapsible";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryHero, LibraryVital, LibraryVitals } from "../project-library/LibraryCollection";
import {
  LibraryDialog,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibraryPanel,
  LibrarySection,
  LibrarySpecSheet,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { TickStrip } from "../project-library/LibraryData";
import { useLibraryPermission } from "../project-library/state";
import { BotTile, VerdictChip, runDuration, runTime } from "./BotIdentity";
import {
  PIPELINES_TAB,
  PipelineChain,
  PipelineRunStateBadge,
  PipelineTile,
  WithReason,
  actionReason,
  pipelineColorStyle,
  plural,
  usePipelineRuns,
} from "./BotPipelines";
import { ParameterField } from "./BotRunForm";
import { useBotsNavigation } from "./navigation";
import {
  attemptState,
  highestRound,
  runSteps,
  type AttemptTone,
  type RunStep,
} from "./pipelineDraft";
import { runInputErrors, runValuesFrom } from "./runForm";
import {
  bots,
  useBotPipelineChanges,
  useBots,
  useBotsAccess,
  useBotsHost,
  usePipelines,
  useRefreshOnReconnect,
} from "./state";

const tickTone = (tone: AttemptTone): LibraryWorkflowTone =>
  tone === "waiting" ? "neutral" : tone;

const failureText = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

const isNotFound = (failure: unknown) =>
  typeof failure === "object" &&
  failure !== null &&
  "reason" in failure &&
  failure.reason === "not_found";

/**
 * Inputs for "Run again", handed from a run's page to the run form. The URL names only the
 * pipeline, and a run's inputs can be long text that does not belong in it.
 */
const rerunSeeds = new Map<
  string,
  { readonly values: Record<string, string>; readonly projectId: string }
>();

/** Refetches the run when a step moves on, since the report is built from the attempts. */
function useRefetchOnProgress(progress: string, refresh: () => void) {
  const seen = useRef(progress);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the run from the server when its watched progress changes
  useEffect(() => {
    if (seen.current === progress) return;
    const first = seen.current === "";
    seen.current = progress;
    if (!first) refresh();
  }, [progress, refresh]);
}

/** One pipeline run as its own page: where it stands, each step's attempts and the report. */
export function PipelineRunPage({ runId }: { readonly runId: string }) {
  const { environmentId } = useBotsHost();
  return environmentId ? <RunDetail environmentId={environmentId} runId={runId} /> : null;
}

function RunDetail({
  environmentId,
  runId,
}: {
  readonly environmentId: EnvironmentId;
  readonly runId: string;
}) {
  const host = useBotsHost();
  const { list: pipelineList, pipelines } = usePipelines(environmentId, true, host.connected);
  const changes = useBotPipelineChanges(environmentId, host.connected);
  const query = useEnvironmentQuery(
    bots.getPipelineRun({ environmentId, input: { pipelineRunId: runId } }),
  );
  useRefreshOnReconnect(host.connected, query.refresh);
  const applied = query.data ? applyPipelineAttemptChanges(query.data, changes) : null;
  useRefetchOnProgress(
    applied === null
      ? ""
      : `${applied.run.status}:${applied.attempts.map((attempt) => `${attempt.seq}${attempt.state}`).join(",")}`,
    query.refresh,
  );
  // Only a loaded list can say the run's pipeline is gone; until then it may still be coming.
  const pipelinesLoaded = pipelineList.data !== null;
  const pipeline =
    applied === null
      ? undefined
      : pipelines.find((candidate) => candidate.id === applied.run.pipelineId);
  // Offline, the list may never arrive, so the run shows without claiming anything about it.
  const pipelinesSettled = pipelinesLoaded || pipelineList.error !== null || !host.connected;

  if (query.data === null || applied === null || (!query.error && !pipelinesSettled)) {
    if (query.error && isNotFound(query.failure))
      return (
        <LibraryEmpty
          icon={WorkflowIcon}
          title="This run no longer exists"
          action={
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              render={<Link to="/loom/bots" search={PIPELINES_TAB} />}
            >
              Back to pipelines
            </Button>
          }
        >
          Old runs are cleared over time, or the link names a run this computer never had.
        </LibraryEmpty>
      );
    if (query.error) return <LibraryErrorNotice error={query.error} onRetry={query.refresh} />;
    return (
      <div role="status" aria-label="Loading the pipeline run" className="flex flex-col gap-8">
        <Skeleton shape="card" className="h-44 w-full" />
        <div className="flex max-w-3xl flex-col gap-3">
          {["first", "second", "third"].map((key) => (
            <Skeleton key={key} shape="card" className="h-14 w-full" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <RunOverview
      environmentId={environmentId}
      run={applied.run}
      attempts={applied.attempts}
      report={query.data.report}
      pipeline={pipeline}
      pipelinesLoaded={pipelinesLoaded}
      pipelinesNotice={
        pipelinesLoaded ? null : (
          <LibraryErrorNotice error={pipelineList.error} onRetry={pipelineList.refresh} />
        )
      }
    />
  );
}

function RunOverview({
  environmentId,
  run,
  attempts,
  report,
  pipeline,
  pipelinesLoaded,
  pipelinesNotice,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: BotPipelineRun;
  readonly attempts: ReadonlyArray<BotPipelineAttempt>;
  readonly report: BotPipelineRunDetail["report"];
  /** The pipeline as saved now; undefined once deleted, or while the list could not load. */
  readonly pipeline: BotPipeline | undefined;
  /** Whether the pipeline list loaded, so an undefined pipeline means it was deleted. */
  readonly pipelinesLoaded: boolean;
  /** Why the pipeline list could not load, with a retry. */
  readonly pipelinesNotice: ReactNode;
}) {
  const nav = useBotsNavigation();
  const { host, bots: allBots } = useBots();
  const access = useBotsAccess();
  const canCancel = useLibraryPermission(bots.cancelPipelineRun, environmentId) && host.connected;
  const canResume = useLibraryPermission(bots.resumePipelineRun, environmentId) && host.connected;
  const cancel = useAtomCommand(bots.cancelPipelineRun, { reportFailure: false });
  const resume = useAtomCommand(bots.resumePipelineRun, { reportFailure: false });
  // The status an action was taken from. The watch can bring the new status after the reply, so
  // the buttons stay off until the status moves, rather than offering the same action twice.
  const [actedFrom, setActedFrom] = useState<BotPipelineRun["status"] | null>(null);
  if (actedFrom !== null && actedFrom !== run.status) setActedFrom(null);
  const busy = actedFrom !== null;
  const [error, setError] = useState<string | null>(null);
  const project = useProjects().find(
    (candidate) => candidate.environmentId === environmentId && candidate.id === run.projectId,
  );

  const botsById = useMemo(() => new Map(allBots.map((bot) => [bot.id, bot])), [allBots]);
  const { steps, exact } = runSteps(run, attempts, pipeline);
  const active = isActiveBotPipelineRunStatus(run.status);
  const resumable = run.status === "stopped" || run.status === "failed";
  const done = steps.filter((step) => {
    const latest = step.attempts.at(-1);
    return latest !== undefined && (latest.state === "done" || latest.state === "skipped");
  }).length;
  const rounds = highestRound(attempts);
  const took = run.finishedAt === null ? null : runDuration(run.createdAt, run.finishedAt);

  const stop = async () => {
    if (
      !(await ensureLocalApi().dialogs.confirm(
        `Cancel this run of ${run.pipelineName}? The step running now is cancelled too.`,
        { variant: "destructive" },
      ))
    )
      return;
    setActedFrom(run.status);
    setError(null);
    const result = await cancel({ environmentId, input: { pipelineRunId: run.id } });
    if (result._tag === "Failure") {
      setActedFrom(null);
      setError(failureText(squashAtomCommandFailure(result), "Could not cancel the run."));
    }
  };
  const pickUp = async () => {
    setActedFrom(run.status);
    setError(null);
    const result = await resume({ environmentId, input: { pipelineRunId: run.id } });
    if (result._tag === "Failure") {
      setActedFrom(null);
      setError(failureText(squashAtomCommandFailure(result), "Could not resume the run."));
    }
  };
  const runAgain = (target: BotPipeline) => {
    rerunSeeds.set(target.id, {
      values: runValuesFrom(target, run.inputs).values,
      projectId: run.projectId ?? "",
    });
    nav.overlay({ runPipeline: target.id });
  };

  const runReason = actionReason(host.connected, access.canRunPipelines, "run pipelines");
  const stepTicks = steps.map((step) => {
    const latest = step.attempts.at(-1);
    return {
      key: step.stepId,
      tone: latest === undefined ? null : tickTone(attemptState(latest).tone),
      label: `${step.stepId}: ${latest === undefined ? "Not reached" : attemptState(latest).label}`,
    };
  });

  return (
    <div style={pipelineColorStyle(run.pipelineId)} className="flex flex-col gap-10">
      <LibraryHero
        tile={<PipelineTile pipelineId={run.pipelineId} size="2xl" />}
        title={run.pipelineName}
        meta={
          <>
            <PipelineRunStateBadge run={run} />
            <span>Run {runTime(run.createdAt)}</span>
            <span>v{run.pipelineVersion}</span>
            {run.startedBy === "agent" ? <span>Started by an agent</span> : null}
            {project ? <span>In {project.title}</span> : null}
          </>
        }
        actions={
          <>
            {active ? (
              <WithReason reason={actionReason(host.connected, canCancel, "cancel runs")}>
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  disabled={!canCancel || busy}
                  onClick={() => void stop()}
                >
                  <SquareIcon />
                  Cancel run
                </Button>
              </WithReason>
            ) : null}
            {resumable ? (
              <WithReason reason={actionReason(host.connected, canResume, "resume runs")}>
                <Button
                  shape="pill"
                  size="sm"
                  disabled={!canResume || busy}
                  onClick={() => void pickUp()}
                >
                  <PlayIcon />
                  {run.cursorStepId ? `Resume at ${run.cursorStepId}` : "Resume"}
                </Button>
              </WithReason>
            ) : null}
            {pipeline !== undefined && !active ? (
              <WithReason reason={runReason}>
                <Button
                  shape="pill"
                  size="sm"
                  variant={resumable ? "outline" : "default"}
                  disabled={!access.canRunPipelines}
                  onClick={() => runAgain(pipeline)}
                >
                  <RotateCcwIcon />
                  Run again
                </Button>
              </WithReason>
            ) : null}
          </>
        }
        footer={
          <LibraryVitals>
            <LibraryVital label="Steps">
              <span className="inline-flex items-center gap-2">
                {stepTicks.length ? (
                  <TickStrip ticks={stepTicks} label={`${done} of ${steps.length} steps done`} />
                ) : null}
                <span className="tabular-nums">
                  {done} of {steps.length} done
                </span>
              </span>
            </LibraryVital>
            {run.finalVerdict !== null ? (
              <LibraryVital label="Verdict">
                <VerdictChip verdict={run.finalVerdict} />
              </LibraryVital>
            ) : null}
            {rounds > 1 ? <LibraryVital label="Rounds">{rounds}</LibraryVital> : null}
            <LibraryVital label={took === null ? "Started" : "Took"}>
              {took ?? runTime(run.createdAt)}
            </LibraryVital>
            {run.status === "waiting" && run.retryAt !== null ? (
              <LibraryVital label="Tries again">{runTime(run.retryAt)}</LibraryVital>
            ) : null}
          </LibraryVitals>
        }
      />

      {run.error !== null || run.stoppedRunId !== null ? (
        <LibraryNotice
          icon={CircleAlertIcon}
          tone={run.status === "failed" ? "danger" : "warning"}
          action={
            run.stoppedRunId !== null ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                onClick={() => {
                  if (run.stoppedRunId !== null) nav.overlay({ runId: run.stoppedRunId });
                }}
              >
                Open the run that stopped it
              </Button>
            ) : undefined
          }
        >
          {run.error ?? `It stopped at ${run.cursorStepId ?? "a step"}.`}
        </LibraryNotice>
      ) : null}
      {pipelinesNotice}
      <LibraryErrorNotice error={error} />

      <div className="grid items-start gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <LibrarySection title="Steps" icon={WorkflowIcon} count={steps.length || undefined}>
            {steps.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {active ? "Starting its first step…" : "It ended before any step ran."}
              </p>
            ) : (
              <ol aria-label="Steps" className="flex flex-col">
                {steps.map((step, index) => (
                  <RunStepRow
                    key={step.stepId}
                    step={step}
                    number={index + 1}
                    last={index === steps.length - 1}
                    bot={step.botId === null ? undefined : botsById.get(step.botId)}
                    active={active}
                    loops={rounds > 1}
                    onOpenRun={(runId) => nav.overlay({ runId })}
                  />
                ))}
              </ol>
            )}
            {exact ? null : (
              <p className="text-xs text-muted-foreground">
                This run used v{run.pipelineVersion}
                {pipeline !== undefined
                  ? `, and the pipeline is now v${pipeline.version}`
                  : pipelinesLoaded
                    ? ", and the pipeline has since been deleted"
                    : ""}
                , so this lists the steps it reached.
              </p>
            )}
          </LibrarySection>
          <LibrarySection title="Report" icon={FileTextIcon}>
            {active ? (
              <ReportSoFar markdown={report.markdown} />
            ) : report.markdown.trim() ? (
              <div className="min-w-0 text-sm">
                <ChatMarkdown text={report.markdown} cwd={undefined} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">It left no report.</p>
            )}
            {report.truncated ? (
              <p className="text-xs text-muted-foreground">The report was cut to its size limit.</p>
            ) : null}
          </LibrarySection>
        </div>
        <aside aria-label="Run details" className="flex min-w-0 flex-col gap-4">
          <LibraryPanel
            title="Inputs"
            icon={TextCursorInputIcon}
            count={Object.keys(run.inputs).length || undefined}
          >
            <div className="px-3 pb-2">
              {Object.keys(run.inputs).length ? (
                <LibrarySpecSheet
                  label="Inputs"
                  rows={Object.entries(run.inputs).map(([name, value]) => ({
                    label:
                      pipeline?.parameters.find((parameter) => parameter.name === name)?.label ??
                      name,
                    value: (
                      <span className="line-clamp-4 wrap-anywhere whitespace-pre-wrap">
                        {String(value)}
                      </span>
                    ),
                  }))}
                />
              ) : (
                <p className="pb-1 text-xs text-muted-foreground">It ran with no inputs.</p>
              )}
            </div>
          </LibraryPanel>
          <LibraryPanel title="Context" icon={InfoIcon}>
            <div className="px-3 pb-2">
              <LibrarySpecSheet
                label="Context"
                rows={[
                  {
                    label: "Pipeline",
                    value:
                      pipeline === undefined && pipelinesLoaded ? (
                        `${run.pipelineName}, deleted`
                      ) : (
                        <Link
                          to="/loom/bots"
                          search={{ pipeline: run.pipelineId }}
                          className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        >
                          {pipeline?.name ?? run.pipelineName}
                        </Link>
                      ),
                  },
                  { label: "Version", value: `v${run.pipelineVersion}` },
                  {
                    label: "Project",
                    value: project ? (
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <FolderIcon aria-hidden className="size-3.5 shrink-0" />
                        <span className="truncate">{project.title}</span>
                      </span>
                    ) : run.projectId === null ? (
                      "None"
                    ) : (
                      "Not on this computer"
                    ),
                  },
                  {
                    label: "Started by",
                    value: run.startedBy === "agent" ? "An agent" : "A person",
                  },
                  ...(run.callerThreadId !== null
                    ? [
                        {
                          label: "From",
                          value: (
                            <ThreadLink environmentId={environmentId} threadId={run.callerThreadId}>
                              Open the thread
                            </ThreadLink>
                          ),
                        },
                      ]
                    : []),
                  ...(run.checkoutThreadId !== null
                    ? [
                        {
                          label: "Checkout",
                          value: (
                            <ThreadLink
                              environmentId={environmentId}
                              threadId={run.checkoutThreadId}
                            >
                              A thread's checkout
                            </ThreadLink>
                          ),
                        },
                      ]
                    : []),
                  { label: "Started", value: new Date(run.createdAt).toLocaleString() },
                  ...(run.finishedAt !== null
                    ? [{ label: "Ended", value: new Date(run.finishedAt).toLocaleString() }]
                    : []),
                ]}
              />
            </div>
          </LibraryPanel>
        </aside>
      </div>
    </div>
  );
}

function ThreadLink({
  environmentId,
  threadId,
  children,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: string;
  readonly children: ReactNode;
}) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId, threadId }}
      className="inline-flex items-center gap-1 rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      {children}
      <ArrowUpRightIcon aria-hidden className="size-3" />
    </Link>
  );
}

/** The report while the run goes on, folded away since it grows with every step. */
function ReportSoFar({ markdown }: { readonly markdown: string }) {
  const [open, setOpen] = useState(false);
  if (!markdown.trim())
    return <p className="text-sm text-muted-foreground">It fills in as steps finish.</p>;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <ChevronRightIcon
          aria-hidden
          className={cn("size-4 transition-transform duration-150", open && "rotate-90")}
        />
        Report so far
      </CollapsibleTrigger>
      <CollapsiblePanel>
        {open ? (
          <div className="min-w-0 pt-3 text-sm">
            <ChatMarkdown text={markdown} cwd={undefined} />
          </div>
        ) : null}
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** A step's marker on the rail: its bot's tile when the step is known, its place otherwise. */
function StepMarker({
  botId,
  number,
  tone,
}: {
  readonly botId: string | null;
  readonly number: number;
  readonly tone: LibraryWorkflowTone | null;
}) {
  const status = tone ? <LibraryStateDot tone={tone} /> : null;
  if (botId !== null) return <BotTile bot={{ id: botId }} size="md" status={status} />;
  return (
    <span className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-medium text-muted-foreground tabular-nums dark:bg-accent">
      {number}
      {status ? (
        <span className="absolute -end-0.5 -bottom-0.5 inline-flex rounded-full bg-background p-0.5">
          {status}
        </span>
      ) : null}
    </span>
  );
}

function RunStepRow({
  step,
  number,
  last,
  bot,
  active,
  loops,
  onOpenRun,
}: {
  readonly step: RunStep;
  readonly number: number;
  readonly last: boolean;
  readonly bot: BotDefinition | undefined;
  readonly active: boolean;
  /** Whether the run went round a loop, so each attempt names its round. */
  readonly loops: boolean;
  readonly onOpenRun: (runId: string) => void;
}) {
  const latest = step.attempts.at(-1);
  const state = latest === undefined ? null : attemptState(latest);
  const reached = latest !== undefined;
  return (
    <li className="flex min-w-0 gap-3">
      <div className="flex shrink-0 flex-col items-center gap-1">
        <span className={cn("inline-flex", !reached && "opacity-60")}>
          <StepMarker
            botId={step.botId}
            number={number}
            tone={state === null ? null : tickTone(state.tone)}
          />
        </span>
        {last ? null : <span aria-hidden className="w-px flex-1 bg-border" />}
      </div>
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", last ? "pb-1" : "pb-6")}>
        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-1.5",
            !reached && "opacity-60",
          )}
        >
          <span className="text-xs text-muted-foreground tabular-nums">{number}</span>
          <span className="min-w-0 truncate font-mono text-sm font-medium">{step.stepId}</span>
          {bot ? <span className="truncate text-sm text-muted-foreground">{bot.name}</span> : null}
          {state === null ? (
            <span className="text-xs text-muted-foreground">
              {active ? "Not reached yet" : "Not reached"}
            </span>
          ) : step.attempts.length === 1 ? null : (
            <LibraryStateBadge tone={tickTone(state.tone)}>{state.label}</LibraryStateBadge>
          )}
        </div>
        {step.attempts.length ? (
          <ul className="flex flex-col gap-2">
            {step.attempts.map((attempt, index) => (
              <AttemptRow
                key={attempt.seq}
                attempt={attempt}
                label={
                  step.attempts.length === 1
                    ? null
                    : loops
                      ? `Round ${attempt.round}`
                      : `Try ${index + 1}`
                }
                onOpenRun={onOpenRun}
              />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function AttemptRow({
  attempt,
  label,
  onOpenRun,
}: {
  readonly attempt: BotPipelineAttempt;
  /** Names the attempt when the step ran more than once. */
  readonly label: string | null;
  readonly onOpenRun: (runId: string) => void;
}) {
  const state = attemptState(attempt);
  const duration =
    attempt.startedAt !== null && attempt.finishedAt !== null
      ? runDuration(attempt.startedAt, attempt.finishedAt)
      : null;
  const runId = attempt.runId;
  const batchId = attempt.batchId;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {label ? <span className="text-xs font-medium text-muted-foreground">{label}</span> : null}
        <LibraryStateBadge tone={tickTone(state.tone)}>{state.label}</LibraryStateBadge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {[
            duration,
            attempt.botVersion === null ? null : `bot v${attempt.botVersion}`,
            attempt.startedAt === null ? null : runTime(attempt.startedAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        <span className="ms-auto flex flex-wrap gap-0.5">
          {batchId !== null ? (
            <Button
              shape="pill"
              size="xs"
              variant="ghost"
              render={<Link to="/loom/bots" search={{ batch: batchId }} />}
            >
              <LayersIcon />
              Open batch
            </Button>
          ) : null}
          {runId !== null ? (
            <Button shape="pill" size="xs" variant="ghost" onClick={() => onOpenRun(runId)}>
              <ArrowUpRightIcon />
              Open run
            </Button>
          ) : null}
        </span>
      </div>
      {attempt.outcome?.summary ? (
        <p className="line-clamp-3 text-sm text-foreground/90">{attempt.outcome.summary}</p>
      ) : null}
      {attempt.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </li>
  );
}

/** The pipeline run form (`?runPipeline`), over whichever page is open. */
export function PipelinesOverlays() {
  const nav = useBotsNavigation();
  const { environmentId } = useBotsHost();
  const pipelineId = nav.search.runPipeline;
  if (pipelineId === undefined || environmentId === null) return null;
  return (
    <RunPipelineOverlay key={pipelineId} environmentId={environmentId} pipelineId={pipelineId} />
  );
}

function RunPipelineOverlay({
  environmentId,
  pipelineId,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineId: BotPipelineId;
}) {
  const nav = useBotsNavigation();
  const host = useBotsHost();
  const { list, pipelines } = usePipelines(environmentId, host.pipelinesSupported, host.connected);
  const pipeline = pipelines.find((candidate) => candidate.id === pipelineId);
  const close = () => nav.close();
  if (pipeline !== undefined)
    return <RunPipelineDialog environmentId={environmentId} pipeline={pipeline} onClose={close} />;
  const closeOnly = (
    <Button shape="pill" variant="ghost" onClick={close}>
      Close
    </Button>
  );
  if (host.pipelinesSupported && !list.data && !list.error)
    return (
      <LibraryDialog
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        title="Run pipeline"
        description="Loading the pipeline…"
        actions={closeOnly}
      >
        <div role="status" aria-label="Loading the pipeline" className="flex flex-col gap-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton shape="card" className="h-9 w-full" />
        </div>
      </LibraryDialog>
    );
  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Pipeline not found"
      description={
        host.pipelinesSupported
          ? "There is nothing to run."
          : "This computer's server is too old to run pipelines."
      }
      actions={closeOnly}
    >
      {list.error && !list.data ? (
        <LibraryErrorNotice error={list.error} onRetry={list.refresh} />
      ) : (
        <LibraryNotice icon={WorkflowIcon}>
          {host.pipelinesSupported
            ? "It was deleted, or the link names a pipeline this computer never had."
            : "Update Loom on that computer to chain bots into pipelines."}
        </LibraryNotice>
      )}
    </LibraryDialog>
  );
}

function RunPipelineDialog({
  environmentId,
  pipeline,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
  readonly onClose: () => void;
}) {
  const nav = useBotsNavigation();
  const { host, bots: allBots, list: botList } = useBots();
  const access = useBotsAccess();
  const run = useAtomCommand(bots.runPipeline, { reportFailure: false });
  const { runs } = usePipelineRuns(environmentId, host.connected);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const botsById = useMemo(() => new Map(allBots.map((bot) => [bot.id, bot])), [allBots]);
  const botOf = (botId: string) => botsById.get(botId);
  const projectSteps = pipeline.steps.filter((step) => {
    const bot = botOf(step.botId);
    return bot !== undefined && needsProject(bot);
  });
  const pickProject = projectSteps.length > 0;

  const [seed] = useState(() => rerunSeeds.get(pipeline.id));
  const [values, setValues] = useState<Record<string, string>>(
    () => seed?.values ?? initialRunValues(pipeline),
  );
  const [projectId, setProjectId] = useState<string>(() => seed?.projectId ?? "");
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The seed served this form; a later Run from anywhere else starts from the defaults.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops this pipeline's module-level rerun seed once the form has consumed it
  useEffect(() => {
    rerunSeeds.delete(pipeline.id);
  }, [pipeline.id]);

  const chosenProject =
    projects.find((project) => project.id === projectId) ??
    (pickProject && projects.length === 1 ? projects[0] : undefined);
  const inputErrors = runInputErrors(pipeline.parameters, values);
  const unavailable = botList.data
    ? pipeline.steps.filter((step) => {
        const bot = botOf(step.botId);
        return bot === undefined || bot.archivedAt !== null;
      })
    : [];
  const activeRuns = runs.filter((candidate) =>
    isActiveBotPipelineRunStatus(candidate.status),
  ).length;
  const full = activeRuns >= BOTS_MAX_ACTIVE_PIPELINES;
  const runReason = actionReason(host.connected, access.canRunPipelines, "run pipelines");
  // Which steps need a project, and which bots are gone, both come from the bot list.
  const botsReason =
    botList.data !== null ? null : botList.error ? "The bots could not load." : "Loading bots…";
  const blocked =
    runReason !== null ||
    botsReason !== null ||
    full ||
    unavailable.length > 0 ||
    (pickProject && projects.length === 0);

  const submit = async () => {
    if (busy || blocked) return;
    if (Object.keys(inputErrors).length > 0 || (pickProject && chosenProject === undefined)) {
      setAttempted(true);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await run({
      environmentId,
      input: {
        pipelineId: pipeline.id,
        inputs: runInputs(pipeline, values),
        ...(pickProject && chosenProject !== undefined ? { projectId: chosenProject.id } : {}),
      },
    });
    setBusy(false);
    if (result._tag === "Success") {
      // Closing first replaces the form's entry, so Back from the run never reopens it.
      nav.close();
      nav.open({ pipelineRun: result.value.id });
      return;
    }
    const cause = squashAtomCommandFailure(result);
    setError(failureText(cause, `Could not run ${pipeline.name}.`));
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={seed ? `Run ${pipeline.name} again` : `Run ${pipeline.name}`}
      description={
        pipeline.description.trim() ||
        (pipeline.parameters.length ? "Fill in its inputs, then run it." : "Run it as saved.")
      }
      actions={
        <>
          <Button shape="pill" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <WithReason reason={runReason ?? botsReason}>
            <Button shape="pill" disabled={busy || blocked} onClick={() => void submit()}>
              <PlayIcon />
              {busy ? "Starting…" : "Run"}
            </Button>
          </WithReason>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div style={pipelineColorStyle(pipeline.id)} className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {plural(pipeline.steps.length, "step")}, in order
          </span>
          <PipelineChain steps={pipeline.steps} botName={(botId) => botOf(botId)?.name} />
        </div>
        {unavailable.length ? (
          <LibraryNotice
            icon={CircleAlertIcon}
            tone="warning"
            action={
              access.canSavePipelines ? (
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  render={<Link to="/loom/bots" search={{ editPipeline: pipeline.id }} />}
                >
                  <PencilIcon />
                  Edit
                </Button>
              ) : undefined
            }
          >
            {unavailable.map((step) => step.id).join(" and ")}{" "}
            {unavailable.length === 1 ? "runs a bot that is" : "run bots that are"} archived or
            gone. Edit the pipeline to choose another.
          </LibraryNotice>
        ) : null}
        {pipeline.parameters.map((parameter) => {
          const value = values[parameter.name] ?? "";
          const fieldError = inputErrors[parameter.name];
          return (
            <ParameterField
              key={parameter.name}
              parameter={parameter}
              value={value}
              error={attempted || value.trim() !== "" ? fieldError : null}
              onChange={(next) => setValues({ ...values, [parameter.name]: next })}
            />
          );
        })}
        {botList.data === null ? (
          botList.error ? (
            <LibraryErrorNotice error={botList.error} onRetry={botList.refresh} />
          ) : (
            <div role="status" aria-label="Loading bots" className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-16" />
              <Skeleton shape="card" className="h-8 w-full" />
            </div>
          )
        ) : pickProject ? (
          projects.length === 0 ? (
            <LibraryNotice icon={FolderIcon} tone="warning">
              A step runs in a project, and this computer has none yet. Add a project first.
            </LibraryNotice>
          ) : (
            <LibraryField label="Project">
              <Select
                value={chosenProject?.id ?? ""}
                onValueChange={(next) => setProjectId(next ?? "")}
              >
                <SelectTrigger
                  size="sm"
                  aria-invalid={attempted && chosenProject === undefined ? true : undefined}
                >
                  <SelectValue>{chosenProject?.title ?? "Choose a project…"}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id} label={project.title}>
                      <span className="block truncate">{project.title}</span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {attempted && chosenProject === undefined ? (
                <span className="text-xs font-normal text-destructive-foreground">
                  Choose where its steps run.
                </span>
              ) : (
                <span className="text-xs font-normal text-muted-foreground">
                  {projectSteps.map((step) => step.id).join(" and ")}{" "}
                  {projectSteps.length === 1 ? "works" : "work"} in this project.
                </span>
              )}
            </LibraryField>
          )
        ) : null}
        {full ? (
          <LibraryNotice icon={CircleAlertIcon} tone="warning">
            {activeRuns} pipeline runs are going already, the most at once. Run this when one
            finishes.
          </LibraryNotice>
        ) : null}
        {runReason !== null ? <LibraryNotice icon={LockIcon}>{runReason}</LibraryNotice> : null}
        <LibraryErrorNotice error={error} />
      </form>
    </LibraryDialog>
  );
}
