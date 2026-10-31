import type {
  BotBatchStatus,
  BotDefinition,
  BotPipelineRunStatus,
  BotRunStatus,
  BotRun,
  BotTriggerFiring,
  BotCompletionDelivery,
  BotVerdictValue,
  LibraryProjectColor,
} from "@t3tools/contracts/fork";
import { libraryProjectColor } from "./library-project.ts";
import type { LibraryWorkflowTone } from "./library-workflows.ts";

export const BOTS_NAVIGATION_VISIBLE = true;

type Presentation = { readonly label: string; readonly tone: LibraryWorkflowTone };

export const BOT_RUN_STATES: Record<BotRunStatus, Presentation> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "active" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  timed_out: { label: "Timed out", tone: "warning" },
};

export const BOT_RUN_ATTENTION_STATES: Record<
  NonNullable<BotRun["attention"]>["kind"],
  Presentation
> = {
  approval: { label: "Needs approval", tone: "warning" },
  question: { label: "Has a question", tone: "warning" },
};

export const GROK_ROUTINE_GUIDE = "https://docs.x.ai/grok-bot/skills-routines-and-automations";

export function botCompletionDeliveryLabel(delivery: BotCompletionDelivery): string {
  if (delivery.status === "acknowledged")
    return delivery.receiverOutcome === "failed"
      ? "Grok outcome: failed"
      : "Grok outcome: completed";
  return {
    pending: "Pending delivery",
    retrying: "Retrying delivery",
    sending: "Sending",
    accepted: "Grok routine accepted",
    failed: "Delivery failed",
    needs_attention:
      delivery.reason === "outcome_unknown"
        ? "Outcome unknown, needs attention"
        : "Delivery needs attention",
    cancelled: "Delivery cancelled",
  }[delivery.status];
}

export const BOT_TRIGGER_FIRING_STATES: Record<BotTriggerFiring["outcome"], Presentation> = {
  pending: { label: "Pending dispatch", tone: "warning" },
  run: { label: "Ran", tone: "success" },
  skipped: { label: "Skipped", tone: "neutral" },
};

export const BOT_VERDICT_STATES: Record<BotVerdictValue, Presentation> = {
  pass: { label: "Pass", tone: "success" },
  fail: { label: "Fail", tone: "danger" },
  needs_attention: { label: "Needs attention", tone: "warning" },
};

export const BOT_BATCH_STATES: Record<BotBatchStatus, Presentation> = {
  running: { label: "Running", tone: "active" },
  finished: { label: "Finished", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const BOT_PIPELINE_RUN_STATES: Record<BotPipelineRunStatus, Presentation> = {
  running: { label: "Running", tone: "active" },
  waiting: { label: "Waiting for budget", tone: "warning" },
  completed: { label: "Completed", tone: "success" },
  stopped: { label: "Stopped", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/**
 * A bot's color, stable across clients and renames, so the same bot is recognizable in the list,
 * its page and every run it leaves behind.
 */
export function botColor(bot: Pick<BotDefinition, "id">): LibraryProjectColor {
  return libraryProjectColor({ id: bot.id });
}
