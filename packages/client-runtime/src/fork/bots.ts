import {
  BOTS_WS_METHODS as B,
  type BotDefinition,
  type BotRun,
  type BotsChange,
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
 * when they match its bot; older pages only update the runs they already hold.
 */
export const applyRunChanges = (
  listed: ReadonlyArray<BotRun>,
  changes: BotsChanges,
  options: { readonly botId?: string | undefined; readonly includeNew: boolean },
): ReadonlyArray<BotRun> => {
  const merged = new Map(listed.map((run) => [run.id, run]));
  for (const [id, run] of changes.runs) {
    if (merged.has(id)) merged.set(id, run);
    else if (options.includeNew && (options.botId === undefined || run.botId === options.botId))
      merged.set(id, run);
  }
  return [...merged.values()].sort(newestFirst);
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
  };
}
