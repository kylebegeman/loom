import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import type { VaultGrant } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { journalFixture } from "./OperationJournal.testkit.ts";
import { evaluateVaultPolicy } from "./VaultPolicy.ts";

// Counterexamples and a candidate design model only. No runtime consumes these hypothetical fields.
const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);
const decodeRecord = Schema.decodeUnknownSync(UnknownRecord);
const decodeRecords = Schema.decodeUnknownSync(Schema.Array(UnknownRecord));
const grant = (id: string): VaultGrant => ({
  definition: {
    id,
    label: "Synthetic timed access",
    principal: { kind: "thread", id: "thread" },
    itemIds: ["a".repeat(32)],
    actions: ["use", "delegate"],
    projectId: "project",
    destination: "synthetic-target",
    notBefore: 0,
    expiresAt: 1000,
    parentId: null,
  },
  state: "active",
  revision: 1,
  createdBy: "human",
  updatedBy: "human",
});
const workload = { threadId: "thread", projectId: "project" };
const request = { itemId: "a".repeat(32), action: "use" as const, destination: "synthetic-target" };
const evaluate = (grants: readonly VaultGrant[]) =>
  evaluateVaultPolicy(grants, workload, request, 100, 1);

it("shows that hypothetical one-time fields do not constrain the real timed evaluator", () => {
  const timed = grant("b".repeat(32));
  const hypothetical = {
    ...timed,
    definition: { ...timed.definition, intent: { mode: "once", consumed: true } },
  };
  expect(evaluate([hypothetical]).allowed).toBe(true);
  expect(evaluate([hypothetical]).allowed).toBe(true);
});

it.each(["thread", "project", "delegated"] as const)(
  "shows that removing a consumed approval still permits a matching %s grant",
  (kind) => {
    const approval = grant("b".repeat(32));
    const alternate = grant("c".repeat(32));
    const parent = grant("d".repeat(32));
    const grants = [
      { ...approval, state: "revoked" as const },
      {
        ...alternate,
        definition: {
          ...alternate.definition,
          principal:
            kind === "project"
              ? { kind: "project" as const, id: "project" }
              : alternate.definition.principal,
          parentId: kind === "delegated" ? parent.definition.id : null,
        },
      },
      ...(kind === "delegated" ? [parent] : []),
    ];
    expect(evaluate(grants)).toMatchObject({ allowed: true, grantId: alternate.definition.id });
    expect(evaluate(grants.filter((g) => g.definition.id !== approval.definition.id)).allowed).toBe(
      true,
    );
  },
);

it.effect(
  "shows the actual format-3 reader accepts hypothetical intent and its writer erases it",
  () =>
    Effect.gen(function* () {
      const f = yield* journalFixture;
      const [path, stored] = [...f.records.entries()].find(([key]) =>
        key.endsWith("/access-policy"),
      )!;
      const policy = decodeRecord(Redacted.value(stored.value));
      const grants = decodeRecords(policy.grants);
      const approvals = decodeRecords(policy.approvals);
      const hypothetical = { mode: "once", consumed: true, minimumReader: "future" };
      f.records.set(path, {
        version: stored.version + 1,
        value: Redacted.make({
          ...policy,
          intent: hypothetical,
          grants: grants.map((g) => ({
            ...g,
            definition: {
              ...decodeRecord(g.definition),
              intent: hypothetical,
            },
          })),
          approvals: approvals.map((a) => ({
            ...a,
            request: {
              ...decodeRecord(a.request),
              intent: hypothetical,
            },
          })),
        }),
      });
      const input = {
        threadId: f.threadId,
        itemId: f.itemId,
        action: "use" as const,
        destination: f.key.destination,
      };
      expect((yield* f.access.explain(input)).decision.allowed).toBe(true);
      expect((yield* f.access.explain(input)).decision.allowed).toBe(true);
      // Normal audited authorization forces a real decode/encode/write through VaultAccess.
      yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination);
      const rewritten = Redacted.value(f.records.get(path)!.value);
      expect(rewritten).toMatchObject({ schemaVersion: 3 });
      expect(JSON.stringify(rewritten)).not.toContain('"intent"');
      expect((yield* f.access.explain(input)).decision.allowed).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "shows a future policy version fails closed in the actual current reader and writer",
  () =>
    Effect.gen(function* () {
      const f = yield* journalFixture;
      const [path, stored] = [...f.records.entries()].find(([key]) =>
        key.endsWith("/access-policy"),
      )!;
      const policy = decodeRecord(Redacted.value(stored.value));
      // Synthetic rejected record, never a production format change or migration.
      const unsupported = {
        version: stored.version + 1,
        value: Redacted.make({ ...policy, schemaVersion: 4 }),
      };
      f.records.set(path, unsupported);
      expect((yield* f.access.snapshot.pipe(Effect.flip)).reason).toBe("invalid-response");
      expect(
        (yield* f.access.require(f.threadId, f.itemId, "use", f.key.destination).pipe(Effect.flip))
          .reason,
      ).toBe("invalid-response");
      expect(f.records.get(path)).toEqual(unsupported);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

// Abstract eligibility evidence is supplied by a trusted future boundary, never by a caller flag.
// It models one request-bound adapter start, not global credential use or exactly-once effects.
type Candidate = {
  intent: "timed" | "once" | "missing" | "unsupported";
  reader: "aware" | "legacy";
  binding: "exact" | "changed";
  humanReviewedDigest: boolean;
  journal: "prepared" | "reserved" | "unknown" | "completed" | "missing" | "aged" | "corrupt";
  policy: "current" | "revoked" | "unavailable";
  ordinaryGrant: boolean;
};
const eligible = (input: Candidate) =>
  input.intent === "once" &&
  input.reader === "aware" &&
  input.binding === "exact" &&
  input.humanReviewedDigest &&
  input.journal === "prepared" &&
  input.policy === "current";
const candidate: Candidate = {
  intent: "once",
  reader: "aware",
  binding: "exact",
  humanReviewedDigest: true,
  journal: "prepared",
  policy: "current",
  ordinaryGrant: false,
};

it("models explicit one-time eligibility refusing unsupported evidence without timed-grant fallback", () => {
  let observations = 0;
  for (const intent of ["timed", "once", "missing", "unsupported"] as const)
    for (const reader of ["aware", "legacy"] as const)
      for (const binding of ["exact", "changed"] as const)
        for (const humanReviewedDigest of [true, false])
          for (const journal of [
            "prepared",
            "reserved",
            "unknown",
            "completed",
            "missing",
            "aged",
            "corrupt",
          ] as const)
            for (const policy of ["current", "revoked", "unavailable"] as const) {
              const input = {
                intent,
                reader,
                binding,
                humanReviewedDigest,
                journal,
                policy,
                ordinaryGrant: false,
              };
              const result = eligible(input);
              expect(eligible({ ...input, ordinaryGrant: true })).toBe(result);
              if (result) expect(input).toEqual(candidate);
              observations++;
            }
  expect(observations).toBe(672);
  expect(eligible(candidate)).toBe(true);
});
