import {
  LibraryError,
  type LibraryHistoryDelta,
  type LibraryThreadArchive,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";

const collections = [
  "runs",
  "attempts",
  "nodes",
  "subagents",
  "providerSessions",
  "providerThreads",
  "providerTurns",
  "runtimeRequests",
  "messages",
  "plans",
  "turnItems",
  "checkpointScopes",
  "checkpoints",
  "contextHandoffs",
  "contextTransfers",
  "visibleTurnItems",
] as const;

const retainedPrefix = (before: readonly unknown[], after: readonly unknown[]) => {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    Equal.equals(before[prefix], after[prefix])
  )
    prefix++;
  return prefix;
};

/** A sequence identifies immutable source history; the Library rewrites only syncedAt. */
export const createHistoryDelta = (before: LibraryThreadArchive, after: LibraryThreadArchive) => {
  const prefixes = Object.fromEntries(
    collections.map((field) => [
      field,
      retainedPrefix(before.projection[field], after.projection[field]),
    ]),
  ) as LibraryHistoryDelta["prefixes"];
  const receipts = retainedPrefix(before.receipts ?? [], after.receipts ?? []);
  return {
    delta: { baseSequence: before.summary.sequence, prefixes: { ...prefixes, receipts } },
    thread: {
      ...after,
      ...(after.receipts === undefined ? {} : { receipts: after.receipts.slice(receipts) }),
      projection: {
        ...after.projection,
        runs: after.projection.runs.slice(prefixes.runs),
        attempts: after.projection.attempts.slice(prefixes.attempts),
        nodes: after.projection.nodes.slice(prefixes.nodes),
        subagents: after.projection.subagents.slice(prefixes.subagents),
        providerSessions: after.projection.providerSessions.slice(prefixes.providerSessions),
        providerThreads: after.projection.providerThreads.slice(prefixes.providerThreads),
        providerTurns: after.projection.providerTurns.slice(prefixes.providerTurns),
        runtimeRequests: after.projection.runtimeRequests.slice(prefixes.runtimeRequests),
        messages: after.projection.messages.slice(prefixes.messages),
        plans: after.projection.plans.slice(prefixes.plans),
        turnItems: after.projection.turnItems.slice(prefixes.turnItems),
        checkpointScopes: after.projection.checkpointScopes.slice(prefixes.checkpointScopes),
        checkpoints: after.projection.checkpoints.slice(prefixes.checkpoints),
        contextHandoffs: after.projection.contextHandoffs.slice(prefixes.contextHandoffs),
        contextTransfers: after.projection.contextTransfers.slice(prefixes.contextTransfers),
        visibleTurnItems: after.projection.visibleTurnItems.slice(prefixes.visibleTurnItems),
      },
    },
  };
};

export const applyHistoryDelta = Effect.fn("LibraryHistoryDelta.apply")(function* (
  before: LibraryThreadArchive,
  tail: LibraryThreadArchive,
  delta: LibraryHistoryDelta,
) {
  if (
    before.window !== undefined ||
    tail.window !== undefined ||
    before.summary.sequence !== delta.baseSequence ||
    tail.summary.sequence <= delta.baseSequence ||
    before.summary.id !== tail.summary.id ||
    before.summary.environmentId !== tail.summary.environmentId ||
    before.summary.threadId !== tail.summary.threadId ||
    before.summary.projectId !== tail.summary.projectId ||
    before.summary.localProjectId !== tail.summary.localProjectId ||
    before.summary.workingCopyId !== tail.summary.workingCopyId ||
    before.summary.projectRevision !== tail.summary.projectRevision ||
    before.summary.resourceIds.join("\0") !== tail.summary.resourceIds.join("\0") ||
    collections.some(
      (field) =>
        !Number.isSafeInteger(delta.prefixes[field]) ||
        delta.prefixes[field] < 0 ||
        delta.prefixes[field] > before.projection[field].length,
    ) ||
    (delta.prefixes.receipts !== undefined &&
      (!Number.isSafeInteger(delta.prefixes.receipts) ||
        delta.prefixes.receipts < 0 ||
        delta.prefixes.receipts > (before.receipts ?? []).length))
  ) {
    return yield* new LibraryError({ reason: "sequence-conflict" });
  }
  const receipts =
    delta.prefixes.receipts === undefined
      ? before.receipts
      : [...(before.receipts ?? []).slice(0, delta.prefixes.receipts), ...(tail.receipts ?? [])];
  return {
    ...tail,
    ...(receipts === undefined || receipts.length === 0 ? {} : { receipts }),
    projection: {
      ...tail.projection,
      runs: [...before.projection.runs.slice(0, delta.prefixes.runs), ...tail.projection.runs],
      attempts: [
        ...before.projection.attempts.slice(0, delta.prefixes.attempts),
        ...tail.projection.attempts,
      ],
      nodes: [...before.projection.nodes.slice(0, delta.prefixes.nodes), ...tail.projection.nodes],
      subagents: [
        ...before.projection.subagents.slice(0, delta.prefixes.subagents),
        ...tail.projection.subagents,
      ],
      providerSessions: [
        ...before.projection.providerSessions.slice(0, delta.prefixes.providerSessions),
        ...tail.projection.providerSessions,
      ],
      providerThreads: [
        ...before.projection.providerThreads.slice(0, delta.prefixes.providerThreads),
        ...tail.projection.providerThreads,
      ],
      providerTurns: [
        ...before.projection.providerTurns.slice(0, delta.prefixes.providerTurns),
        ...tail.projection.providerTurns,
      ],
      runtimeRequests: [
        ...before.projection.runtimeRequests.slice(0, delta.prefixes.runtimeRequests),
        ...tail.projection.runtimeRequests,
      ],
      messages: [
        ...before.projection.messages.slice(0, delta.prefixes.messages),
        ...tail.projection.messages,
      ],
      plans: [...before.projection.plans.slice(0, delta.prefixes.plans), ...tail.projection.plans],
      turnItems: [
        ...before.projection.turnItems.slice(0, delta.prefixes.turnItems),
        ...tail.projection.turnItems,
      ],
      checkpointScopes: [
        ...before.projection.checkpointScopes.slice(0, delta.prefixes.checkpointScopes),
        ...tail.projection.checkpointScopes,
      ],
      checkpoints: [
        ...before.projection.checkpoints.slice(0, delta.prefixes.checkpoints),
        ...tail.projection.checkpoints,
      ],
      contextHandoffs: [
        ...before.projection.contextHandoffs.slice(0, delta.prefixes.contextHandoffs),
        ...tail.projection.contextHandoffs,
      ],
      contextTransfers: [
        ...before.projection.contextTransfers.slice(0, delta.prefixes.contextTransfers),
        ...tail.projection.contextTransfers,
      ],
      visibleTurnItems: [
        ...before.projection.visibleTurnItems.slice(0, delta.prefixes.visibleTurnItems),
        ...tail.projection.visibleTurnItems,
      ],
    },
  } satisfies LibraryThreadArchive;
});
