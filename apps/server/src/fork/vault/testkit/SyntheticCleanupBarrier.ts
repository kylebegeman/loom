import { VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

// Test-only controller; its store can be in memory or the gated durable ledger. No live provider is registered.
import {
  cleanupResourceKey,
  cleanupScopeKey,
  type CleanupScope,
  type CleanupTicket,
  type ResetIntent,
  type CleanupEntry,
  type CleanupState,
  type CleanupStore,
} from "../CleanupLedger.ts";
export { cleanupScopeKey } from "../CleanupLedger.ts";
export type {
  CleanupScope,
  CleanupTicket,
  ResetIntent,
  CleanupEntry,
  CleanupState,
  CleanupStore,
} from "../CleanupLedger.ts";

export type CleanupProvider = {
  // The provider admits at most one operation per generation, even after fencing that operation.
  readonly start: (ticket: CleanupTicket) => Effect.Effect<void, VaultError>;
  // A matching echo is correlation only. The trusted adapter must prove terminal fencing, not absence.
  readonly fence: (
    ticket: CleanupTicket,
  ) => Effect.Effect<
    { readonly ticket: CleanupTicket; readonly outcome: "fenced" | "unknown" },
    VaultError
  >;
  // Reset requires no active operation and advances generation atomically. A same-ID replay
  // is valid only while its target generation is current and has never admitted a start.
  readonly reset: (intent: ResetIntent) => Effect.Effect<ResetIntent, VaultError>;
};
const MAX_RESOURCES = 32;
const MAX_OPERATIONS = 128;
const MAX_RESET_IDS = MAX_RESOURCES + MAX_OPERATIONS;
const leaseKeyFor = (key: string, leaseId: string) => JSON.stringify([key, leaseId]);
const ticketKey = (ticket: CleanupTicket) =>
  JSON.stringify([
    cleanupScopeKey(ticket.scope),
    ticket.operationId,
    ticket.leaseId,
    ticket.runId,
    ticket.generation,
  ]);
const resetKey = (intent: ResetIntent) =>
  JSON.stringify([cleanupScopeKey(intent.scope), intent.resetId, intent.from, intent.to]);

export const syntheticCleanupBarrier = (
  registration: CleanupScope,
  store: CleanupStore,
  provider: CleanupProvider,
  authority: {
    readonly start: (input: {
      readonly operationId: string;
      readonly leaseId: string;
      readonly runId: string;
    }) => Effect.Effect<void, VaultError>;
    readonly maintain: Effect.Effect<void, VaultError>;
  },
) => {
  const scope = Object.freeze({ ...registration });
  const key = cleanupResourceKey(scope);
  const denied = () => new VaultError({ reason: "denied" });
  const load = Effect.gen(function* () {
    const state = yield* store.read;
    const entry = state.entries.get(key);
    if (!entry) return yield* new VaultError({ reason: "not-found" });
    if (cleanupScopeKey(entry.scope) !== cleanupScopeKey(scope)) return yield* denied();
    return { state, entry };
  });
  const write = (
    state: CleanupState,
    entry: CleanupEntry,
    additions: Partial<Pick<CleanupState, "operationIds" | "leaseIds" | "resetIds">> = {},
  ) =>
    store.cas(state.revision, {
      ...state,
      ...additions,
      revision: state.revision + 1,
      entries: new Map(state.entries).set(key, entry),
    });
  return {
    gates: {
      canExecute: false as const,
      canDeliver: false as const,
      canReset: false as const,
      canReuse: false as const,
      automaticResumption: false as const,
      allowOnceConsumption: false as const,
    },
    snapshot: load.pipe(Effect.map(({ entry }) => entry)),
    enroll: Effect.gen(function* () {
      yield* authority.maintain;
      const state = yield* store.read;
      if (state.entries.has(key)) {
        yield* load;
        return;
      }
      if (state.entries.size >= MAX_RESOURCES) return yield* denied();
      yield* write(state, {
        scope,
        phase: "quarantined",
        generation: 0,
        ticket: null,
        reset: null,
      });
    }),
    start: Effect.fn("SyntheticCleanupBarrier.start")(function* (input: {
      readonly operationId: string;
      readonly leaseId: string;
      readonly runId: string;
    }) {
      const { state, entry } = yield* load;
      yield* authority.start(input);
      const leaseKey = leaseKeyFor(key, input.leaseId);
      if (
        entry.phase !== "ready" ||
        state.operationIds.has(input.operationId) ||
        state.leaseIds.has(leaseKey) ||
        state.operationIds.size >= MAX_OPERATIONS
      )
        return yield* denied();
      const ticket: CleanupTicket = Object.freeze({
        ...input,
        scope,
        generation: entry.generation,
      });
      // An ambiguous intent acknowledgement must never be followed by external start.
      yield* write(
        state,
        { ...entry, phase: "uncertain", ticket, reset: null },
        {
          operationIds: new Set(state.operationIds).add(input.operationId),
          leaseIds: new Set(state.leaseIds).add(leaseKey),
        },
      );
      yield* authority.start(input);
      yield* provider.start(ticket);
      yield* authority.start(input);
      return ticket;
    }),
    cleanup: Effect.gen(function* () {
      const { state, entry } = yield* load;
      yield* authority.maintain;
      if (entry.phase === "fenced") return;
      if (entry.phase !== "uncertain" || !entry.ticket) return yield* denied();
      const receipt = yield* provider.fence(entry.ticket);
      if (receipt.outcome !== "fenced" || ticketKey(receipt.ticket) !== ticketKey(entry.ticket))
        return yield* new VaultError({ reason: "unavailable" });
      yield* authority.maintain;
      // Captured CAS prevents a delayed acknowledgement from changing a newer reset or reservation.
      yield* write(state, { ...entry, phase: "fenced" });
    }),
    reset: Effect.fn("SyntheticCleanupBarrier.reset")(function* (resetId: string) {
      let { state, entry } = yield* load;
      yield* authority.maintain;
      if (entry.phase !== "resetting") {
        if (
          (entry.phase !== "fenced" && entry.phase !== "quarantined") ||
          state.resetIds.has(resetId) ||
          state.resetIds.size >= MAX_RESET_IDS
        )
          return yield* denied();
        const intent: ResetIntent = Object.freeze({
          scope,
          resetId,
          from: entry.generation,
          to: entry.generation + 1,
        });
        yield* write(
          state,
          { ...entry, phase: "resetting", reset: intent },
          { resetIds: new Set(state.resetIds).add(resetId) },
        );
        ({ state, entry } = yield* load);
      }
      if (entry.phase !== "resetting" || !entry.reset || entry.reset.resetId !== resetId)
        return yield* denied();
      const intent = entry.reset;
      yield* authority.maintain;
      const receipt = yield* provider.reset(intent);
      if (resetKey(receipt) !== resetKey(intent))
        return yield* new VaultError({ reason: "unavailable" });
      yield* authority.maintain;
      yield* write(state, {
        ...entry,
        phase: "ready",
        generation: intent.to,
        ticket: null,
        reset: null,
      });
    }),
  };
};
