import { VaultError, type VaultTestAccountLoginAdmission } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  syntheticLoginAdmissionScope,
  type syntheticLoginDelivery,
} from "./SyntheticLoginDelivery.ts";

// Test-only composition. Registration and reference authority must come from the owning broker.
export type SyntheticMailBinding = {
  readonly operationId: string;
  readonly environmentId: string;
  readonly machineId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly accountId: string;
  readonly itemId: string;
  readonly itemVersion: number;
  readonly leaseId: string;
  readonly application: string;
  readonly target: string;
  readonly origin: string;
  readonly readerItemId: string;
  readonly readerItemVersion: number;
  readonly correlationId: string;
  readonly expectedSender: string;
  readonly startedAt: number;
  readonly expiresAt: number;
};

// Fixed tuple order makes the echo independent of object property order. It is not authentication.
export const syntheticMailScope = (binding: SyntheticMailBinding) =>
  JSON.stringify([
    binding.operationId,
    binding.environmentId,
    binding.machineId,
    binding.threadId,
    binding.runId,
    binding.collectionId,
    binding.accountId,
    binding.itemId,
    binding.itemVersion,
    binding.leaseId,
    binding.application,
    binding.target,
    binding.origin,
    binding.readerItemId,
    binding.readerItemVersion,
    binding.correlationId,
    binding.expectedSender,
    binding.startedAt,
    binding.expiresAt,
  ]);

const Uid = Schema.Int.check(Schema.isGreaterThan(0));
const Observation = Schema.Struct({
  scope: Schema.String.check(Schema.isMaxLength(8192)),
  runId: Schema.String,
  recipient: Schema.String,
  folder: Schema.String,
  status: Schema.Literals([
    "found",
    "unusable-candidates",
    "incomplete-in-bounded-window",
    "pending-in-bounded-window",
  ]),
  uidValidity: Uid,
  uidNext: Uid,
  messageUids: Schema.Array(Uid).check(Schema.isMaxLength(3)),
  candidates: Schema.Array(
    Schema.Struct({
      uid: Uid,
      status: Schema.Literals(["unusable", "unclassified", "unavailable"]),
      reason: Schema.Literals([
        "invalid-mime",
        "too-many-mime-parts",
        "unsupported-text-encoding",
        "text-too-large",
        "message-too-large",
        "headers-too-large",
        "message-unavailable",
      ]),
    }),
  ).check(Schema.isMaxLength(64)),
  readOnly: Schema.Literal(true),
  senderAuthenticated: Schema.Literal(false),
  canReadLive: Schema.Literal(false),
  canExecute: Schema.Literal(false),
  automaticResumption: Schema.Literal(false),
  automaticVerification: Schema.Literal(false),
  allowOnceConsumption: Schema.Literal(false),
});
const decode = Schema.decodeUnknownEffect(Observation, { onExcessProperty: "error" });
export type SyntheticMailAdapter = {
  readonly reference: { readonly itemId: string; readonly itemVersion: number };
  readonly observe: Effect.Effect<SyntheticMailBinding, VaultError>;
  readonly authorize: Effect.Effect<void, VaultError>;
  // Recheck registration/authority at the actual read boundary; an earlier observation is insufficient.
  readonly read: (binding: SyntheticMailBinding) => Effect.Effect<unknown, VaultError>;
};

export const syntheticBrokerMail = Effect.fn("SyntheticBrokerMail.read")(function* (
  delivery: Effect.Success<ReturnType<typeof syntheticLoginDelivery>>,
  prepared: {
    readonly report: VaultTestAccountLoginAdmission;
    readonly revalidate: Effect.Effect<void, VaultError>;
    readonly owner: { readonly threadId: string; readonly runId: string };
  },
  registration: SyntheticMailBinding,
  mail: SyntheticMailAdapter,
) {
  const binding = Object.freeze({ ...registration });
  const admission = prepared.report;
  const denied = () => new VaultError({ reason: "denied" });
  if (
    syntheticLoginAdmissionScope(admission) !== delivery.binding.admissionScope ||
    binding.operationId !== delivery.binding.operationId ||
    binding.environmentId !== delivery.binding.environmentId ||
    binding.machineId !== delivery.binding.machineId ||
    binding.threadId !== prepared.owner.threadId ||
    binding.runId !== prepared.owner.runId ||
    binding.readerItemId !== mail.reference.itemId ||
    binding.readerItemVersion !== mail.reference.itemVersion ||
    binding.accountId !== admission.account.id ||
    binding.collectionId !== admission.collection.id ||
    binding.itemId !== admission.account.itemId ||
    binding.itemVersion !== admission.account.itemVersion ||
    binding.leaseId !== admission.leaseId ||
    binding.application !== admission.collection.application ||
    binding.target !== admission.collection.target ||
    binding.origin !== admission.origin ||
    !/^[a-f0-9]{32}$/.test(binding.correlationId) ||
    !/^[a-f0-9]{32}$/.test(binding.readerItemId) ||
    !Number.isSafeInteger(binding.readerItemVersion) ||
    binding.readerItemVersion < 1 ||
    !/^[a-z0-9][a-z0-9._+-]{0,63}@[a-z0-9][a-z0-9.-]{0,189}$/.test(binding.expectedSender) ||
    !Number.isSafeInteger(binding.startedAt) ||
    binding.startedAt < 0 ||
    !Number.isSafeInteger(binding.expiresAt) ||
    binding.expiresAt <= binding.startedAt ||
    binding.expiresAt > Math.min(admission.expiresAt, binding.startedAt + 900_000)
  )
    return yield* denied();
  const scope = syntheticMailScope(binding);
  const validate = Effect.gen(function* () {
    yield* prepared.revalidate;
    yield* mail.authorize;
    const current = yield* mail.observe;
    yield* prepared.revalidate;
    if (syntheticMailScope(current) !== scope) return yield* denied();
    const now = yield* Clock.currentTimeMillis;
    if (now < binding.startedAt || now >= binding.expiresAt) return yield* denied();
  });
  let result: typeof Observation.Type | undefined;
  yield* delivery.run(() =>
    Effect.gen(function* () {
      yield* validate;
      if ((yield* delivery.snapshot) !== "active") return yield* denied();
      const raw = yield* mail.read(binding);
      yield* validate;
      if ((yield* delivery.snapshot) !== "active") return yield* denied();
      const observed = yield* decode(raw).pipe(
        Effect.mapError(() => new VaultError({ reason: "unavailable" })),
      );
      const recipient = `vault+loom-${binding.correlationId}@begam.in`;
      const status =
        observed.messageUids.length > 0
          ? "found"
          : observed.candidates.some((candidate) => candidate.status === "unusable")
            ? "unusable-candidates"
            : observed.candidates.length > 0
              ? "incomplete-in-bounded-window"
              : "pending-in-bounded-window";
      if (
        observed.scope !== scope ||
        observed.runId !== binding.correlationId ||
        observed.recipient !== recipient ||
        (observed.folder !== `loom-${binding.correlationId}` && observed.folder !== "INBOX") ||
        observed.status !== status ||
        new Set([...observed.messageUids, ...observed.candidates.map((candidate) => candidate.uid)])
          .size !==
          observed.messageUids.length + observed.candidates.length ||
        [...observed.messageUids, ...observed.candidates.map((candidate) => candidate.uid)].some(
          (uid) => uid >= observed.uidNext || uid < Math.max(1, observed.uidNext - 64),
        )
      )
        return yield* denied();
      result = observed;
    }),
  );
  // Withhold even safe metadata if the session fence or authorization is unresolved after cleanup.
  if ((yield* delivery.snapshot) !== "closed")
    return yield* new VaultError({ reason: "unavailable" });
  yield* validate;
  if (!result) return yield* denied();
  return result;
});
