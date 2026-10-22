import { batchSourceFromDraft, type BatchSourceDraft } from "@t3tools/client-runtime/fork";
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
  type BotBatchSource,
  type BotDefinition,
  type BotInputs,
  type BotParameter,
  type BotRun,
} from "@t3tools/contracts/fork";

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

export const RUN_STATUS = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
} as const;
export const VERDICT_LABELS = {
  pass: "Pass",
  fail: "Fail",
  needs_attention: "Needs attention",
} as const;
export const runSummary = (run: BotRun) =>
  Object.entries(run.inputs)
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join(", ");
export const runTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : null;
export const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error ? cause.message : fallback;

export function commandValue<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}
