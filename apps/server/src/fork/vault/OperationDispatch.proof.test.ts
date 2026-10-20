import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { journalFixture } from "./OperationJournal.testkit.ts";

// Executable design model only. No production dispatcher, adapter or gate uses these transitions.
type Caller = 0 | 1;
type State = "prepared" | "reserved" | "completed" | "unknown" | "cancelled";
type Action =
  | "read"
  | "claim"
  | "lost-claim"
  | "failed-claim"
  | "handoff"
  | "finish"
  | "crash"
  | "recover";
type Step =
  | { caller: Caller; action: Action }
  | {
      action:
        | "revoke"
        | "expire"
        | "context-change"
        | "outage"
        | "corrupt"
        | "restore"
        | "age-out"
        | "cancel-preparation";
    };
type Model = {
  version: number;
  state: State;
  owner: Caller | null;
  authority: "allowed" | "denied";
  store: "available" | "unavailable" | "corrupt";
  retained: boolean;
  clients: [
    { readVersion: number | null; ticket: boolean },
    { readVersion: number | null; ticket: boolean },
  ];
  externalStarts: number;
};
const initial = (): Model => ({
  version: 1,
  state: "prepared",
  owner: null,
  authority: "allowed",
  store: "available",
  retained: true,
  clients: [
    { readVersion: null, ticket: false },
    { readVersion: null, ticket: false },
  ],
  externalStarts: 0,
});
const advance = (
  previous: Model,
  step: Step,
  protocol: "candidate" | "closed" = "candidate",
): Model => {
  const next = structuredClone(previous);
  const invalidate = () => {
    for (const client of next.clients) client.ticket = false;
  };
  const reconcile = () => {
    if (next.state === "reserved" && next.store === "available" && next.retained) {
      next.state = "unknown";
      next.version++;
      invalidate();
    }
  };
  if (!("caller" in step)) {
    switch (step.action) {
      case "revoke":
      case "expire":
      case "context-change":
        next.authority = "denied";
        break;
      case "cancel-preparation":
        if (next.state === "prepared") {
          next.state = "cancelled";
          next.version++;
          invalidate();
        }
        break;
      case "age-out":
        next.retained = false;
        invalidate();
        break;
      case "outage":
        next.store = "unavailable";
        break;
      case "corrupt":
        next.store = "corrupt";
        break;
      case "restore":
        next.store = "available";
        break;
    }
    return next;
  }
  const client = next.clients[step.caller];
  switch (step.action) {
    case "read":
      client.readVersion =
        next.store === "available" && next.retained && next.state === "prepared"
          ? next.version
          : null;
      break;
    case "claim":
    case "lost-claim":
    case "failed-claim":
      client.ticket = false;
      if (next.store !== "available" || !next.retained || next.authority !== "allowed") break;
      if (next.state === "reserved") {
        reconcile();
        break;
      }
      if (
        step.action === "failed-claim" ||
        next.state !== "prepared" ||
        client.readVersion !== next.version
      )
        break;
      next.state = "reserved";
      next.version++;
      next.owner = step.caller;
      client.ticket = step.action === "claim";
      break;
    case "handoff": {
      const allowed =
        protocol === "candidate" &&
        client.ticket &&
        next.state === "reserved" &&
        next.owner === step.caller &&
        next.authority === "allowed" &&
        next.store === "available" &&
        next.retained;
      // The process-local opportunity is burned before the simulated adapter handoff, even on refusal.
      client.ticket = false;
      if (allowed) next.externalStarts++;
      break;
    }
    case "finish":
      if (
        next.state === "reserved" &&
        next.owner === step.caller &&
        next.externalStarts === 1 &&
        next.store === "available" &&
        next.retained
      ) {
        next.state = "completed";
        next.version++;
        invalidate();
      }
      break;
    case "crash":
      client.ticket = false;
      client.readVersion = null;
      break;
    case "recover":
      reconcile();
      break;
  }
  return next;
};
const interleave = <A>(left: readonly A[], right: readonly A[]): A[][] => {
  if (left.length === 0) return [[...right]];
  if (right.length === 0) return [[...left]];
  return [
    ...interleave(left.slice(1), right).map((tail) => [left[0]!, ...tail]),
    ...interleave(left, right.slice(1)).map((tail) => [right[0]!, ...tail]),
  ];
};
const attempt = (caller: Caller): Step[] =>
  (["read", "claim", "handoff", "finish"] as const).map((action) => ({ caller, action }));
const traces = interleave(attempt(0), attempt(1));
const check = (trace: Step[], protocol: "candidate" | "closed" = "candidate") => {
  let current = initial();
  for (const step of trace) {
    const before = current;
    current = advance(current, step, protocol);
    expect(current.externalStarts, JSON.stringify(trace)).toBeLessThanOrEqual(1);
    if (
      step.action === "handoff" &&
      (before.authority !== "allowed" ||
        before.store !== "available" ||
        !before.retained ||
        protocol === "closed")
    )
      expect(current.externalStarts).toBe(before.externalStarts);
    if (before.state === "unknown" || before.state === "completed" || before.state === "cancelled")
      expect(current.state).toBe(before.state);
  }
  return current;
};

it("models two competing callers, including duplicate handoff, without more than one external start", () => {
  const results = traces.map((trace) =>
    check([...trace, { caller: 0, action: "handoff" }, { caller: 1, action: "handoff" }]),
  );
  expect(traces).toHaveLength(70);
  expect(
    results.some((result) => result.state === "completed" && result.externalStarts === 1),
  ).toBe(true);
  expect(results.some((result) => result.state === "unknown" && result.externalStarts === 0)).toBe(
    true,
  );
});

it("models revocation, expiry, context change, corrupt/outage evidence and age-out at every handoff boundary", () => {
  const faults: Step[] = (
    [
      "revoke",
      "expire",
      "context-change",
      "outage",
      "corrupt",
      "age-out",
      "cancel-preparation",
    ] as const
  ).map((action) => ({ action }));
  for (const trace of traces) {
    for (const fault of faults) {
      for (let position = 0; position <= trace.length; position++) {
        check([...trace.slice(0, position), fault, ...trace.slice(position)]);
      }
    }
  }
});

it("models process loss at each stage and reconciles replay before any subsequent handoff", () => {
  for (const trace of traces) {
    for (const caller of [0, 1] as const) {
      for (let position = 0; position <= trace.length; position++) {
        const prefix = [...trace.slice(0, position), { caller, action: "crash" } as Step];
        const afterCrash = check(prefix).externalStarts;
        const result = check([
          ...prefix,
          { caller, action: "recover" },
          ...trace.slice(position),
          ...attempt(caller),
        ]);
        expect(result.externalStarts).toBeLessThanOrEqual(1);
        if (check(prefix).state !== "prepared") expect(result.externalStarts).toBe(afterCrash);
      }
    }
  }
});

it("models lost CAS acknowledgements and failed writes with no recovered dispatch opportunity", () => {
  const lost = check([
    { caller: 0, action: "read" },
    { caller: 0, action: "lost-claim" },
    ...attempt(0),
  ]);
  expect(lost).toMatchObject({ state: "unknown", externalStarts: 0 });
  const failed = check([
    { caller: 0, action: "read" },
    { caller: 0, action: "failed-claim" },
  ]);
  expect(failed).toMatchObject({ state: "prepared", externalStarts: 0 });
  const completed = check([...attempt(0), { caller: 0, action: "crash" }, ...attempt(0)]);
  expect(completed).toMatchObject({ state: "completed", externalStarts: 1 });
  const uncertain = check(
    attempt(0)
      .slice(0, 3)
      .concat({ caller: 0, action: "crash" }, { caller: 0, action: "recover" }, ...attempt(0)),
  );
  expect(uncertain).toMatchObject({ state: "unknown", externalStarts: 1 });
});

it("models closed gates refusing every candidate handoff even with a fresh CAS claim", () => {
  for (const trace of traces) expect(check(trace, "closed").externalStarts).toBe(0);
});

it.effect(
  "shows that real reserve replay is indistinguishable from acquisition and must reconcile first",
  () =>
    Effect.gen(function* () {
      const f = yield* journalFixture;
      yield* f.journal.prepare(f.input, f.threadId);
      const mutation = { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id };
      const first = yield* f.journal.reserve(f.input, mutation, f.threadId);
      const replay = yield* (yield* f.rebuild).reserve(f.input, mutation, f.threadId);
      expect(replay).toEqual(first);
      expect(replay).toMatchObject({
        canExecute: false,
        automaticResumption: false,
        allowOnceConsumption: false,
      });
      const reconciled = yield* f.journal.reconcile(f.input.id, f.threadId);
      expect(reconciled.entry.state).toBe("unknown");
      expect(
        (yield* f.journal.reserve(f.input, mutation, f.threadId).pipe(Effect.flip)).reason,
      ).toBe("conflict");
      expect((yield* f.journal.previewRetry(f.input, f.threadId)).retryState).toBe(
        "requires-outcome-review",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "shows that consuming a journal opportunity does not consume an existing timed grant",
  () =>
    Effect.gen(function* () {
      const f = yield* journalFixture;
      yield* f.journal.prepare(f.input, f.threadId);
      yield* f.journal.reserve(
        f.input,
        { id: f.input.id, expectedRevision: 1, reservationId: yield* f.id },
        f.threadId,
      );
      const explanation = yield* f.access.explain({
        threadId: f.threadId,
        itemId: f.itemId,
        action: "use",
        destination: f.key.destination,
      });
      expect(explanation.decision.allowed).toBe(true);
      expect((yield* f.journal.status(f.input.id, f.threadId)).canExecute).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it("models uncertain completion and restored storage without refunding the consumed opportunity", () => {
  const prefix: Step[] = [
    ...attempt(0).slice(0, 3),
    { action: "outage" },
    { caller: 0, action: "finish" },
  ];
  expect(check(prefix)).toMatchObject({ state: "reserved", externalStarts: 1 });
  expect(
    check([
      ...prefix,
      { action: "restore" },
      { caller: 0, action: "crash" },
      { caller: 0, action: "recover" },
      ...attempt(0),
      ...attempt(1),
    ]),
  ).toMatchObject({ state: "unknown", externalStarts: 1 });
  expect(
    check([
      { caller: 0, action: "read" },
      { caller: 0, action: "claim" },
      { action: "outage" },
      { caller: 0, action: "handoff" },
      { action: "restore" },
      { caller: 0, action: "handoff" },
    ]),
  ).toMatchObject({ externalStarts: 0 });
});
