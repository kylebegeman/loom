import {
  BOTS_ANYWHERE_WS_METHODS as BA,
  BOTS_BATCH_WS_METHODS as BB,
  BOTS_DRAFT_WS_METHODS as BD,
  BOTS_PIPELINE_WS_METHODS as BP,
  BOTS_TRIGGER_WS_METHODS as BT,
  BOTS_VERSION_WS_METHODS as BV,
  BOTS_WS_METHODS as B,
  type BotBatch,
  type BotBatchChange,
  type BotBatchItem,
  type BotDefinition,
  type BotDefinitionInput,
  type BotPipeline,
  type BotPipelineAttempt,
  type BotPipelineChange,
  type BotPipelineRun,
  type BotReplay,
  type BotRun,
  type BotsChange,
  type BotsInboxPage,
  type BotTrigger,
  type BotTriggerChange,
  type BotTriggerFiring,
  type BotVerdictValue,
  BOTS_DISMISS_MAX_RUNS,
  isBotInboxRun,
  isBotRunThreadId,
  needsBotAttention,
} from "@t3tools/contracts/fork";
import * as Arr from "effect/Array";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { EnvironmentThreadShell } from "../state/models.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

/** Changes seen since the watch started; always newer than any list fetched before them. */
export interface BotsChanges {
  readonly bots: ReadonlyMap<string, BotDefinition | null>;
  readonly runs: ReadonlyMap<string, BotRun>;
}

export const EMPTY_BOTS_CHANGES: BotsChanges = { bots: new Map(), runs: new Map() };

export const foldBotsChange = (changes: BotsChanges, change: BotsChange): BotsChanges => {
  switch (change._tag) {
    case "bot":
      return { ...changes, bots: new Map(changes.bots).set(change.bot.id, change.bot) };
    case "bot-deleted":
      return { ...changes, bots: new Map(changes.bots).set(change.botId, null) };
    case "run":
      return { ...changes, runs: new Map(changes.runs).set(change.run.id, change.run) };
  }
};

const byName = (left: BotDefinition, right: BotDefinition) => left.name.localeCompare(right.name);

/** The bot list with watched edits applied. */
export const applyBotChanges = (
  listed: ReadonlyArray<BotDefinition>,
  changes: BotsChanges,
): ReadonlyArray<BotDefinition> => {
  const merged = new Map(listed.map((bot) => [bot.id, bot]));
  for (const [id, bot] of changes.bots) {
    if (bot === null) merged.delete(id);
    else merged.set(id, bot);
  }
  return [...merged.values()].sort(byName);
};

const newestFirst = (left: BotRun, right: BotRun) =>
  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

/**
 * A page of runs with watched progress applied. Runs started after the page was fetched join it
 * when they match its bot; older pages only update the runs they already hold. A page filtered by
 * verdict keeps only runs that still carry that verdict.
 */
export const applyRunChanges = (
  listed: ReadonlyArray<BotRun>,
  changes: BotsChanges,
  options: {
    readonly botId?: string | undefined;
    readonly verdict?: BotVerdictValue | undefined;
    readonly includeNew: boolean;
  },
): ReadonlyArray<BotRun> => {
  const merged = new Map(listed.map((run) => [run.id, run]));
  for (const [id, run] of changes.runs) {
    if (merged.has(id)) merged.set(id, run);
    else if (options.includeNew && (options.botId === undefined || run.botId === options.botId))
      merged.set(id, run);
  }
  const runs = [...merged.values()];
  const { verdict } = options;
  return (
    verdict === undefined ? runs : runs.filter((run) => run.verdict?.verdict === verdict)
  ).sort(newestFirst);
};

/**
 * The first inbox page with watched changes applied, its total kept without a refetch. A changed
 * run on the page was counted; one missing from it was not, unless it is older than an unfinished
 * page, where its earlier state is unknown and the total is left alone.
 */
export const applyInboxChanges = (
  page: BotsInboxPage,
  changes: BotsChanges,
  options: { readonly dismissed: boolean },
): BotsInboxPage => {
  const matches = options.dismissed
    ? (run: BotRun) => run.dismissedAt != null && needsBotAttention(run)
    : isBotInboxRun;
  const oldest = page.runs.at(-1)?.createdAt;
  const merged = new Map(page.runs.map((run) => [run.id, run]));
  let total = page.total;
  for (const [id, run] of changes.runs) {
    const listed = merged.has(id);
    if (!listed && page.hasMore && oldest !== undefined && run.createdAt < oldest) continue;
    const now = matches(run);
    total += Number(now) - Number(listed);
    if (now) merged.set(id, run);
    else merged.delete(id);
  }
  return {
    runs: [...merged.values()].sort(newestFirst),
    total: Math.max(0, total),
    hasMore: page.hasMore,
  };
};

/** Run ids split into requests the dismiss input accepts; a live inbox can outgrow one. */
export const dismissRunIdBatches = (
  runs: ReadonlyArray<Pick<BotRun, "id">>,
): ReadonlyArray<ReadonlyArray<string>> =>
  Arr.chunksOf(
    runs.map((run) => run.id),
    BOTS_DISMISS_MAX_RUNS,
  );

export type WaitingBotRunThread = Pick<
  EnvironmentThreadShell,
  "environmentId" | "id" | "title" | "hasPendingApprovals" | "hasPendingUserInput" | "updatedAt"
>;

/** Bot run threads stopped on an approval or a question; nobody sees a hidden run ask. */
export const waitingBotRunThreads = (
  shells: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<WaitingBotRunThread> =>
  shells
    .filter(
      (shell) =>
        isBotRunThreadId(shell.id) &&
        shell.archivedAt === null &&
        (shell.hasPendingApprovals || shell.hasPendingUserInput),
    )
    .map(({ environmentId, id, title, hasPendingApprovals, hasPendingUserInput, updatedAt }) => ({
      environmentId,
      id,
      title,
      hasPendingApprovals,
      hasPendingUserInput,
      updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

const sameWaiting = (
  left: ReadonlyArray<WaitingBotRunThread>,
  right: ReadonlyArray<WaitingBotRunThread>,
) =>
  left.length === right.length &&
  left.every(
    (thread, index) =>
      thread.id === right[index]!.id &&
      thread.title === right[index]!.title &&
      thread.hasPendingApprovals === right[index]!.hasPendingApprovals &&
      thread.hasPendingUserInput === right[index]!.hasPendingUserInput,
  );

/** Waiting bot runs over every shell; keeps its last value while nothing it shows changed. */
export function makeWaitingBotRunsAtom(
  threadShellsAtom: Atom.Atom<ReadonlyArray<EnvironmentThreadShell>>,
) {
  let previous: ReadonlyArray<WaitingBotRunThread> = [];
  return Atom.make((get) => {
    const next = waitingBotRunThreads(get(threadShellsAtom));
    if (sameWaiting(previous, next)) return previous;
    previous = next;
    return next;
  }).pipe(Atom.withLabel("loom:bots:waiting-runs"));
}

/** Batch changes seen since the watch started, keyed by batch id. */
export interface BotBatchChanges {
  readonly batches: ReadonlyMap<string, BotBatch>;
  readonly items: ReadonlyMap<string, ReadonlyMap<number, BotBatchItem>>;
}

export const EMPTY_BOT_BATCH_CHANGES: BotBatchChanges = { batches: new Map(), items: new Map() };

export const foldBotBatchChange = (
  changes: BotBatchChanges,
  change: BotBatchChange,
): BotBatchChanges => {
  switch (change._tag) {
    case "batch":
      return {
        ...changes,
        batches: new Map(changes.batches).set(change.batch.id, change.batch),
      };
    case "batch-item": {
      const items = new Map(changes.items.get(change.batchId)).set(change.item.index, change.item);
      return { ...changes, items: new Map(changes.items).set(change.batchId, items) };
    }
  }
};

const batchesNewestFirst = (left: BotBatch, right: BotBatch) =>
  right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);

/** A page of batches with watched progress applied; new batches join the first page of their bot. */
export const applyBatchChanges = (
  listed: ReadonlyArray<BotBatch>,
  changes: BotBatchChanges,
  options: { readonly botId?: string | undefined; readonly includeNew: boolean },
): ReadonlyArray<BotBatch> => {
  const merged = new Map(listed.map((batch) => [batch.id, batch]));
  for (const [id, batch] of changes.batches) {
    if (merged.has(id)) merged.set(id, batch);
    else if (options.includeNew && (options.botId === undefined || batch.botId === options.botId))
      merged.set(id, batch);
  }
  return [...merged.values()].sort(batchesNewestFirst);
};

/** One batch as fetched, with its watched summary and items applied. */
export const applyBatchItemChanges = (
  fetched: { readonly batch: BotBatch; readonly items: ReadonlyArray<BotBatchItem> },
  changes: BotBatchChanges,
): { readonly batch: BotBatch; readonly items: ReadonlyArray<BotBatchItem> } => {
  const batch = changes.batches.get(fetched.batch.id) ?? fetched.batch;
  const watched = changes.items.get(fetched.batch.id);
  if (watched === undefined) return { batch, items: fetched.items };
  return { batch, items: fetched.items.map((item) => watched.get(item.index) ?? item) };
};

/** The definition fields a version diff compares beside the instructions, in the editor's order. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: "Name",
  description: "Description",
  parameters: "Parameters",
  modelSelection: "Model",
  runtimeMode: "Runtime mode",
  interactionMode: "Interaction mode",
  workspace: "Workspace",
  timeoutMinutes: "Timeout (minutes)",
  maxConcurrentRuns: "Concurrent runs",
  scopeProjectId: "Project",
  output: "Output",
  budget: "Budget",
};

/** Field values as text, objects with sorted keys so key order never reads as a change. */
const fieldText = (value: unknown): string => {
  if (value === undefined || value === null) return "None";
  if (typeof value === "string") return value === "" ? "None" : value;
  const sorted = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sorted)
      : typeof item === "object" && item !== null
        ? Object.fromEntries(
            Object.entries(item)
              .filter(([, entry]) => entry !== undefined)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, entry]) => [key, sorted(entry)]),
          )
        : item;
  return JSON.stringify(sorted(value), null, 2);
};

export interface BotFieldChange {
  readonly field: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

export interface BotVersionDiff {
  /** Both instruction texts when they differ, for a line diff. */
  readonly instructions: { readonly before: string; readonly after: string } | null;
  /** Every other changed field, in definition order. */
  readonly fields: ReadonlyArray<BotFieldChange>;
}

/** What changed between two versions of a bot's definition. */
export const botVersionDiff = (
  before: BotDefinitionInput,
  after: BotDefinitionInput,
): BotVersionDiff => {
  const fields: Array<BotFieldChange> = [];
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    const was = fieldText((before as Record<string, unknown>)[field]);
    const now = fieldText((after as Record<string, unknown>)[field]);
    if (was !== now) fields.push({ field, label, before: was, after: now });
  }
  return {
    instructions:
      before.instructions === after.instructions
        ? null
        : { before: before.instructions, after: after.instructions },
    fields,
  };
};

/** "Fixed 2, broke 0, same 8", with changed and failed counts only when there are some. */
export const formatReplaySummary = (summary: BotReplay["summary"]): string =>
  [
    `Fixed ${summary.fixed}`,
    `broke ${summary.broke}`,
    `same ${summary.same}`,
    ...(summary.changed > 0 ? [`changed ${summary.changed}`] : []),
    ...(summary.failed > 0 ? [`failed ${summary.failed}`] : []),
  ].join(", ");

/** "v4, stable v2"; just "v4" while no version is marked or the latest is the stable one. */
export const botVersionLabel = (bot: Pick<BotDefinition, "version" | "stableVersion">): string =>
  bot.stableVersion == null || bot.stableVersion === bot.version
    ? `v${bot.version}`
    : `v${bot.version}, stable v${bot.stableVersion}`;

/** Trigger changes seen since the watch started; a null trigger was deleted. */
export interface BotTriggerChanges {
  readonly triggers: ReadonlyMap<string, BotTrigger | null>;
  /** Firings newest first, per trigger. */
  readonly firings: ReadonlyMap<string, ReadonlyArray<BotTriggerFiring>>;
}

export const EMPTY_BOT_TRIGGER_CHANGES: BotTriggerChanges = {
  triggers: new Map(),
  firings: new Map(),
};

export const foldBotTriggerChange = (
  changes: BotTriggerChanges,
  change: BotTriggerChange,
): BotTriggerChanges => {
  switch (change._tag) {
    case "trigger":
      return {
        ...changes,
        triggers: new Map(changes.triggers).set(change.trigger.id, change.trigger),
      };
    case "trigger-deleted":
      return { ...changes, triggers: new Map(changes.triggers).set(change.triggerId, null) };
    case "firing": {
      const { firing } = change;
      const seen = (changes.firings.get(firing.triggerId) ?? []).filter(
        (candidate) => candidate.id !== firing.id,
      );
      return {
        ...changes,
        firings: new Map(changes.firings).set(firing.triggerId, [firing, ...seen]),
      };
    }
  }
};

/** Listed triggers with watched changes applied, oldest first like the server's list. */
export const applyTriggerChanges = (
  listed: ReadonlyArray<BotTrigger>,
  changes: BotTriggerChanges,
  botId?: string,
): ReadonlyArray<BotTrigger> => {
  const merged = new Map(listed.map((trigger) => [trigger.id, trigger]));
  for (const [id, trigger] of changes.triggers) {
    if (trigger === null) merged.delete(id);
    else if (botId === undefined || trigger.botId === botId) merged.set(id, trigger);
  }
  return [...merged.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
};

/** A page of firings with watched ones in front, without repeats. */
export const applyFiringChanges = (
  listed: ReadonlyArray<BotTriggerFiring>,
  changes: BotTriggerChanges,
  triggerId: string,
): ReadonlyArray<BotTriggerFiring> => {
  const watched = changes.firings.get(triggerId) ?? [];
  const byId = new Map(watched.map((firing) => [firing.id, firing]));
  return [...watched, ...listed.filter((firing) => !byId.has(firing.id))];
};

/** Pipeline changes seen since the watch started; a null pipeline was deleted. */
export interface BotPipelineChanges {
  readonly pipelines: ReadonlyMap<string, BotPipeline | null>;
  readonly runs: ReadonlyMap<string, BotPipelineRun>;
  readonly attempts: ReadonlyMap<string, ReadonlyMap<number, BotPipelineAttempt>>;
}

export const EMPTY_BOT_PIPELINE_CHANGES: BotPipelineChanges = {
  pipelines: new Map(),
  runs: new Map(),
  attempts: new Map(),
};

export const foldBotPipelineChange = (
  changes: BotPipelineChanges,
  change: BotPipelineChange,
): BotPipelineChanges => {
  switch (change._tag) {
    case "pipeline":
      return {
        ...changes,
        pipelines: new Map(changes.pipelines).set(change.pipeline.id, change.pipeline),
      };
    case "pipeline-deleted":
      return { ...changes, pipelines: new Map(changes.pipelines).set(change.pipelineId, null) };
    case "pipeline-run":
      return { ...changes, runs: new Map(changes.runs).set(change.run.id, change.run) };
    case "pipeline-attempt": {
      const attempts = new Map(changes.attempts.get(change.pipelineRunId)).set(
        change.attempt.seq,
        change.attempt,
      );
      return {
        ...changes,
        attempts: new Map(changes.attempts).set(change.pipelineRunId, attempts),
      };
    }
  }
};

/** Listed pipelines with watched changes applied, oldest first like the server's list. */
export const applyPipelineChanges = (
  listed: ReadonlyArray<BotPipeline>,
  changes: BotPipelineChanges,
): ReadonlyArray<BotPipeline> => {
  const merged = new Map(listed.map((pipeline) => [pipeline.id, pipeline]));
  for (const [id, pipeline] of changes.pipelines) {
    if (pipeline === null) merged.delete(id);
    else merged.set(id, pipeline);
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
};

/** A page of pipeline runs with watched progress applied; new runs join the first page. */
export const applyPipelineRunChanges = (
  listed: ReadonlyArray<BotPipelineRun>,
  changes: BotPipelineChanges,
  options: { readonly pipelineId?: string | undefined; readonly includeNew: boolean },
): ReadonlyArray<BotPipelineRun> => {
  const merged = new Map(listed.map((run) => [run.id, run]));
  for (const [id, run] of changes.runs) {
    if (merged.has(id)) merged.set(id, run);
    else if (
      options.includeNew &&
      (options.pipelineId === undefined || run.pipelineId === options.pipelineId)
    )
      merged.set(id, run);
  }
  return [...merged.values()].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
};

/** One pipeline run as fetched, with its watched state and attempts applied, in order. */
export const applyPipelineAttemptChanges = (
  fetched: { readonly run: BotPipelineRun; readonly attempts: ReadonlyArray<BotPipelineAttempt> },
  changes: BotPipelineChanges,
): { readonly run: BotPipelineRun; readonly attempts: ReadonlyArray<BotPipelineAttempt> } => {
  const run = changes.runs.get(fetched.run.id) ?? fetched.run;
  const watched = changes.attempts.get(fetched.run.id);
  if (watched === undefined) return { run, attempts: fetched.attempts };
  const merged = new Map(fetched.attempts.map((attempt) => [attempt.seq, attempt]));
  for (const [seq, attempt] of watched) merged.set(seq, attempt);
  return { run, attempts: [...merged.values()].sort((left, right) => left.seq - right.seq) };
};

/** Bots live on one environment, which runs them; every request stays on that host. */
export function createBotsAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, { label: "loom:bots:list", tag: B.list }),
    listRuns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:list-runs",
      tag: B.listRuns,
    }),
    changes: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:bots:changes",
      tag: B.watch,
      transform: (stream) => stream.pipe(Stream.scan(() => EMPTY_BOTS_CHANGES, foldBotsChange)),
    }),
    save: createEnvironmentRpcCommand(runtime, { label: "loom:bots:save", tag: B.save }),
    archive: createEnvironmentRpcCommand(runtime, { label: "loom:bots:archive", tag: B.archive }),
    delete: createEnvironmentRpcCommand(runtime, { label: "loom:bots:delete", tag: B.delete }),
    run: createEnvironmentRpcCommand(runtime, { label: "loom:bots:run", tag: B.run }),
    cancel: createEnvironmentRpcCommand(runtime, { label: "loom:bots:cancel", tag: B.cancel }),
    inbox: createEnvironmentRpcQueryAtomFamily(runtime, { label: "loom:bots:inbox", tag: B.inbox }),
    usage: createEnvironmentRpcQueryAtomFamily(runtime, { label: "loom:bots:usage", tag: B.usage }),
    retry: createEnvironmentRpcCommand(runtime, { label: "loom:bots:retry", tag: B.retry }),
    dismiss: createEnvironmentRpcCommand(runtime, { label: "loom:bots:dismiss", tag: B.dismiss }),
    promote: createEnvironmentRpcCommand(runtime, { label: "loom:bots:promote", tag: B.promote }),
    listStarters: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:list-starters",
      tag: B.listStarters,
    }),
    restoreStarter: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:restore-starter",
      tag: B.restoreStarter,
    }),
    previewBatch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:preview-batch",
      tag: BB.previewBatch,
    }),
    listBatches: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:list-batches",
      tag: BB.listBatches,
    }),
    getBatch: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:get-batch",
      tag: BB.getBatch,
    }),
    batchReport: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:batch-report",
      tag: BB.batchReport,
    }),
    batchChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:bots:batch-changes",
      tag: BB.watchBatches,
      transform: (stream) =>
        stream.pipe(Stream.scan(() => EMPTY_BOT_BATCH_CHANGES, foldBotBatchChange)),
    }),
    runBatch: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:run-batch",
      tag: BB.runBatch,
    }),
    cancelBatch: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:cancel-batch",
      tag: BB.cancelBatch,
    }),
    retryBatch: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:retry-batch",
      tag: BB.retryBatch,
    }),
    draftFromThread: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:draft-from-thread",
      tag: BD.draftFromThread,
    }),
    refineDraft: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:refine-draft",
      tag: BD.refineDraft,
    }),
    suggestions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:suggestions",
      tag: BD.suggestions,
    }),
    dismissSuggestion: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:dismiss-suggestion",
      tag: BD.dismissSuggestion,
    }),
    listTriggers: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:list-triggers",
      tag: BT.listTriggers,
    }),
    triggerFirings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:trigger-firings",
      tag: BT.triggerFirings,
    }),
    triggerChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:bots:trigger-changes",
      tag: BT.watchTriggers,
      transform: (stream) =>
        stream.pipe(Stream.scan(() => EMPTY_BOT_TRIGGER_CHANGES, foldBotTriggerChange)),
    }),
    saveTrigger: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:save-trigger",
      tag: BT.saveTrigger,
    }),
    deleteTrigger: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:delete-trigger",
      tag: BT.deleteTrigger,
    }),
    setTriggerEnabled: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:set-trigger-enabled",
      tag: BT.setTriggerEnabled,
    }),
    repinTrigger: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:repin-trigger",
      tag: BT.repinTrigger,
    }),
    testTrigger: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:test-trigger",
      tag: BT.testTrigger,
    }),
    rotateTriggerToken: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:rotate-trigger-token",
      tag: BT.rotateTriggerToken,
    }),
    versions: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:versions",
      tag: BV.versions,
    }),
    version: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:version",
      tag: BV.version,
    }),
    setStable: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:set-stable",
      tag: BV.setStable,
    }),
    restoreVersion: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:restore-version",
      tag: BV.restoreVersion,
    }),
    replay: createEnvironmentRpcCommand(runtime, { label: "loom:bots:replay", tag: BV.replay }),
    getReplay: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:get-replay",
      tag: BV.getReplay,
    }),
    cancelReplay: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:cancel-replay",
      tag: BV.cancelReplay,
    }),
    rateRun: createEnvironmentRpcCommand(runtime, { label: "loom:bots:rate-run", tag: BV.rateRun }),
    suggestEdit: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:suggest-edit",
      tag: BV.suggestEdit,
    }),
    listPipelines: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:list-pipelines",
      tag: BP.listPipelines,
    }),
    checkPipeline: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:check-pipeline",
      tag: BP.checkPipeline,
    }),
    listPipelineRuns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:list-pipeline-runs",
      tag: BP.listPipelineRuns,
    }),
    getPipelineRun: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:get-pipeline-run",
      tag: BP.getPipelineRun,
    }),
    pipelineChanges: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:bots:pipeline-changes",
      tag: BP.watchPipelines,
      transform: (stream) =>
        stream.pipe(Stream.scan(() => EMPTY_BOT_PIPELINE_CHANGES, foldBotPipelineChange)),
    }),
    savePipeline: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:save-pipeline",
      tag: BP.savePipeline,
    }),
    deletePipeline: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:delete-pipeline",
      tag: BP.deletePipeline,
    }),
    runPipeline: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:run-pipeline",
      tag: BP.runPipeline,
    }),
    cancelPipelineRun: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:cancel-pipeline-run",
      tag: BP.cancelPipelineRun,
    }),
    resumePipelineRun: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:resume-pipeline-run",
      tag: BP.resumePipelineRun,
    }),
    share: createEnvironmentRpcCommand(runtime, { label: "loom:bots:share", tag: BA.share }),
    unshare: createEnvironmentRpcCommand(runtime, { label: "loom:bots:unshare", tag: BA.unshare }),
    syncLibrary: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:sync-library",
      tag: BA.syncLibrary,
    }),
    targets: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:targets",
      tag: BA.targets,
    }),
    vaultBindings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:vault-bindings",
      tag: BA.vaultBindings,
    }),
    bindVaultSlot: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:bind-vault-slot",
      tag: BA.bindVaultSlot,
    }),
    remoteSettings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:bots:remote-settings",
      tag: BA.remoteSettings,
    }),
    setRemoteSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:bots:set-remote-settings",
      tag: BA.setRemoteSettings,
    }),
  };
}
