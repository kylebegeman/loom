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
  type BotPipelineRunStatus,
} from "@t3tools/contracts/fork";
import { applyPipelineAttemptChanges, type BotPipelineChanges } from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import ChatMarkdown from "~/components/ChatMarkdown";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useProjects } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { LibraryDialog, LibraryField } from "../project-library/LibraryControls";
import { ParameterField } from "./BotRunForm";
import { formatDuration } from "./BotsUsage";
import { initialRunValues, needsProject, runInputs } from "./draft";
import { bots } from "./state";
import { VerdictChip } from "./VerdictChip";

const time = (value: string) => new Date(value).toLocaleString();

export const PIPELINE_RUN_STATUS_LABELS: Record<BotPipelineRunStatus, string> = {
  running: "Running",
  waiting: "Waiting for budget",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const pipelineRunStatusVariant = (status: BotPipelineRunStatus) =>
  status === "completed"
    ? ("success" as const)
    : status === "failed"
      ? ("error" as const)
      : status === "stopped" || status === "waiting"
        ? ("warning" as const)
        : status === "running"
          ? ("secondary" as const)
          : ("outline" as const);

const ATTEMPT_STATE_LABELS: Record<BotPipelineAttempt["state"], string> = {
  pending: "Waiting",
  started: "Running",
  done: "Done",
  skipped: "Skipped",
};

const attemptStatus = (attempt: BotPipelineAttempt) => {
  if (attempt.state !== "done" || attempt.outcome === null)
    return ATTEMPT_STATE_LABELS[attempt.state];
  switch (attempt.outcome.status) {
    case "timed_out":
      return "Timed out";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Done";
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !canRun} onClick={() => void submit()}>
            {busy ? "Starting…" : "Run"}
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
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
        {error ? (
          <p role="alert" className="text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        {!canRun ? (
          <p role="status" className="text-sm text-muted-foreground">
            This connection cannot run pipelines.
          </p>
        ) : null}
      </form>
    </LibraryDialog>
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
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  return (
    <ul className="grid gap-2">
      {runs.map((run) => (
        <li key={run.id}>
          <Button
            size="sm-multiline"
            variant={run.id === selectedId ? "secondary" : "ghost"}
            aria-pressed={run.id === selectedId}
            className="w-full justify-start"
            onClick={() => onSelect(run)}
          >
            <span className="grid min-w-0 gap-0.5 text-left">
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={pipelineRunStatusVariant(run.status)}>
                  {PIPELINE_RUN_STATUS_LABELS[run.status]}
                </Badge>
                <span className="font-medium">{run.pipelineName}</span>
                {run.finalVerdict !== null && !isActiveBotPipelineRunStatus(run.status) ? (
                  <VerdictChip verdict={run.finalVerdict} />
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {time(run.createdAt)}
                {run.cursorStepId !== null && isActiveBotPipelineRunStatus(run.status)
                  ? ` · at ${run.cursorStepId}`
                  : ""}
              </span>
            </span>
          </Button>
        </li>
      ))}
    </ul>
  );
}

function AttemptRow({
  environmentId,
  attempt,
  onOpenBatch,
}: {
  readonly environmentId: EnvironmentId;
  readonly attempt: BotPipelineAttempt;
  readonly onOpenBatch: (batchId: string) => void;
}) {
  const duration =
    attempt.startedAt !== null && attempt.finishedAt !== null
      ? formatDuration(Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt))
      : null;
  return (
    <li className="grid gap-1 rounded-lg border border-border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{attempt.stepId}</span>
        {attempt.round > 1 ? (
          <span className="text-muted-foreground">round {attempt.round}</span>
        ) : null}
        <Badge variant="outline">{attemptStatus(attempt)}</Badge>
        {attempt.outcome?.verdict ? <VerdictChip verdict={attempt.outcome.verdict} /> : null}
        {duration === null ? null : <span className="text-muted-foreground">{duration}</span>}
        {attempt.botVersion === null ? null : (
          <span className="text-muted-foreground">version {attempt.botVersion}</span>
        )}
        <span className="ml-auto flex gap-1">
          {attempt.runId !== null ? (
            <Button
              size="xs"
              variant="ghost"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: botRunThreadId(attempt.runId) }}
                />
              }
            >
              Open run
            </Button>
          ) : null}
          {attempt.batchId !== null ? (
            <Button size="xs" variant="ghost" onClick={() => onOpenBatch(attempt.batchId!)}>
              Open batch
            </Button>
          ) : null}
        </span>
      </div>
      {attempt.outcome?.summary ? (
        <p className="text-muted-foreground">{attempt.outcome.summary}</p>
      ) : null}
      {attempt.notes.map((note) => (
        <p key={note} className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
    </li>
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
}: {
  readonly environmentId: EnvironmentId;
  readonly pipelineRunId: string;
  readonly changes: BotPipelineChanges;
  readonly canRun: boolean;
  readonly canCancel: boolean;
  readonly onOpenBatch: (batchId: string) => void;
  readonly onClose: () => void;
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

  if (query.error)
    return (
      <p role="alert" className="text-sm text-destructive-foreground">
        {query.error}
      </p>
    );
  if (!query.data || applied === null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading the pipeline run…
      </p>
    );
  const { run, attempts } = applied;
  const active = isActiveBotPipelineRunStatus(run.status);
  const resumable = run.status === "stopped" || run.status === "failed";

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
    <section aria-label="Pipeline run" className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{run.pipelineName}</h3>
            <Badge variant={pipelineRunStatusVariant(run.status)}>
              {PIPELINE_RUN_STATUS_LABELS[run.status]}
            </Badge>
            {run.finalVerdict !== null && !active ? (
              <VerdictChip verdict={run.finalVerdict} />
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Version {run.pipelineVersion} · {time(run.createdAt)}
            {run.startedBy === "agent" ? " · started by an agent" : ""}
            {run.retryAt !== null ? ` · tries again at ${time(run.retryAt)}` : ""}
          </p>
          {run.error ? <p className="text-sm">{run.error}</p> : null}
        </div>
        <div className="flex flex-wrap gap-1">
          {active ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canCancel || busy}
              onClick={() => void stop()}
            >
              Cancel pipeline
            </Button>
          ) : null}
          {resumable ? (
            <Button
              size="xs"
              variant="outline"
              disabled={!canRun || busy}
              onClick={() => void pickUp()}
            >
              Resume
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive-foreground">
          {error}
        </p>
      ) : null}
      <ol aria-label="Steps" className="grid gap-2">
        {attempts.map((attempt) => (
          <AttemptRow
            key={attempt.seq}
            environmentId={environmentId}
            attempt={attempt}
            onOpenBatch={onOpenBatch}
          />
        ))}
      </ol>
      <div className="rounded-lg border border-border p-3 text-sm">
        <ChatMarkdown text={query.data.report.markdown} cwd={undefined} />
        {query.data.report.truncated ? (
          <p className="text-xs text-muted-foreground">The report was cut to its size limit.</p>
        ) : null}
      </div>
    </section>
  );
}
