import {
  BOT_RUN_STATES,
  BOT_VERDICT_STATES,
  batchSourceFromDraft,
  botVersionLabel,
  type BatchSourceDraft,
} from "@t3tools/client-runtime/fork";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
export {
  initialRunValues,
  needsProject,
  runsInCheckout,
  checkoutChoices,
  readsFiles,
  sourceNeedsProject,
  emptyBatchSourceDraft,
  defaultItemParameter,
  type BatchSourceType,
  type BatchSourceDraft,
} from "@t3tools/client-runtime/fork";
import type { ThreadId } from "@t3tools/contracts";
import {
  isTerminalBotRunStatus,
  type BotBatchSource,
  type BotDefinition,
  type BotInputs,
  type BotParameter,
  type BotRun,
  type BotRunStatus,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import { relativeTime } from "../../lib/time";

export function parameterInputs(
  parameters: ReadonlyArray<BotParameter>,
  values: Record<string, string>,
): BotInputs {
  return Object.fromEntries(
    parameters.flatMap((parameter): Array<[string, string | number | boolean]> => {
      const raw = values[parameter.name] ?? "";
      if (raw.trim() === "" && parameter.type !== "boolean") {
        if (parameter.required && parameter.default === undefined)
          throw new Error(`${parameter.label} is required.`);
        return [];
      }
      if (parameter.type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error(`${parameter.label} must be a finite number.`);
        return [[parameter.name, value]];
      }
      if (parameter.type === "boolean") return [[parameter.name, raw === "true"]];
      if (parameter.type === "choice" && !parameter.choices?.includes(raw))
        throw new Error(`Choose a value for ${parameter.label}.`);
      return [[parameter.name, raw]];
    }),
  );
}

export const fixedProject = (bot: BotDefinition) =>
  (bot.workspace.type === "project" ? bot.workspace.projectId : null) ?? bot.scopeProjectId;
export const batchSource = (
  draft: BatchSourceDraft,
  checkoutThreadId: ThreadId | null,
): BotBatchSource | null =>
  batchSourceFromDraft({ ...draft, checkoutThreadId: checkoutThreadId ?? "" });

export const runSummary = (run: BotRun) =>
  Object.entries(run.inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");

/** Labels only, for screens that print a state inline; tones live with the shared presentations. */
export const RUN_STATUS = Object.fromEntries(
  Object.entries(BOT_RUN_STATES).map(([status, state]) => [status, state.label]),
) as Record<BotRunStatus, string>;
export const VERDICT_LABELS = Object.fromEntries(
  Object.entries(BOT_VERDICT_STATES).map(([verdict, state]) => [verdict, state.label]),
) as Record<BotVerdictValue, string>;

/** An absolute time, for moments a reader plans around, such as when a paused batch resumes. */
export const runTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : null;

/** How long ago something happened, in the short form the rest of the app uses. */
export function runAgo(value: string | null | undefined) {
  if (!value) return null;
  const ago = relativeTime(value);
  return ago === "<1m" ? "just now" : `${ago} ago`;
}

/** How long a run took, or has taken so far, in its two largest units. */
export function runDuration(startedAt: string | null, finishedAt: string | null, now = Date.now()) {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  const end = finishedAt ? Date.parse(finishedAt) : now;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 ? `${minutes}m ${seconds % 60}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
}

/** The one line under a run's title: when, how long, where and who, in that order of interest. */
export function runMeta(run: BotRun) {
  const active = !isTerminalBotRunStatus(run.status);
  return [
    active
      ? run.status === "queued"
        ? `Queued ${runAgo(run.createdAt)}`
        : `Started ${runAgo(run.startedAt ?? run.createdAt)}`
      : runAgo(run.finishedAt ?? run.startedAt ?? run.createdAt),
    active ? null : runDuration(run.startedAt, run.finishedAt),
    `v${run.botVersion}`,
    run.ranOn ? `on ${run.ranOn.label}` : null,
    run.requestedBy ? `for ${run.requestedBy.label}` : null,
    run.startedBy === "agent" ? "started by an agent" : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** A completed run's verdict already says how it went, so its Completed pill would only repeat it. */
export const showsRunState = (run: BotRun) => !(run.verdict && run.status === "completed");

export const RUNTIME_MODE_LABELS: Record<BotDefinition["runtimeMode"], string> = {
  "approval-required": "Ask before actions",
  "auto-accept-edits": "Accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

export function workspaceLabel(workspace: BotDefinition["workspace"]) {
  if (workspace.type === "scratch") return "Fresh scratch folder";
  if (workspace.checkout === "caller") return "Checkout it is run for";
  return workspace.worktree ? "New worktree" : "Project checkout";
}

/** What sets a bot apart in a list: where it came from, else the model it runs on. */
export function botDetail(bot: BotDefinition) {
  const origin = [
    bot.archivedAt ? "Archived" : null,
    bot.origin?.kind === "starter" ? "Starter" : null,
    bot.library == null ? null : "From the Library",
  ].filter(Boolean);
  return [...(origin.length ? origin : [bot.modelSelection.model]), botVersionLabel(bot)].join(
    " · ",
  );
}

export const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function commandValue<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}
