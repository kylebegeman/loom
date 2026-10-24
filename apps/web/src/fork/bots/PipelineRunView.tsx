import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import {
  botRunThreadId,
  isActiveBotPipelineRunStatus,
  type BotDefinition,
  type BotPipeline,
  type BotPipelineAttempt,
  type BotPipelineRun,
} from "@t3tools/contracts/fork";
import {
  applyPipelineAttemptChanges,
  BOT_PIPELINE_RUN_STATES,
  BOT_RUN_STATES,
  type BotPipelineChanges,
  type LibraryWorkflowTone,
  initialRunValues,
  needsProject,
  runInputs,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  ArrowUpRightIcon,
  LayersIcon,
  LockIcon,
  PlayIcon,
  SquareIcon,
  WorkflowIcon,
  XIcon,
} from "lucide-react";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LIBRARY_OUTLINE,
  LibraryDialog,
  LibraryErrorNotice,
  LibraryField,
  LibraryNotice,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { ProgressBar, type ProgressTone } from "./BotBatches";
import { BotTile, VerdictChip, runDuration, runTime } from "./BotIdentity";
import { ParameterField } from "./BotRunForm";
import { BotsEmptyList } from "./BotRuns";
import { bots } from "./state";

/** An attempt's state as one label and tone; how a finished run ended outranks "Done". */
const attemptState = (
  attempt: BotPipelineAttempt,
): { readonly label: string; readonly tone: ProgressTone } => {
  switch (attempt.state) {
    case "pending":
      return { label: "Waiting", tone: "waiting" };
    case "started":
      return { label: "Running", tone: "active" };
    case "skipped":
      return { label: "Skipped", tone: "neutral" };
    case "done": {
      const status = attempt.outcome?.status ?? "completed";
      if (status === "failed" || status === "timed_out" || status === "cancelled") {
        return BOT_RUN_STATES[status];
      }
      const verdict = attempt.outcome?.verdict;
      return {
        label: "Done",
        tone: verdict === "fail" ? "danger" : verdict === "needs_attention" ? "warning" : "success",
      };
    }
  }
};

/** Bots that run in a project need one, so a pipeline with such a step asks for it. */
const pipelineNeedsProject = (pipeline: BotPipeline, allBots: ReadonlyArray<BotDefinition>) =>
  pipeline.steps.some((step) => {
    const bot = allBots.find((candidate) => candidate.id === step.botId);
    return bot !== undefined && needsProject(bot);
  });

export function PipelineRunForm({
  environmentId,
  pipeline,
  allBots,
  canRun,
  onStarted,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipeline: BotPipeline;
  readonly allBots: ReadonlyArray<BotDefinition>;
  readonly canRun: boolean;
  readonly onStarted: (run: BotPipelineRun) => void;
  readonly onClose: () => void;
}) {
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && !project.isScratch,
  );
  const [values, setValues] = useState(() => initialRunValues(pipeline));
  const pickProject = pipelineNeedsProject(pipeline, allBots);
  const [projectId, setProjectId] = useState<string>(pickProject ? (projects[0]?.id ?? "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useAtomCommand(bots.runPipeline, { reportFailure: false });

  const submit = async () => {
    if (busy || !canRun) return;
    if (pickProject && projectId === "") {
      setError(`Choose a project to run ${pipeline.name} in.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await run({
        environmentId,
        input: {
          pipelineId: pipeline.id,
          inputs: runInputs(pipeline, values),
          ...(projectId === "" ? {} : { projectId: projectId as ProjectId }),
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      onStarted(result.value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not run ${pipeline.name}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <LibraryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={`Run ${pipeline.name}`}
      description={pipeline.description || "Fill in the inputs, then run."}
      actions={
        <>
          <Button shape="pill" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button shape="pill" disabled={busy || !canRun} onClick={() => void submit()}>
            <PlayIcon />
            {busy ? "Starting…" : "Run"}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PipelineSteps pipeline={pipeline} />
        {pipeline.parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">This pipeline takes no inputs.</p>
        ) : null}
        {pipeline.parameters.map((parameter) => (
          <ParameterField
            key={parameter.name}
            parameter={parameter}
            value={values[parameter.name] ?? ""}
            onChange={(value) => setValues((current) => ({ ...current, [parameter.name]: value }))}
          />
        ))}
        {pickProject ? (
          <LibraryField label="Project">
            <Select value={projectId} onValueChange={(next) => setProjectId(next ?? "")}>
              <SelectTrigger size="sm">
                <SelectValue>
                  {projects.find((project) => project.id === projectId)?.title ?? "Choose…"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id} label={project.title}>
                    <span className="block truncate">{project.title}</span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </LibraryField>
        ) : null}
        <LibraryErrorNotice error={error} />
        {!canRun ? (
          <LibraryNotice icon={LockIcon}>This connection cannot run pipelines.</LibraryNotice>
        ) : null}
      </form>
    </LibraryDialog>
  );
}

/**
 * A pipeline's steps in order, each its bot's tile and step id, joined by a neutral rule so the
 * sequence reads at a glance.
 */
export function PipelineSteps({ pipeline }: { readonly pipeline: Pick<BotPipeline, "steps"> }) {
  return (
    <ol aria-label="Steps" className="flex min-w-0 flex-wrap items-center gap-y-1.5">
      {pipeline.steps.map((step, index) => (
        <li key={step.id} className="flex min-w-0 items-center">
          {index === 0 ? null : <span aria-hidden className="mx-1.5 h-px w-3 bg-border" />}
          <span className="flex min-w-0 items-center gap-1.5">
            <BotTile bot={{ id: step.botId }} size="sm" />
            <span className="truncate font-mono text-xs text-muted-foreground">{step.id}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PipelineRunList({
  runs,
  selectedId,
  onSelect,
  emptyMessage,
}: {
  readonly runs: ReadonlyArray<BotPipelineRun>;
  readonly selectedId: string | undefined;
  readonly onSelect: (run: BotPipelineRun) => void;
  readonly emptyMessage: string;
}) {
  if (runs.length === 0) return <BotsEmptyList icon={WorkflowIcon} message={emptyMessage} />;
  return (
    <ul className={cn(LIBRARY_OUTLINE, "flex flex-col divide-y divide-border overflow-hidden")}>
      {runs.map((run) => {
        const state = BOT_PIPELINE_RUN_STATES[run.status];
        const active = isActiveBotPipelineRunStatus(run.status);
        const selected = run.id === selectedId;
        return (
          <li key={run.id}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(run)}
              className={cn(
                "flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                selected ? "bg-accent/70" : "hover:bg-accent/40",
              )}
            >
              <LibraryStateDot tone={state.tone} className="mx-1" />
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate text-sm font-medium">{run.pipelineName}</span>
                <span className="block truncate text-xs tabular-nums text-muted-foreground">
                  {[
                    runTime(run.createdAt),
                    run.finishedAt === null ? null : runDuration(run.createdAt, run.finishedAt),
                    `v${run.pipelineVersion}`,
                    run.cursorStepId !== null && active ? `at ${run.cursorStepId}` : null,
                    run.startedBy === "agent" ? "started by an agent" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                {run.finalVerdict !== null && !active ? (
                  <VerdictChip verdict={run.finalVerdict} />
                ) : null}
                <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** One step of the run, on a rail that joins it to the next. */
function AttemptRow({
  environmentId,
  attempt,
  botId,
  number,
  last,
  onOpenBatch,
}: {
  readonly environmentId: EnvironmentId;
  readonly attempt: BotPipelineAttempt;
  readonly botId: string | undefined;
  readonly number: number;
  readonly last: boolean;
  readonly onOpenBatch: (batchId: string) => void;
}) {
  const state = attemptState(attempt);
  const tone = state.tone === "waiting" ? "neutral" : state.tone;
  const duration =
    attempt.startedAt !== null && attempt.finishedAt !== null
      ? runDuration(attempt.startedAt, attempt.finishedAt)
      : null;
  const batchId = attempt.batchId;
  return (
    <li className="flex min-w-0 gap-3">
      <StepRail botId={botId} number={number} tone={tone} last={last} />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", last ? "pb-1" : "pb-4")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="min-w-0 truncate font-mono text-sm font-medium">{attempt.stepId}</span>
          <LibraryStateBadge tone={tone}>{state.label}</LibraryStateBadge>
          {attempt.outcome?.verdict ? <VerdictChip verdict={attempt.outcome.verdict} /> : null}
          <span className="text-xs tabular-nums text-muted-foreground">
            {[
              attempt.round > 1 ? `round ${attempt.round}` : null,
              duration,
              attempt.botVersion === null ? null : `v${attempt.botVersion}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="ms-auto flex gap-0.5">
            {attempt.runId !== null ? (
              <Button
                shape="pill"
                size="xs"
                variant="ghost"
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: botRunThreadId(attempt.runId) }}
                  />
                }
              >
                <ArrowUpRightIcon />
                Open run
              </Button>
            ) : null}
            {batchId !== null ? (
              <Button shape="pill" size="xs" variant="ghost" onClick={() => onOpenBatch(batchId)}>
                <LayersIcon />
                Open batch
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
      </div>
    </li>
  );
}

/** A step's marker: its bot's tile when the step is known, its place in line otherwise. */
export function StepRail({
  botId,
  number,
  tone,
  last,
}: {
  readonly botId: string | undefined;
  readonly number: number;
  /** Rides on the marker's corner; left off where the step has no state yet. */
  readonly tone?: LibraryWorkflowTone;
  readonly last: boolean;
}) {
  const status = tone ? <LibraryStateDot tone={tone} className="size-1.5" /> : null;
  return (
    <div aria-hidden className="flex w-6 shrink-0 flex-col items-center gap-1">
      {botId === undefined ? (
        <span className="relative inline-flex size-6 items-center justify-center rounded-md bg-muted text-2xs font-medium tabular-nums text-muted-foreground dark:bg-accent">
          {number}
          {status ? (
            <span className="absolute -end-0.5 -bottom-0.5 inline-flex rounded-full bg-background p-0.5">
              {status}
            </span>
          ) : null}
        </span>
      ) : (
        <BotTile bot={{ id: botId }} size="sm" status={status} />
      )}
      {last ? null : <span className="w-px flex-1 bg-border" />}
    </div>
  );
}

function PipelineRunSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the pipeline run"
      className={cn(LIBRARY_OUTLINE, "flex flex-col gap-5 p-4 sm:p-5")}
    >
      <div className="flex items-center gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton shape="pill" className="h-6 w-28" />
      </div>
      <Skeleton shape="pill" className="h-1.5 w-full" />
      {["first", "second", "third"].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton shape="card" className="size-6" />
          <Skeleton className="h-3 w-1/4" />
          <Skeleton shape="pill" className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function PipelineRunView({
  environmentId,
  pipelineRunId,
  changes,
  canRun,
  canCancel,
  onOpenBatch,
  onClose,
  pipelines,
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineRunId: string;
  readonly changes: BotPipelineChanges;
  readonly canRun: boolean;
  readonly canCancel: boolean;
  readonly onOpenBatch: (batchId: string) => void;
  readonly onClose: () => void;
  /** Saved pipelines, to put each step's bot on its row and show the steps still ahead. */
  readonly pipelines?: ReadonlyArray<BotPipeline>;
}) {
  const query = useEnvironmentQuery(
    bots.getPipelineRun({ environmentId, input: { pipelineRunId } }),
  );
  const cancel = useAtomCommand(bots.cancelPipelineRun, { reportFailure: false });
  const resume = useAtomCommand(bots.resumePipelineRun, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applied = query.data ? applyPipelineAttemptChanges(query.data, changes) : null;
  // The report is built from the attempts, so it follows the run as steps finish.
  const progress =
    applied === null
      ? ""
      : `${applied.run.status}:${applied.attempts.map((attempt) => attempt.state).join(",")}`;
  const refresh = query.refresh;
  const seenProgress = useRef(progress);
  useEffect(() => {
    if (seenProgress.current === progress) return;
    const first = seenProgress.current === "";
    seenProgress.current = progress;
    if (!first) refresh();
  }, [progress, refresh]);

  if (query.error) return <LibraryErrorNotice error={query.error} onRetry={query.refresh} />;
  if (!query.data || applied === null) return <PipelineRunSkeleton />;
  const { run, attempts } = applied;
  const state = BOT_PIPELINE_RUN_STATES[run.status];
  const active = isActiveBotPipelineRunStatus(run.status);
  const resumable = run.status === "stopped" || run.status === "failed";
  // Only the version that ran says which bot each step used; a later edit may have changed it.
  const ran = pipelines?.find(
    (pipeline) => pipeline.id === run.pipelineId && pipeline.version === run.pipelineVersion,
  );
  const botOf = (stepId: string) => ran?.steps.find((step) => step.id === stepId)?.botId;
  const ahead = active
    ? (ran?.steps.filter((step) => !attempts.some((attempt) => attempt.stepId === step.id)) ?? [])
    : [];
  const finished = attempts.filter(
    (attempt) => attempt.state === "done" || attempt.state === "skipped",
  ).length;
  const total = attempts.length + ahead.length;

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  const stop = () =>
    act(async () => {
      const result = await cancel({ environmentId, input: { pipelineRunId: run.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });
  const pickUp = () =>
    act(async () => {
      const result = await resume({ environmentId, input: { pipelineRunId: run.id } });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    });

  return (
    <section aria-label="Pipeline run" className={cn(LIBRARY_OUTLINE, "overflow-hidden")}>
      <div className="flex flex-col gap-5 p-4 sm:p-5">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-60 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="min-w-0 text-base font-semibold tracking-tight wrap-anywhere">
                {run.pipelineName}
              </h3>
              <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
              {run.finalVerdict !== null && !active ? (
                <VerdictChip verdict={run.finalVerdict} />
              ) : null}
            </div>
            <p className="text-xs tabular-nums text-muted-foreground">
              {[
                `v${run.pipelineVersion}`,
                runTime(run.createdAt),
                run.startedBy === "agent" ? "started by an agent" : null,
                run.retryAt !== null ? `tries again ${runTime(run.retryAt)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {active ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canCancel || busy}
                onClick={() => void stop()}
              >
                <SquareIcon />
                Cancel pipeline
              </Button>
            ) : null}
            {resumable ? (
              <Button
                shape="pill"
                size="xs"
                variant="outline"
                disabled={!canRun || busy}
                onClick={() => void pickUp()}
              >
                <PlayIcon />
                Resume
              </Button>
            ) : null}
            <Button
              shape="pill"
              size="icon-xs"
              variant="ghost"
              aria-label="Close pipeline run"
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
        </div>
        {run.error ? (
          <p
            className={cn(
              "text-sm wrap-anywhere",
              run.status === "failed" ? "text-destructive-foreground" : "text-foreground/90",
            )}
          >
            {run.error}
          </p>
        ) : null}
        <LibraryErrorNotice error={error} />
        {attempts.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              label={`${finished} of ${total} steps done`}
              segments={[
                ...attempts.map((attempt) => ({
                  key: String(attempt.seq),
                  tone: attemptState(attempt).tone,
                  count: 1,
                })),
                ...ahead.map((step) => ({ key: step.id, tone: "waiting" as const, count: 1 })),
              ]}
            />
            <p className="text-xs tabular-nums text-muted-foreground">
              {finished} of {total} step{total === 1 ? "" : "s"} done
            </p>
          </div>
        ) : null}
        <ol aria-label="Steps" className="flex flex-col">
          {attempts.map((attempt, index) => (
            <AttemptRow
              key={attempt.seq}
              environmentId={environmentId}
              attempt={attempt}
              botId={botOf(attempt.stepId)}
              number={index + 1}
              last={index === attempts.length - 1 && ahead.length === 0}
              onOpenBatch={onOpenBatch}
            />
          ))}
          {ahead.map((step, index) => (
            <li key={step.id} className="flex min-w-0 gap-3 opacity-60">
              <StepRail
                botId={step.botId}
                number={attempts.length + index + 1}
                last={index === ahead.length - 1}
              />
              <p
                className={cn(
                  "min-w-0 flex-1 truncate pt-0.5 text-sm",
                  index === ahead.length - 1 ? "pb-1" : "pb-4",
                )}
              >
                <span className="font-mono font-medium">{step.id}</span>
                <span className="text-xs text-muted-foreground"> · Not reached yet</span>
              </p>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-col gap-2 border-t border-border px-4 py-4 text-sm sm:px-5">
        <h4 className="text-xs font-medium text-muted-foreground">Report</h4>
        <ChatMarkdown text={query.data.report.markdown} cwd={undefined} />
        {query.data.report.truncated ? (
          <p className="text-xs text-muted-foreground">The report was cut to its size limit.</p>
        ) : null}
      </div>
    </section>
  );
}

// STUB(bots-redesign): replaced by the owning area's implementation.
/** One pipeline run as its own page. */
export function PipelineRunPage(_props: { readonly runId: string }) {
  return null;
}

/** The pipeline run form (`runPipeline`), over whichever page is open. */
export function PipelinesOverlays() {
  return null;
}
