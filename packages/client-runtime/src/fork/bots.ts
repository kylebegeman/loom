import {
  BOTS_BATCH_WS_METHODS as BB,
  BOTS_WS_METHODS as B,
  type BotBatch,
  type BotBatchChange,
  type BotBatchItem,
  type BotDefinition,
  type BotRun,
  type BotsChange,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import * as Stream from "effect/Stream";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
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
  };
}
