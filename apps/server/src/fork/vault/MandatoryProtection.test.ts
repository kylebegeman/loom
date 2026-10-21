import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { RunId, ThreadId } from "@t3tools/contracts";
import { VaultError } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import * as AccessPolicy from "./AccessPolicy.ts";
import { journalFixture } from "./OperationJournal.testkit.ts";

const decodeProtected = Schema.decodeUnknownSync(AccessPolicy.ProtectedPolicy);
const decodeLegacy = Schema.decodeUnknownOption(AccessPolicy.LegacyPolicy);
const fixture = Effect.gen(function* () {
  const f = yield* journalFixture;
  const path = [...f.records.keys()].find((key) => key.endsWith("/access-policy"))!;
  const legacy = f.records.get(path)!;
  const preview = yield* f.access.protectionMigrationPreview(
    {
      expectedPolicyRevision: (yield* f.access.snapshot).revision,
      selections: [{ itemId: f.itemId, itemVersion: 1, mode: "one-time" }],
    },
    "human",
    Effect.void,
  );
  // No production migration exists. The synthetic operator explicitly installs this preview.
  f.records.set(path, { value: Redacted.make(preview.proposal), version: legacy.version + 1 });
  const raw = () => decodeProtected(Redacted.value(f.records.get(path)!.value));
  const replace = (change: (policy: AccessPolicy.ProtectedPolicy) => unknown) => {
    const current = f.records.get(path)!;
    f.records.set(path, {
      value: Redacted.make(change(structuredClone(raw()))),
      version: current.version + 1,
    });
  };
  const proposal: AccessPolicy.IntentProposal = {
    requestId: f.input.id,
    expectedRequestRevision: 2,
    waitingOperationId: f.input.waitingOperationId,
    operation: f.input.operation,
  };
  const review = Effect.gen(function* () {
    const preview = yield* f.access.intentPreview(proposal, "human", Effect.void);
    const input: AccessPolicy.IntentReview = {
      ...proposal,
      id: yield* f.id,
      expectedPolicyRevision: preview.policyRevision,
      reviewedDigest: preview.binding.operationDigest,
      expiresAt: preview.expiresNoLaterThan,
    };
    const reviewed = yield* f.access.intentReview(input, "human", Effect.void);
    const reserve: AccessPolicy.IntentReservation = {
      ...proposal,
      id: input.id,
      expectedIntentRevision: reviewed.intent.revision,
      expectedPolicyRevision: (yield* f.access.snapshot).revision,
    };
    return { input, reviewed, reserve };
  });
  return { ...f, path, legacy, raw, replace, proposal, review };
});
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

it.effect(
  "previews migration without writing and retains the legacy runtime behavior until installed",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* journalFixture;
        const before = [...f.records.entries()];
        const preview = yield* f.access.protectionMigrationPreview(
          {
            expectedPolicyRevision: (yield* f.access.snapshot).revision,
            selections: [{ itemId: f.itemId, itemVersion: 1, mode: "one-time" }],
          },
          "human",
          Effect.void,
        );
        expect([...f.records.entries()]).toEqual(before);
        expect(preview.canMigrate).toBe(false);
        expect(preview.proposal).toMatchObject({
          schemaVersion: 4,
          environmentId: f.environmentId,
          intents: [],
        });
        expect(Option.isNone(decodeLegacy(preview.proposal))).toBe(true);
        yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination);
        expect(JSON.stringify(preview)).not.toContain("privateKey");
        expect(JSON.stringify(preview)).not.toContain("ssh-ed25519");
      }),
    ),
);
it.effect.each(["missing", "duplicate", "version", "policy", "agent", "permission"] as const)(
  "refuses a migration preview with %s evidence",
  (failure) =>
    run(
      Effect.gen(function* () {
        const f = yield* journalFixture;
        const before = [...f.records.entries()];
        const selections = [
          {
            itemId: f.itemId,
            itemVersion: failure === "version" ? 2 : 1,
            mode: "one-time" as const,
          },
        ];
        if (failure === "duplicate") selections.push(selections[0]!);
        const input = {
          expectedPolicyRevision:
            (yield* f.access.snapshot).revision + (failure === "policy" ? 1 : 0),
          selections: failure === "missing" ? [] : selections,
        };
        const failed = yield* f.access
          .protectionMigrationPreview(
            input,
            failure === "agent" ? `thread:${f.threadId}` : "human",
            failure === "permission"
              ? Effect.fail(new VaultError({ reason: "denied" }))
              : Effect.void,
          )
          .pipe(Effect.result);
        expect(failed._tag).toBe("Failure");
        expect([...f.records.entries()]).toEqual(before);
      }),
    ),
);
it.effect.each(["use", "reveal", "export", "manage", "delegate"] as const)(
  "refuses protected %s with a matching broad grant and no caller-selected fallback",
  (action) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const id = yield* f.id;
        yield* f.access.apply(
          {
            operationId: yield* f.id,
            expectedRevision: f.raw().revision,
            change: {
              type: "save",
              grant: {
                id,
                label: "Broad alternate",
                principal: { kind: "project", id: f.state.thread.projectId },
                itemIds: [f.itemId],
                actions: ["use", "reveal", "export", "manage", "delegate", "inspect"],
                projectId: null,
                destination: null,
                notBefore: 0,
                expiresAt: null,
                parentId: null,
              },
            },
          },
          "human",
        );
        const input = {
          threadId: f.threadId,
          itemId: f.itemId,
          action,
          destination: f.key.destination,
        };
        expect((yield* f.access.explain(input)).decision).toMatchObject({
          allowed: false,
          reason: "approval-required",
          grantId: null,
          lineage: [],
        });
        expect(
          (yield* f.access
            .require(f.threadId, f.itemId, action, f.key.destination)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        yield* f.access.require(f.threadId, f.itemId, "inspect", null);
        expect(f.raw().schemaVersion).toBe(4);
        expect(f.raw().credentialModes[0]!.mode).toBe("one-time");
      }),
    ),
);
it.effect("refuses administrator raw reveal and permits metadata inspection", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      expect((yield* f.core.inspect(f.itemId))?.version).toBe(1);
      expect(
        (yield* f.core.reveal({ id: f.itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      f.replace((policy) => ({ ...policy, credentialModes: [] }));
      expect(
        (yield* f.core.reveal({ id: f.itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f.access.explain({
          threadId: f.threadId,
          itemId: f.itemId,
          action: "use",
          destination: f.key.destination,
        })).decision.reason,
      ).toBe("classification-required");
    }),
  ),
);
it.effect("ordinary classified credentials retain grant checks and secret decoding", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      f.replace((policy) => ({
        ...policy,
        credentialModes: policy.credentialModes.map((mode) => ({ ...mode, mode: "ordinary" })),
      }));
      yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination);
      expect(
        Redacted.value((yield* f.core.reveal({ id: f.itemId, expectedVersion: 1 })).value),
      ).toContain("privateKey");
      expect(
        (yield* f.access.require(f.threadId, f.itemId, "use", "different").pipe(Effect.flip))
          .reason,
      ).toBe("denied");
    }),
  ),
);
it.effect("a reviewed and reserved intent grants no raw release or live execution", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reviewed, reserve } = yield* f.review;
      expect(reviewed).toMatchObject({
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
        intent: { state: "reviewed", reservationId: null },
      });
      const reserved = yield* f.access.intentReserve(reserve, f.threadId, Effect.void);
      expect(reserved).toMatchObject({
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
        intent: { state: "reserved", revision: 2 },
      });
      expect(reserved.intent.reservationId).toMatch(/^[a-f0-9]{32}$/);
      expect(
        (yield* f.access.intentReserve(reserve, f.threadId, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect(
        (yield* f.core.reveal({ id: f.itemId, expectedVersion: 1 }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(
        (yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination).pipe(Effect.flip))
          .reason,
      ).toBe("denied");
      const persisted = f.raw();
      expect(persisted.intents).toHaveLength(1);
      expect(decodeLegacy(persisted)._tag).toBe("None");
      expect(JSON.stringify(persisted.intents)).not.toContain('"argv"');
      expect(JSON.stringify(persisted.intents)).not.toContain("privateKey");
    }),
  ),
);
it.effect.each([
  "digest",
  "item",
  "destination",
  "version",
  "request",
  "waiting",
  "agent",
  "permission",
  "expiry",
] as const)("refuses an unreviewable %s proposal without modifying the policy", (failure) =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const preview = yield* f.access.intentPreview(f.proposal, "human", Effect.void);
      let input: AccessPolicy.IntentReview = {
        ...f.proposal,
        id: yield* f.id,
        expectedPolicyRevision: preview.policyRevision,
        reviewedDigest: preview.binding.operationDigest,
        expiresAt: preview.expiresNoLaterThan,
      };
      if (failure === "digest") input = { ...input, reviewedDigest: "0".repeat(64) };
      if (failure === "request") input = { ...input, expectedRequestRevision: 1 };
      if (failure === "waiting") input = { ...input, waitingOperationId: "f".repeat(32) };
      if (failure === "expiry") input = { ...input, expiresAt: preview.expiresNoLaterThan + 1 };
      if (input.operation.kind !== "ssh") throw new Error("SSH fixture required");
      const operation = input.operation;
      if (failure === "item")
        input = {
          ...input,
          operation: {
            ...operation,
            input: { ...operation.input, id: "e".repeat(32) },
          },
        };
      if (failure === "version")
        input = {
          ...input,
          operation: {
            ...operation,
            input: {
              ...operation.input,
              command: { ...operation.input.command, expectedVersion: 2 },
            },
          },
        };
      if (failure === "destination")
        input = {
          ...input,
          operation: {
            ...operation,
            target: { ...operation.target, hostname: "other.test" },
          },
        };
      const before = f.records.get(f.path);
      const result = yield* f.access
        .intentReview(
          input,
          failure === "agent" ? `thread:${f.threadId}` : "human",
          failure === "permission"
            ? Effect.fail(new VaultError({ reason: "denied" }))
            : Effect.void,
        )
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(f.records.get(f.path)).toEqual(before);
    }),
  ),
);
it.effect.each([
  "run",
  "item",
  "mode",
  "project",
  "runtime",
  "grant",
  "request",
  "expiry",
  "operation",
  "requester",
] as const)("revalidates %s before reservation", (change) =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reserve } = yield* f.review;
      if (change === "run")
        f.state.thread = { ...f.state.thread, activeRunId: RunId.make("replacement") };
      if (change === "project")
        f.state.thread = {
          ...f.state.thread,
          projectId: "other-project" as typeof f.state.thread.projectId,
        };
      if (change === "runtime") f.state.thread = { ...f.state.thread, interactionMode: "plan" };
      if (change === "item")
        yield* f.core.save(
          {
            id: f.itemId,
            operationId: yield* f.id,
            expectedVersion: 1,
            label: "Rotated",
            kind: "ssh-key",
          },
          "human",
        );
      if (change === "mode") f.replace((policy) => ({ ...policy, credentialModes: [] }));
      if (change === "grant")
        f.replace((policy) => ({
          ...policy,
          grants: policy.grants.map((grant) => ({ ...grant, state: "revoked" })),
        }));
      if (change === "request")
        f.replace((policy) => ({
          ...policy,
          approvals: policy.approvals!.map((entry) => ({
            ...entry,
            request: { ...entry.request, state: "revoked" },
          })),
        }));
      if (change === "expiry") yield* TestClock.adjust("5 minutes");
      let input = reserve;
      if (change === "operation" && reserve.operation.kind === "ssh")
        input = {
          ...reserve,
          operation: {
            ...reserve.operation,
            input: {
              ...reserve.operation.input,
              command: { ...reserve.operation.input.command, argv: ["false"] },
            },
          },
        };
      const before = f.records.get(f.path);
      const result = yield* f.access
        .intentReserve(
          input,
          change === "requester" ? ThreadId.make("other") : f.threadId,
          Effect.void,
        )
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(f.records.get(f.path)).toEqual(before);
    }),
  ),
);
it.effect("only the CAS winner reserves and a losing or copied result cannot retry", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reserve } = yield* f.review;
      const observed = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      f.faults.beforePolicyWrite = () =>
        Effect.gen(function* () {
          f.faults.beforePolicyWrite = null;
          yield* Deferred.succeed(observed, undefined);
          yield* Deferred.await(release);
        });
      const first = yield* f.access
        .intentReserve(reserve, f.threadId, Effect.void)
        .pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(observed);
      const winner = yield* f.access.intentReserve(reserve, f.threadId, Effect.void);
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(first))._tag).toBe("Failure");
      expect(f.raw().intents[0]!.reservationId).toBe(winner.intent.reservationId);
      expect(
        (yield* f.access
          .intentReserve(
            { ...reserve, expectedPolicyRevision: f.raw().revision, expectedIntentRevision: 2 },
            f.threadId,
            Effect.void,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }),
  ),
);
it.effect.each(["before", "after"] as const)(
  "never retries a lost %s-CAS acknowledgement",
  (phase) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const { reserve } = yield* f.review;
        const failure = () => Effect.fail(new VaultError({ reason: "unavailable" }));
        if (phase === "before") f.faults.beforePolicyWrite = failure;
        else f.faults.afterPolicyWrite = failure;
        expect(
          (yield* f.access.intentReserve(reserve, f.threadId, Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("unavailable");
        f.faults.beforePolicyWrite = null;
        f.faults.afterPolicyWrite = null;
        const status = yield* f.access.intentStatus(reserve.id, "human", Effect.void);
        expect(status.intent.state).toBe(phase === "before" ? "reviewed" : "reserved");
        if (phase === "after")
          expect(
            (yield* f.access.intentReserve(reserve, f.threadId, Effect.void).pipe(Effect.flip))
              .reason,
          ).toBe("conflict");
      }),
    ),
);
it.effect("revokes review, retains uncertain reservations and never refunds aged identities", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reserve } = yield* f.review;
      yield* f.access.intentReserve(reserve, f.threadId, Effect.void);
      const uncertain = yield* f.access.intentClose(
        { id: reserve.id, expectedIntentRevision: 2, expectedPolicyRevision: f.raw().revision },
        "human",
        Effect.void,
      );
      expect(uncertain.intent).toMatchObject({ state: "unknown", revision: 3 });
      yield* TestClock.adjust("2 days");
      yield* f.access.approvalRetain;
      expect(f.raw().approvals).toHaveLength(0);
      expect(f.raw().credentialModes[0]!.mode).toBe("one-time");
      expect(f.raw().intents[0]).toEqual(uncertain.intent);
      expect(
        (yield* f.access
          .intentClose(
            {
              id: reserve.id,
              expectedIntentRevision: 3,
              expectedPolicyRevision: f.raw().revision,
            },
            "human",
            Effect.void,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("conflict");
    }),
  ),
);
it.effect("expires an unused review without persisting or recreating an opportunity", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reserve } = yield* f.review;
      const before = f.records.get(f.path);
      yield* TestClock.adjust("5 minutes");
      expect((yield* f.access.intentStatus(reserve.id, "human", Effect.void)).intent.state).toBe(
        "expired",
      );
      expect(f.records.get(f.path)).toEqual(before);
      expect(
        (yield* f.access.intentReserve(reserve, f.threadId, Effect.void).pipe(Effect.flip)).reason,
      ).toBe("denied");
      const revoked = yield* f.access.intentClose(
        { id: reserve.id, expectedIntentRevision: 1, expectedPolicyRevision: f.raw().revision },
        "human",
        Effect.void,
      );
      expect(revoked.intent.state).toBe("revoked");
    }),
  ),
);
it.effect("refuses removing protection and keeps it across credential rotation", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      expect(
        (yield* f.access
          .credentialModeChange(
            {
              itemId: f.itemId,
              itemVersion: 1,
              mode: "ordinary",
              expectedPolicyRevision: f.raw().revision,
            },
            "human",
            Effect.void,
          )
          .pipe(Effect.flip)).reason,
      ).toBe("denied");
      yield* f.core.save(
        {
          id: f.itemId,
          expectedVersion: 1,
          operationId: yield* f.id,
          label: "Rotated",
          kind: "ssh-key",
        },
        "human",
      );
      expect(
        (yield* f.core.reveal({ id: f.itemId, expectedVersion: 2 }).pipe(Effect.flip)).reason,
      ).toBe("denied");
      expect(f.raw().credentialModes[0]!.mode).toBe("one-time");
    }),
  ),
);
it.effect.each([
  "missing-modes",
  "missing-intents",
  "foreign",
  "unknown",
  "duplicate-mode",
  "version",
  "duplicate-grant",
] as const)("fails closed to corrupt %s policy without rewriting it", (failure) =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const value: Record<string, unknown> = { ...f.raw() };
      if (failure === "missing-modes") delete value.credentialModes;
      if (failure === "missing-intents") delete value.intents;
      if (failure === "foreign") value.environmentId = "foreign";
      if (failure === "unknown") value.protection = "optional-bypass";
      if (failure === "duplicate-mode")
        value.credentialModes = [f.raw().credentialModes[0], f.raw().credentialModes[0]];
      if (failure === "version") value.schemaVersion = 5;
      if (failure === "duplicate-grant") value.grants = [f.raw().grants[0], f.raw().grants[0]];
      const before = f.records.get(f.path)!;
      f.records.set(f.path, { ...before, value: Redacted.make(value) });
      expect(
        (yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination).pipe(Effect.flip))
          .reason,
      ).toBe("invalid-response");
      expect(f.records.get(f.path)!.value).toEqual(Redacted.make(value));
      expect(
        (yield* f.core.reveal({ id: f.itemId, expectedVersion: 1 }).pipe(Effect.result))._tag,
      ).toBe("Failure");
    }),
  ),
);

it.effect(
  "classifies new credentials explicitly and permits only tightening an ordinary mode",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        f.replace((policy) => ({ ...policy, credentialModes: [] }));
        const input = {
          itemId: f.itemId,
          itemVersion: 1,
          expectedPolicyRevision: f.raw().revision,
          mode: "ordinary" as const,
        };
        const ordinary = yield* f.access.credentialModeChange(input, "human", Effect.void);
        expect(ordinary).toMatchObject({ itemId: f.itemId, mode: "ordinary", revision: 1 });
        yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination);
        const protectedMode = yield* f.access.credentialModeChange(
          { ...input, expectedPolicyRevision: f.raw().revision, mode: "one-time" },
          "human",
          Effect.void,
        );
        expect(protectedMode).toMatchObject({ mode: "one-time", revision: 2 });
        const before = f.records.get(f.path);
        expect(
          yield* f.access.credentialModeChange(
            { ...input, expectedPolicyRevision: f.raw().revision, mode: "one-time" },
            "human",
            Effect.void,
          ),
        ).toEqual(protectedMode);
        expect(f.records.get(f.path)).toEqual(before);
        expect(
          (yield* f.access
            .require(f.threadId, f.itemId, "use", f.key.destination)
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
      }),
    ),
);
it.effect.each(["review", "reserve"] as const)(
  "rechecks run identity after the %s authorization wait",
  (stage) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const preview = yield* f.access.intentPreview(f.proposal, "human", Effect.void);
        const input = {
          ...f.proposal,
          id: yield* f.id,
          expectedPolicyRevision: preview.policyRevision,
          reviewedDigest: preview.binding.operationDigest,
          expiresAt: preview.expiresNoLaterThan,
        };
        const prepared = stage === "reserve" ? yield* f.review : null;
        let checks = 0;
        const authorize = Effect.sync(() => {
          if (++checks === 2)
            f.state.thread = { ...f.state.thread, activeRunId: RunId.make("new-after-wait") };
        });
        const before = f.records.get(f.path);
        const result =
          stage === "review"
            ? yield* f.access.intentReview(input, "human", authorize).pipe(Effect.result)
            : yield* f.access
                .intentReserve(prepared!.reserve, f.threadId, authorize)
                .pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        expect(f.records.get(f.path)).toEqual(before);
      }),
    ),
);
it.effect("a concurrent grant revocation defeats an already-validated reservation CAS", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reserve, reviewed } = yield* f.review;
      const observed = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      f.faults.beforePolicyWrite = () =>
        Effect.gen(function* () {
          f.faults.beforePolicyWrite = null;
          yield* Deferred.succeed(observed, undefined);
          yield* Deferred.await(release);
        });
      const held = yield* f.access
        .intentReserve(reserve, f.threadId, Effect.void)
        .pipe(Effect.result, Effect.forkChild);
      yield* Deferred.await(observed);
      yield* f.access.apply(
        {
          operationId: yield* f.id,
          expectedRevision: f.raw().revision,
          change: { type: "state", id: reviewed.intent.binding.grantId, state: "revoked" },
        },
        "human",
      );
      yield* Deferred.succeed(release, undefined);
      expect((yield* Fiber.join(held))._tag).toBe("Failure");
      expect(f.raw().intents[0]!.state).toBe("reviewed");
      expect(
        f.raw().grants.find((grant) => grant.definition.id === reviewed.intent.binding.grantId)
          ?.state,
      ).toBe("revoked");
    }),
  ),
);
it.effect(
  "fresh equivalent grants cannot substitute for the exact human-reviewed grant revision",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const { reserve, reviewed } = yield* f.review;
        f.replace((policy) => ({
          ...policy,
          grants: policy.grants.map((grant) => ({ ...grant, revision: grant.revision + 1 })),
        }));
        const before = f.records.get(f.path);
        expect(
          (yield* f.access.intentReserve(reserve, f.threadId, Effect.void).pipe(Effect.flip))
            .reason,
        ).toBe("conflict");
        expect(f.records.get(f.path)).toEqual(before);
        expect(f.raw().intents[0]!.binding.grantRevision).toBe(
          reviewed.intent.binding.grantRevision,
        );
      }),
    ),
);
it.effect(
  "new requests preserve protection and intents; ordinary approve cannot claim protected use",
  () =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const { reserve } = yield* f.review;
        const id = yield* f.id;
        yield* f.access.approvalCreate(
          {
            id,
            threadId: f.threadId,
            itemId: f.itemId,
            action: "use",
            destination: f.key.destination,
          },
          `thread:${f.threadId}`,
          Effect.void,
        );
        expect(f.raw()).toMatchObject({ schemaVersion: 4, intents: [{ id: reserve.id }] });
        expect(
          (yield* f.access
            .approvalChange(
              {
                id,
                expectedRevision: 1,
                expectedPolicyRevision: f.raw().revision,
                operationId: yield* f.id,
                decision: "approve",
                durationMs: 300_000,
              },
              "human",
              Effect.void,
            )
            .pipe(Effect.flip)).reason,
        ).toBe("denied");
        const declined = yield* f.access.approvalChange(
          {
            id,
            expectedRevision: 1,
            expectedPolicyRevision: f.raw().revision,
            operationId: yield* f.id,
            decision: "deny",
            durationMs: 300_000,
          },
          "human",
          Effect.void,
        );
        expect(declined).toMatchObject({ state: "denied", grantId: null });
        expect(f.raw()).toMatchObject({ schemaVersion: 4, intents: [{ id: reserve.id }] });
      }),
    ),
);
it.effect("revoked or spent request identities cannot be reviewed into a second intent", () =>
  run(
    Effect.gen(function* () {
      const f = yield* fixture;
      const { reserve } = yield* f.review;
      yield* f.access.intentClose(
        { id: reserve.id, expectedIntentRevision: 1, expectedPolicyRevision: f.raw().revision },
        "human",
        Effect.void,
      );
      const before = f.records.get(f.path);
      expect((yield* f.review.pipe(Effect.flip)).reason).toBe("conflict");
      expect(f.records.get(f.path)).toEqual(before);
    }),
  ),
);
it.effect.each(["modes", "intents"] as const)(
  "refuses %s capacity without evicting protection or replay history",
  (capacity) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const { reviewed } = yield* f.review;
        const identity = (index: number) => (index + 1).toString(16).padStart(32, "0");
        if (capacity === "intents") {
          f.replace((policy) => ({
            ...policy,
            intents: Array.from({ length: 128 }, (_, index) => ({
              ...reviewed.intent,
              id: identity(index),
              binding: { ...reviewed.intent.binding, requestId: identity(index) },
            })),
          }));
          const before = f.records.get(f.path);
          expect((yield* f.review.pipe(Effect.flip)).reason).toBe("conflict");
          expect(f.records.get(f.path)).toEqual(before);
        } else {
          f.replace((policy) => ({
            ...policy,
            intents: [],
            credentialModes: Array.from({ length: 128 }, (_, index) => ({
              ...policy.credentialModes[0]!,
              itemId: identity(index),
            })),
          }));
          const before = f.records.get(f.path);
          expect(
            (yield* f.access
              .credentialModeChange(
                {
                  itemId: f.itemId,
                  itemVersion: 1,
                  expectedPolicyRevision: f.raw().revision,
                  mode: "one-time",
                },
                "human",
                Effect.void,
              )
              .pipe(Effect.flip)).reason,
          ).toBe("invalid-input");
          expect(f.records.get(f.path)).toEqual(before);
        }
      }),
    ),
);
it.effect.each(["probe", "git-probe", "launch"] as const)(
  "refuses protected %s before the synthetic execution adapter",
  (path) =>
    run(
      Effect.gen(function* () {
        const f = yield* fixture;
        const operation = f.input.operation;
        if (operation.kind === "github-api") throw new Error("Expected synthetic SSH operation");
        const failed =
          path === "probe"
            ? yield* f.ssh
                .probe({ id: f.itemId, expectedVersion: 1 }, Effect.void)
                .pipe(Effect.result)
            : path === "git-probe"
              ? yield* f.ssh
                  .verifyGit(
                    {
                      id: f.itemId,
                      expectedVersion: 1,
                      repository: "/owner/repo.git",
                    },
                    Effect.void,
                  )
                  .pipe(Effect.result)
              : yield* f.launch.admission(operation, f.threadId).pipe(Effect.result);
        expect(failed._tag).toBe("Failure");
        // journalFixture's execution adapter dies if called, so an ordinary failure proves no dispatch.
        if (failed._tag === "Failure")
          expect(failed.failure).toMatchObject({ _tag: "VaultError", reason: "denied" });
      }),
    ),
);
it.effect("withdraws an observation when migration inventory changes during authorization", () =>
  run(
    Effect.gen(function* () {
      const f = yield* journalFixture;
      let checks = 0;
      const result = yield* f.access
        .protectionMigrationPreview(
          {
            expectedPolicyRevision: (yield* f.access.snapshot).revision,
            selections: [{ itemId: f.itemId, itemVersion: 1, mode: "one-time" }],
          },
          "human",
          Effect.gen(function* () {
            if (++checks === 2)
              yield* f.core.save(
                {
                  id: f.itemId,
                  expectedVersion: 1,
                  operationId: yield* f.id,
                  kind: "ssh-key",
                  label: "changed-during-review",
                },
                "human",
              );
          }).pipe(Effect.mapError(() => new VaultError({ reason: "unavailable" }))),
        )
        .pipe(Effect.flip);
      expect(result.reason).toBe("conflict");
      expect(
        f.records.get([...f.records.keys()].find((key) => key.endsWith("/access-policy"))!)?.value,
      ).toBeDefined();
    }),
  ),
);
