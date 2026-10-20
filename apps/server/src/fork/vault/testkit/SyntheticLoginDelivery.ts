import { VaultError, type VaultTestAccountLoginAdmission } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

// Test-only contract. No runtime layer imports this model or supplies real credentials.
type Broker = {
  readonly environmentId: string;
  readonly machineId: string;
  readonly application: string;
  readonly target: string;
  readonly origin: string;
  readonly online: boolean;
  readonly leaseUntil: number;
};
type Session = {
  readonly operationId: string;
  readonly machineId: string;
  readonly leaseId: string;
  readonly origin: string;
  readonly sessionId: string;
};
export type SyntheticLoginAdapter = {
  readonly observe: Effect.Effect<Broker, VaultError>;
  // Start must revalidate the registered binding at its own effect boundary and deduplicate by operationId.
  readonly start: (input: {
    readonly operationId: string;
    readonly admission: VaultTestAccountLoginAdmission;
  }) => Effect.Effect<Session, VaultError>;
  // Acknowledgement fences this operation, including a still-pending or lost start. Absence alone is insufficient.
  readonly cleanup: (operationId: string) => Effect.Effect<"fenced" | "unknown", VaultError>;
};
type State =
  | "pending"
  | "admitting"
  | "starting"
  | "active"
  | "closing"
  | "cleanup-required"
  | "closed"
  | "refused";
export const syntheticLoginDelivery = Effect.fnUntraced(function* (
  operationId: string,
  expected: { readonly environmentId: string; readonly machineId: string },
  prepared: {
    readonly report: VaultTestAccountLoginAdmission;
    readonly revalidate: Effect.Effect<void, VaultError>;
  },
  adapter: SyntheticLoginAdapter,
) {
  const state = yield* Ref.make<State>("pending");
  const denied = () => new VaultError({ reason: "denied" });
  const validate = Effect.gen(function* () {
    yield* prepared.revalidate;
    const broker = yield* adapter.observe;
    const admission = prepared.report;
    if (
      broker.environmentId !== expected.environmentId ||
      broker.machineId !== expected.machineId ||
      broker.application !== admission.collection.application ||
      broker.target !== admission.collection.target ||
      broker.origin !== admission.origin ||
      !broker.online
    )
      return yield* denied();
    yield* prepared.revalidate;
    const now = yield* Clock.currentTimeMillis;
    if (now >= Math.min(broker.leaseUntil, admission.expiresAt)) return yield* denied();
  });
  const cleanup = Effect.gen(function* () {
    const claimed = yield* Ref.modify(state, (current) =>
      current === "starting" || current === "active" || current === "cleanup-required"
        ? [true, "closing" as const]
        : [false, current],
    );
    if (!claimed) return;
    yield* Effect.gen(function* () {
      const outcome = yield* adapter.cleanup(operationId).pipe(Effect.result);
      yield* Ref.set(
        state,
        outcome._tag === "Success" && outcome.success === "fenced" ? "closed" : "cleanup-required",
      );
    }).pipe(
      Effect.onExit(() =>
        Ref.update(state, (current) => (current === "closing" ? "cleanup-required" : current)),
      ),
    );
  });
  return {
    snapshot: Ref.get(state),
    gates: {
      canDeliver: false as const,
      automaticResumption: false as const,
      allowOnceConsumption: false as const,
    },
    run: (callback: (sessionId: string) => Effect.Effect<void, VaultError>) =>
      Effect.gen(function* () {
        const claimed = yield* Ref.modify(state, (current) =>
          current === "pending" ? [true, "admitting" as const] : [false, current],
        );
        if (!claimed) return yield* denied();
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* validate;
            // Register cleanup before the external-start boundary, even when its result is lost or interrupted.
            yield* Effect.uninterruptible(
              Effect.gen(function* () {
                yield* Ref.set(state, "starting");
                yield* Effect.addFinalizer(() => cleanup);
              }),
            );
            const session = yield* adapter.start({ operationId, admission: prepared.report });
            if (
              session.operationId !== operationId ||
              session.machineId !== expected.machineId ||
              session.leaseId !== prepared.report.leaseId ||
              session.origin !== prepared.report.origin
            )
              return yield* denied();
            const activated = yield* Ref.modify(state, (current) =>
              current === "starting" ? [true, "active" as const] : [false, current],
            );
            if (!activated) return yield* denied();
            yield* validate;
            yield* callback(session.sessionId);
            yield* validate;
          }).pipe(
            Effect.onExit(() =>
              Ref.update(state, (current) => (current === "admitting" ? "refused" : current)),
            ),
          ),
        );
      }),
    // Reconciliation retries cleanup only. It never repeats start or marks a pool account clean.
    reconcile: cleanup,
  };
});
