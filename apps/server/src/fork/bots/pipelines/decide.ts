import {
  BOTS_VERDICT_MAX_FINDINGS,
  batchCountsLine,
  type BotBatch,
  type BotBatchItem,
  type BotPipelineStep,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";

import { loopRanges } from "./check.ts";
import { OUTPUT_RESULT_MAX, stepLabel, type StepOutput } from "./templates.ts";

export type Decision =
  | { readonly kind: "next"; readonly stepId: string; readonly round: number }
  | { readonly kind: "completed" }
  /** `stopped` when a gate said stop, `failed` when an error did. */
  | { readonly kind: "stopped" | "failed"; readonly message: string };

const errorPhrase = (output: StepOutput) => {
  switch (output.status) {
    case "timed_out":
      return "timed out";
    case "cancelled":
      return "was cancelled";
    default:
      return "failed";
  }
};

/** Where the pipeline goes after `stepId`'s attempt in `round` ends with `output`. */
export const decide = (
  steps: ReadonlyArray<BotPipelineStep>,
  stepId: string,
  round: number,
  output: StepOutput,
): Decision => {
  const index = steps.findIndex((step) => step.id === stepId);
  const step = steps[index];
  if (step === undefined) return { kind: "failed", message: `The pipeline has no step ${stepId}.` };
  const label = stepLabel(step.id);

  const advance = (): Decision => {
    const next = steps[index + 1];
    if (next === undefined) return { kind: "completed" };
    // The round carries on inside the loop the step belongs to and starts over outside it.
    const sameLoop = loopRanges(steps).some((loop) => loop.start <= index && index + 1 <= loop.end);
    return { kind: "next", stepId: next.id, round: sameLoop ? round : 1 };
  };

  if (output.status !== "completed") {
    if (step.onError === "continue") return advance();
    const reason = output.error ?? output.summary;
    return {
      kind: "failed",
      message: `${label} ${errorPhrase(output)}.${reason === null ? "" : ` ${reason}`}`,
    };
  }
  switch (output.verdict) {
    case "fail": {
      const onFail = step.onFail ?? "stop";
      if (onFail === "continue") return advance();
      if (onFail === "stop") return { kind: "stopped", message: `${label} gave a fail verdict.` };
      if (round < onFail.maxRounds) return { kind: "next", stepId: onFail.goTo, round: round + 1 };
      return {
        kind: "stopped",
        message: `${label} still failed after ${onFail.maxRounds} round${onFail.maxRounds === 1 ? "" : "s"}.`,
      };
    }
    case "needs_attention":
      return step.onNeedsAttention === "continue"
        ? advance()
        : { kind: "stopped", message: `${label} needs attention.` };
    default:
      return advance();
  }
};

const VERDICT_RANK: Record<BotVerdictValue, number> = { pass: 0, needs_attention: 1, fail: 2 };

/**
 * A fan-out step's output: completed only when every item's run completed, the worst item
 * verdict, the count line as its summary and every item's findings.
 */
export const fanOutOutput = (
  batch: BotBatch,
  items: ReadonlyArray<BotBatchItem>,
  report: string,
): StepOutput => {
  let verdict: BotVerdictValue | null = null;
  const findings = [];
  let errored = batch.status === "cancelled";
  for (const item of items) {
    const run = item.run;
    if (run === null || item.state !== "started") {
      if (item.state !== "skipped" || batch.status === "cancelled") errored = true;
      continue;
    }
    if (run.status !== "completed") errored = true;
    const itemVerdict = run.verdict?.verdict;
    if (
      itemVerdict !== undefined &&
      (verdict === null || VERDICT_RANK[itemVerdict] > VERDICT_RANK[verdict])
    )
      verdict = itemVerdict;
    findings.push(...(run.verdict?.findings ?? []));
  }
  return {
    status: errored ? (batch.status === "cancelled" ? "cancelled" : "failed") : "completed",
    verdict,
    summary: batchCountsLine(batch.counts),
    findings: findings.slice(0, BOTS_VERDICT_MAX_FINDINGS),
    result: report.slice(0, OUTPUT_RESULT_MAX),
    error: errored ? batch.note : null,
  };
};

/** The run that stands for a stopped step: the step's run, or a fan-out's first item at fault. */
export const faultRunId = (items: ReadonlyArray<BotBatchItem>): string | null => {
  const run = items.find((item) => {
    const status = item.run?.status;
    return (
      status === "failed" ||
      status === "timed_out" ||
      status === "cancelled" ||
      item.run?.verdict?.verdict === "fail" ||
      item.run?.verdict?.verdict === "needs_attention"
    );
  })?.run;
  return run?.id ?? null;
};
