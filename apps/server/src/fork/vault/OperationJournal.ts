import { ThreadId, RunId, NonNegativeInt, PositiveInt } from "@t3tools/contracts";
import {
  VAULT_APPROVAL_RETENTION_MS,
  VaultApprovalRetryInput,
  type VaultApprovalRecoveryStatus,
  type VaultApprovalRetryReport,
  VaultError,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as OpenBaoStore from "./OpenBaoStore.ts";

const Time = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Entry = Schema.Struct({
  requestId: VaultItemId,
  operationId: VaultItemId,
  threadId: ThreadId,
  runId: RunId,
  itemId: VaultItemId,
  itemVersion: PositiveInt,
  requestRevision: PositiveInt,
  digest: Digest,
  createdAt: Time,
  updatedAt: Time,
  retireAt: Time,
  revision: PositiveInt,
  state: Schema.Literals(["prepared", "reserved", "completed", "unknown", "cancelled"]),
  reservationId: Schema.NullOr(VaultItemId),
  outcome: Schema.NullOr(Schema.Literals(["succeeded", "failed", "unknown"])),
}).check(
  Schema.makeFilter(
    (entry) =>
      entry.retireAt > entry.createdAt &&
      entry.retireAt <= entry.createdAt + VAULT_APPROVAL_RETENTION_MS &&
      entry.updatedAt >= entry.createdAt &&
      entry.updatedAt < entry.retireAt &&
      (entry.state === "prepared"
        ? entry.reservationId === null && entry.outcome === null
        : entry.state === "cancelled"
          ? entry.reservationId === null && entry.outcome === null
          : entry.state === "reserved"
            ? entry.reservationId !== null && entry.outcome === null
            : entry.state === "unknown"
              ? entry.reservationId !== null && entry.outcome === "unknown"
              : entry.reservationId !== null &&
                (entry.outcome === "succeeded" || entry.outcome === "failed")),
  ),
);
const Journal = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  environmentId: Schema.String,
  revision: NonNegativeInt,
  entries: Schema.Array(Entry).check(Schema.isMaxLength(128)),
});
const Mutation = Schema.Struct({
  id: VaultItemId,
  expectedRevision: PositiveInt,
  reservationId: VaultItemId,
});
const Finish = Schema.Struct({
  ...Mutation.fields,
  outcome: Schema.Literals(["succeeded", "failed", "unknown"]),
});
const decodeJournal = Schema.decodeUnknownOption(Journal);
const encodeJournal = Schema.encodeEffect(Journal);
const decodeRetry = Schema.decodeUnknownEffect(VaultApprovalRetryInput);
const isMutation = Schema.is(Mutation),
  isFinish = Schema.is(Finish);
type Entry = typeof Entry.Type;
type Journal = typeof Journal.Type;
type Observation = {
  readonly entry: Entry;
  readonly canExecute: false;
  readonly automaticResumption: false;
  readonly allowOnceConsumption: false;
};
const AcquisitionTypeId: unique symbol = Symbol("OperationJournal.Acquisition");
type Acquisition = { readonly [AcquisitionTypeId]: true };
type Acquired = Observation & { readonly acquisition: Acquisition };
const observe = (entry: Entry): Observation => ({
  entry,
  canExecute: false,
  automaticResumption: false,
  allowOnceConsumption: false,
});

export class OperationJournal extends Context.Service<
  OperationJournal,
  {
    readonly status: (
      id: string,
      requester: ThreadId,
    ) => Effect.Effect<VaultApprovalRecoveryStatus, VaultError>;
    readonly previewRetry: (
      input: VaultApprovalRetryInput,
      requester: ThreadId,
    ) => Effect.Effect<VaultApprovalRetryReport, VaultError>;
    readonly prepare: (
      input: VaultApprovalRetryInput,
      requester: ThreadId,
    ) => Effect.Effect<Observation, VaultError>;
    readonly acquire: (
      input: VaultApprovalRetryInput,
      mutation: typeof Mutation.Type,
      requester: ThreadId,
    ) => Effect.Effect<Acquired, VaultError>;
    readonly checkAcquisition: (
      acquisition: Acquisition,
      requester: ThreadId,
    ) => Effect.Effect<Observation, VaultError>;
    readonly reserve: (
      input: VaultApprovalRetryInput,
      mutation: typeof Mutation.Type,
      requester: ThreadId,
    ) => Effect.Effect<Observation, VaultError>;
    readonly finish: (
      input: typeof Finish.Type,
      requester: ThreadId,
    ) => Effect.Effect<Observation, VaultError>;
    readonly reconcile: (id: string, requester: ThreadId) => Effect.Effect<Observation, VaultError>;
    readonly cancel: (
      id: string,
      expectedRevision: number,
      requester: ThreadId,
    ) => Effect.Effect<Observation, VaultError>;
  }
>()("t3/fork/vault/OperationJournal") {}

const make = Effect.gen(function* () {
  const store = yield* OpenBaoStore.OpenBaoStore;
  const access = yield* VaultAccess.VaultAccess;
  const identity = yield* ServerEnvironmentIdentity;
  const crypto = yield* Crypto.Crypto;
  const environmentId = yield* identity.getEnvironmentId;
  const namespace = yield* crypto.digest("SHA-256", new TextEncoder().encode(environmentId)).pipe(
    Effect.map(Hex.encode),
    Effect.mapError(() => new VaultError({ reason: "unavailable" })),
  );
  // This reserved non-project branch is covered by the existing profiles/* capability.
  const path = `environments/${namespace}/profiles/_operations/approval-journal-v1`;
  const load = Effect.fnUntraced(function* () {
    const stored = yield* store.read(path);
    if (!stored)
      return {
        value: { schemaVersion: 1, environmentId, revision: 0, entries: [] } as Journal,
        version: 0,
      };
    const decoded = decodeJournal(Redacted.value(stored.value));
    if (
      Option.isNone(decoded) ||
      decoded.value.environmentId !== environmentId ||
      new Set(decoded.value.entries.map((e) => e.requestId)).size !==
        decoded.value.entries.length ||
      new Set(decoded.value.entries.map((e) => `${e.threadId}:${e.runId}:${e.operationId}`))
        .size !== decoded.value.entries.length
    )
      return yield* new VaultError({ reason: "invalid-response" });
    return { value: decoded.value, version: stored.version };
  });
  const save = (value: Journal, version: number) =>
    encodeJournal(value).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      Effect.flatMap((encoded) => store.write(path, Redacted.make(encoded), version)),
    );
  const retained = (value: Journal, now: number) => value.entries.filter((e) => now < e.retireAt);
  const own = (value: Journal, id: string, requester: ThreadId, now: number) => {
    const entry = retained(value, now).find((e) => e.requestId === id && e.threadId === requester);
    return entry ? Effect.succeed(entry) : Effect.fail(new VaultError({ reason: "not-found" }));
  };
  const validated = Effect.fnUntraced(function* (
    input: VaultApprovalRetryInput,
    requester: ThreadId,
  ) {
    const checked = yield* access.approvalPrepareRetry(input, requester);
    if (
      checked.retryState !== "policy-valid-recheck-adapter" ||
      !checked.status.request.waitingOperation
    )
      return yield* new VaultError({ reason: "denied" });
    return checked;
  });
  const matches = (entry: Entry, report: Effect.Success<ReturnType<typeof validated>>) =>
    entry.digest === report.operationDigest &&
    entry.requestId === report.status.request.id &&
    entry.threadId === report.status.request.threadId &&
    entry.itemId === report.status.request.itemId &&
    entry.operationId === report.status.request.waitingOperation?.operationId &&
    entry.requestRevision === report.status.request.revision &&
    entry.runId === report.status.request.waitingOperation?.runId &&
    entry.itemVersion === report.status.request.itemVersion;
  const update = Effect.fnUntraced(function* (
    id: string,
    requester: ThreadId,
    change: (entry: Entry, now: number) => Effect.Effect<Entry, VaultError>,
  ) {
    // Ownership is rechecked against the durable request, never inferred from a journal ID.
    yield* access.approvalStatus(id, requester);
    for (let attempt = 0; attempt < 4; attempt++) {
      const { value, version } = yield* load();
      const now = yield* Clock.currentTimeMillis;
      const entry = yield* own(value, id, requester, now);
      const changed = yield* change(entry, now);
      if (changed === entry) return observe(entry);
      yield* access.approvalStatus(id, requester);
      const saved = yield* save(
        {
          ...value,
          revision: value.revision + 1,
          entries: retained(value, now).map((e) => (e.requestId === id ? changed : e)),
        },
        version,
      ).pipe(Effect.result);
      if (saved._tag === "Success") return observe(changed);
      if (saved.failure.reason !== "conflict") return yield* saved.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  const reconcile = (id: string, requester: ThreadId) =>
    update(id, requester, (entry, now) =>
      Effect.succeed(
        entry.state === "reserved"
          ? {
              ...entry,
              state: "unknown" as const,
              outcome: "unknown" as const,
              updatedAt: now,
              revision: entry.revision + 1,
            }
          : entry,
      ),
    );
  // Identity, not serialized content, owns a single-use observation in this service instance.
  const acquisitions = new WeakMap<
    Acquisition,
    {
      readonly input: VaultApprovalRetryInput;
      readonly entry: Entry;
      readonly requester: ThreadId;
    }
  >();
  const acquire = Effect.fn("OperationJournal.acquire")(function* (
    raw: VaultApprovalRetryInput,
    mutation: typeof Mutation.Type,
    requester: ThreadId,
  ) {
    if (!isMutation(mutation)) return yield* new VaultError({ reason: "invalid-input" });
    const claim = { ...mutation };
    const retry = structuredClone(
      yield* decodeRetry(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
      ),
    );
    if (claim.id !== retry.id) return yield* new VaultError({ reason: "invalid-input" });
    yield* access.approvalStatus(retry.id, requester);
    const { value, version } = yield* load();
    const entry = yield* own(value, retry.id, requester, yield* Clock.currentTimeMillis);
    if (entry.state === "reserved") {
      yield* reconcile(retry.id, requester);
      return yield* new VaultError({ reason: "conflict" });
    }
    if (entry.state !== "prepared" || entry.revision !== claim.expectedRevision)
      return yield* new VaultError({ reason: "conflict" });
    const report = yield* validated(retry, requester);
    if (!matches(entry, report)) return yield* new VaultError({ reason: "conflict" });
    const now = yield* Clock.currentTimeMillis;
    if (now >= entry.retireAt) return yield* new VaultError({ reason: "not-found" });
    const reserved: Entry = {
      ...entry,
      state: "reserved",
      reservationId: claim.reservationId,
      revision: entry.revision + 1,
      updatedAt: now,
    };
    const saved = yield* save(
      {
        ...value,
        revision: value.revision + 1,
        entries: retained(value, now).map((e) => (e.requestId === entry.requestId ? reserved : e)),
      },
      version,
    ).pipe(
      Effect.onInterrupt(() => reconcile(retry.id, requester).pipe(Effect.ignore)),
      Effect.result,
    );
    if (saved._tag === "Failure") {
      // Never retry a failed CAS into a fresh claim or reconstruct ownership from read-back.
      yield* reconcile(retry.id, requester);
      return yield* saved.failure;
    }
    const acquisition: Acquisition = Object.freeze({ [AcquisitionTypeId]: true });
    acquisitions.set(acquisition, { input: retry, entry: structuredClone(reserved), requester });
    return { ...observe(reserved), acquisition };
  });
  const prepare = Effect.fn("OperationJournal.prepare")(function* (
    raw: VaultApprovalRetryInput,
    requester: ThreadId,
  ) {
    const input = yield* decodeRetry(raw).pipe(
      Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
    );
    for (let attempt = 0; attempt < 4; attempt++) {
      const report = yield* validated(input, requester);
      const { value, version } = yield* load();
      const now = yield* Clock.currentTimeMillis;
      const entries = retained(value, now);
      const existing = entries.find((e) => e.requestId === input.id);
      if (existing) {
        if (existing.threadId !== requester || !matches(existing, report))
          return yield* new VaultError({ reason: "conflict" });
        return observe(existing);
      }
      const request = report.status.request,
        waiting = request.waitingOperation!;
      if (
        entries.length >= 128 ||
        entries.some(
          (e) =>
            e.threadId === requester &&
            e.runId === waiting.runId &&
            e.operationId === waiting.operationId,
        )
      )
        return yield* new VaultError({ reason: "conflict" });
      const entry: Entry = {
        requestId: input.id,
        operationId: waiting.operationId,
        threadId: requester,
        runId: waiting.runId,
        itemId: request.itemId,
        itemVersion: request.itemVersion,
        requestRevision: request.revision,
        digest: report.operationDigest,
        createdAt: now,
        updatedAt: now,
        retireAt: request.requestedAt + VAULT_APPROVAL_RETENTION_MS,
        revision: 1,
        state: "prepared",
        reservationId: null,
        outcome: null,
      };
      const fresh = yield* validated(input, requester);
      if (fresh.operationDigest !== report.operationDigest)
        return yield* new VaultError({ reason: "conflict" });
      const saved = yield* save(
        { ...value, revision: value.revision + 1, entries: [...entries, entry] },
        version,
      ).pipe(Effect.result);
      if (saved._tag === "Success") return observe(entry);
      if (saved.failure.reason !== "conflict") return yield* saved.failure;
    }
    return yield* new VaultError({ reason: "conflict" });
  });
  const recoveryStatus = Effect.fn("OperationJournal.status")(function* (
    id: string,
    requester: ThreadId,
  ): Effect.fn.Return<VaultApprovalRecoveryStatus, VaultError> {
    // Authorize before touching the shared journal, even if it is corrupt or unavailable.
    yield* access.approvalStatus(id, requester);
    const { value } = yield* load();
    const status = yield* access.approvalStatus(id, requester);
    const entry = retained(value, status.checkedAt).find((e) => e.requestId === id);
    if (
      entry &&
      (entry.threadId !== requester ||
        entry.operationId !== status.request.waitingOperation?.operationId ||
        entry.runId !== status.request.waitingOperation?.runId ||
        entry.itemId !== status.request.itemId ||
        entry.itemVersion !== status.request.itemVersion)
    )
      return yield* new VaultError({ reason: "invalid-response" });
    const recoveryState = !entry
      ? ("no-retained-evidence" as const)
      : entry.state === "prepared"
        ? ("prepared-only" as const)
        : entry.state === "reserved" || entry.state === "unknown"
          ? ("requires-outcome-review" as const)
          : entry.state;
    const nextStep =
      recoveryState === "requires-outcome-review"
        ? ("inspect-outcome" as const)
        : recoveryState === "prepared-only" &&
            status.operationState === "retry-requires-explicit-operation"
          ? ("prepare-explicit-operation" as const)
          : ("review-history" as const);
    return {
      status,
      journal: entry
        ? {
            state: entry.state,
            revision: entry.revision,
            operationDigest: entry.digest,
            updatedAt: entry.updatedAt,
            retireAt: entry.retireAt,
            outcome: entry.outcome,
          }
        : null,
      recoveryState,
      nextStep,
      guidance:
        recoveryState === "requires-outcome-review"
          ? "Inspect the external outcome before proposing another operation. A reservation can outlive a lost reply; do not replay it. This read does not reconcile or execute."
          : recoveryState === "no-retained-evidence"
            ? "No retained journal evidence is available. Missing or aged evidence does not prove that an external operation never ran. Review history before a new explicit proposal."
            : recoveryState === "prepared-only"
              ? "Preparation records intent only. Review current request status and prepare a separately explicit operation with fresh access and adapter checks. Execution remains disabled."
              : "This is historical evidence, not current access or permission to retry. Review the outcome and current request before proposing new work.",
      canExecute: false,
      automaticResumption: false,
      allowOnceConsumption: false,
    };
  });
  return OperationJournal.of({
    status: recoveryStatus,
    previewRetry: Effect.fn("OperationJournal.previewRetry")(function* (input, requester) {
      const report = yield* access.approvalPrepareRetry(input, requester);
      const recovery = yield* recoveryStatus(input.id, requester);
      const result = { ...report, status: recovery.status, recovery };
      if (
        report.status.request.revision !== recovery.status.request.revision ||
        report.status.operationState !== recovery.status.operationState
      )
        return {
          ...result,
          retryState: "context-changed",
          nextStep: "refresh-request",
          repair:
            "Request context changed while reading recovery evidence. Refresh the request and prepare again.",
        };
      // Preserve policy/operation denials; journal history can only narrow an otherwise valid proposal.
      if (
        report.retryState !== "policy-valid-recheck-adapter" &&
        report.retryState !== "requires-outcome-review"
      )
        return result;
      const entry = recovery.journal;
      if (!entry) return result;
      if (entry.state === "cancelled")
        return {
          ...result,
          retryState: "blocked-request",
          nextStep: "request-new-approval",
          repair:
            "This operation preparation was cancelled. Review its history and use a new request and operation reference; do not reopen it.",
        };
      if (entry.state !== "prepared")
        return {
          ...result,
          retryState: "requires-outcome-review",
          nextStep: "inspect-outcome",
          repair:
            "Durable history records a reservation or terminal outcome. Inspect the external result before proposing new work. A caller-reported not-started outcome cannot override this evidence.",
        };
      if (entry.operationDigest !== report.operationDigest)
        return {
          ...result,
          retryState: "operation-changed",
          nextStep: "review-operation",
          repair:
            "This proposal differs from the retained preparation. Review the change and request new approval; do not reuse the old operation reference.",
        };
      return result;
    }),
    prepare,
    acquire,
    checkAcquisition: (acquisition, requester) =>
      Effect.suspend(() => {
        const held = acquisitions.get(acquisition);
        // Burn before any asynchronous check, including refusal or interruption.
        acquisitions.delete(acquisition);
        if (!held || held.requester !== requester)
          return Effect.fail(new VaultError({ reason: "denied" }));
        return Effect.gen(function* () {
          yield* access.approvalStatus(held.input.id, requester);
          const { value, version } = yield* load();
          const entry = yield* own(value, held.input.id, requester, yield* Clock.currentTimeMillis);
          if (
            entry.state !== "reserved" ||
            entry.revision !== held.entry.revision ||
            entry.reservationId !== held.entry.reservationId ||
            entry.digest !== held.entry.digest ||
            entry.operationId !== held.entry.operationId ||
            entry.retireAt !== held.entry.retireAt
          )
            return yield* new VaultError({ reason: "conflict" });
          const report = yield* validated(held.input, requester);
          if (!matches(entry, report)) return yield* new VaultError({ reason: "conflict" });
          const current = yield* load();
          const observed = yield* own(
            current.value,
            held.input.id,
            requester,
            yield* Clock.currentTimeMillis,
          );
          if (current.version !== version) return yield* new VaultError({ reason: "conflict" });
          // This observation cannot authorize dispatch; all execution gates remain closed.
          return observe(observed);
        }).pipe(Effect.onError(() => reconcile(held.input.id, requester).pipe(Effect.ignore)));
      }),
    reserve: (raw, input, requester) =>
      Effect.gen(function* () {
        if (!isMutation(input) || input.id !== raw.id)
          return yield* new VaultError({ reason: "invalid-input" });
        const retry = yield* decodeRetry(raw).pipe(
          Effect.mapError(() => new VaultError({ reason: "invalid-input" })),
        );
        return yield* update(input.id, requester, (entry, now) =>
          Effect.gen(function* () {
            const report = yield* validated(retry, requester);
            if (!matches(entry, report)) return yield* new VaultError({ reason: "conflict" });
            if (
              entry.reservationId === input.reservationId &&
              entry.revision === input.expectedRevision + 1
            )
              return entry;
            if (entry.state !== "prepared" || entry.revision !== input.expectedRevision)
              return yield* new VaultError({ reason: "conflict" });
            return {
              ...entry,
              state: "reserved" as const,
              reservationId: input.reservationId,
              updatedAt: now,
              revision: entry.revision + 1,
            };
          }),
        );
      }),
    finish: (input, requester) => {
      if (!isFinish(input)) return Effect.fail(new VaultError({ reason: "invalid-input" }));
      return update(input.id, requester, (entry, now) => {
        if (entry.reservationId !== input.reservationId)
          return Effect.fail(new VaultError({ reason: "conflict" }));
        if (entry.revision === input.expectedRevision + 1 && entry.outcome === input.outcome)
          return Effect.succeed(entry);
        if (entry.state !== "reserved" || entry.revision !== input.expectedRevision)
          return Effect.fail(new VaultError({ reason: "conflict" }));
        return Effect.succeed({
          ...entry,
          state: input.outcome === "unknown" ? ("unknown" as const) : ("completed" as const),
          outcome: input.outcome,
          updatedAt: now,
          revision: entry.revision + 1,
        });
      });
    },
    reconcile,
    cancel: (id, expectedRevision, requester) =>
      update(id, requester, (entry, now) => {
        if (entry.state === "cancelled" && entry.revision === expectedRevision + 1)
          return Effect.succeed(entry);
        if (entry.state !== "prepared" || entry.revision !== expectedRevision)
          return Effect.fail(new VaultError({ reason: "conflict" }));
        return Effect.succeed({
          ...entry,
          state: "cancelled" as const,
          updatedAt: now,
          revision: entry.revision + 1,
        });
      }),
  });
});
export const layer = Layer.effect(OperationJournal, make);
