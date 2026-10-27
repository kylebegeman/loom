import type { BotBatchReport, BotPipelineAttempt, BotPipelineRun } from "@t3tools/contracts/fork";

import { BATCH_REPORT_MAX_BYTES } from "../batchReport.ts";
import { renderFindings, stepLabel, type StepOutput } from "./templates.ts";

const byteLength = (text: string) => new TextEncoder().encode(text).length;

export interface ReportAttempt {
  readonly attempt: BotPipelineAttempt;
  readonly output: StepOutput | null;
}

/** What the report says about a step's bot. */
export interface ReportStep {
  readonly botName: string;
  readonly model: string;
}

const STATUS_LABEL: Record<BotPipelineRun["status"], string> = {
  running: "Running",
  waiting: "Waiting for a budget",
  completed: "Completed",
  stopped: "Stopped",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** What a step's attempt came to, for the path line and its heading. */
const result = ({ attempt, output }: ReportAttempt): string | null => {
  if (attempt.state === "skipped") return "skipped";
  if (attempt.state !== "done" || output === null) return null;
  if (output.status !== "completed") return output.status.replaceAll("_", " ");
  return output.verdict?.replaceAll("_", " ") ?? null;
};

/** "Review, Fix, Verify (fail), Fix, Verify (pass)". */
const pathLine = (attempts: ReadonlyArray<ReportAttempt>) =>
  attempts
    .map((entry) => {
      const outcome = result(entry);
      return `${stepLabel(entry.attempt.stepId)}${outcome === null ? "" : ` (${outcome})`}`;
    })
    .join(", ");

const duration = (attempt: BotPipelineAttempt) => {
  if (attempt.startedAt === null || attempt.finishedAt === null) return null;
  const seconds = Math.max(
    0,
    Math.round((Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) / 1000),
  );
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const attemptSection = (entry: ReportAttempt, steps: ReadonlyMap<string, ReportStep>) => {
  const { attempt, output } = entry;
  const step = steps.get(attempt.stepId);
  const outcome = result(entry);
  const facts = [
    step === undefined
      ? null
      : `${step.botName}${attempt.botVersion === null ? "" : ` version ${attempt.botVersion}`}, ${step.model}`,
    attempt.round > 1 ? `round ${attempt.round}` : null,
    duration(attempt),
  ].filter((fact) => fact !== null);
  const lines = [
    `## ${attempt.seq}. ${stepLabel(attempt.stepId)}${outcome === null ? "" : ` (${outcome})`}`,
    "",
    facts.length === 0 ? "Not started." : `${facts.join(", ")}.`,
  ];
  const body = output?.summary ?? output?.error ?? null;
  if (body !== null && body !== "") lines.push("", body);
  if (output !== null && output.verdict !== "pass" && output.findings.length > 0)
    lines.push("", renderFindings(output.findings));
  if (attempt.runId !== null) lines.push("", `Run: ${attempt.runId}`);
  if (attempt.batchId !== null) lines.push("", `Batch: ${attempt.batchId}`);
  for (const note of attempt.notes) lines.push("", `_${note}_`);
  return lines.join("\n");
};

/** Markdown for a pipeline run: its status, the path it took, then each attempt in order. */
export const renderPipelineReport = (
  run: BotPipelineRun,
  attempts: ReadonlyArray<ReportAttempt>,
  steps: ReadonlyMap<string, ReportStep>,
): BotBatchReport => {
  const header = [
    `# ${run.pipelineName}`,
    "",
    `${STATUS_LABEL[run.status]}. Version ${run.pipelineVersion}.`,
    ...(run.error === null ? [] : ["", run.error]),
    "",
    `Path: ${pathLine(attempts)}`,
  ].join("\n");
  const cutNote = "\n\n_Report cut short. Open the pipeline run for the rest._";
  const budget = BATCH_REPORT_MAX_BYTES - byteLength(cutNote);
  let markdown = header;
  for (const entry of attempts) {
    const next = `${markdown}\n\n${attemptSection(entry, steps)}`;
    if (byteLength(next) > budget) return { markdown: `${markdown}${cutNote}`, truncated: true };
    markdown = next;
  }
  return { markdown, truncated: false };
};
