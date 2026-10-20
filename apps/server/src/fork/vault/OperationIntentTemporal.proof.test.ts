import { expect, it } from "@effect/vitest";

// Test-local temporal model only. The coherent generation/commit below is an assumption to
// validate in a future implementation, not a storage field, available fence or runtime permit.
const components = ["classification", "coverage", "binding", "authority"] as const;
type Component = (typeof components)[number];
type Evidence = {
  generation: number;
  classification: "protected" | "ordinary" | "unavailable" | "unsupported";
  coverage: "complete" | "incomplete";
  binding: "reviewed" | "changed";
  authority: "current" | "revoked" | "expired" | "unavailable";
};
type Boundary = "handoff" | "callback";
type Protocol = "candidate" | "cached";
type Step = "begin" | Component | "validate" | "commit";
const steps: Step[] = ["begin", ...components, "validate", "commit"];
const baseline = (): Evidence => ({
  generation: 0,
  classification: "protected",
  coverage: "complete",
  binding: "reviewed",
  authority: "current",
});
const valid = (evidence: Evidence, component: Component) => {
  switch (component) {
    case "classification":
      return evidence.classification === "protected";
    case "coverage":
      return evidence.coverage === "complete";
    case "binding":
      return evidence.binding === "reviewed";
    case "authority":
      return evidence.authority === "current";
  }
};
type Model = {
  evidence: Evidence;
  phase: "fresh" | "active" | "retired";
  owner: boolean;
  expectedGeneration: number;
  reads: Partial<Record<Component, { generation: number; valid: boolean }>>;
  validated: boolean;
  starts: number;
  callbacks: number;
};
const initial = (boundary: Boundary): Model => ({
  evidence: baseline(),
  phase: boundary === "handoff" ? "fresh" : "active",
  owner: true,
  expectedGeneration: 0,
  reads: {},
  validated: false,
  starts: boundary === "handoff" ? 0 : 1,
  callbacks: 0,
});
const retire = (state: Model) => {
  state.phase = "retired";
  state.owner = false;
  state.validated = false;
};
const advance = (
  state: Model,
  boundary: Boundary,
  step: Step,
  protocol: Protocol = "candidate",
) => {
  if (state.phase === "retired") return;
  if (step === "begin") {
    state.reads = {};
    state.validated = false;
  } else if (step === "validate") {
    state.validated = components.every((component) => {
      const read = state.reads[component];
      return (
        read?.valid === true &&
        (protocol === "cached" || read.generation === state.expectedGeneration)
      );
    });
  } else if (step === "commit") {
    const observed = state.validated;
    state.validated = false;
    const current =
      state.evidence.generation === state.expectedGeneration &&
      components.every((component) => valid(state.evidence, component));
    if (
      !observed ||
      !state.owner ||
      (protocol === "candidate" && !current) ||
      state.phase !== (boundary === "handoff" ? "fresh" : "active")
    ) {
      retire(state);
      return;
    }
    if (boundary === "handoff") {
      state.phase = "active";
      state.starts++;
    } else state.callbacks++;
  } else
    state.reads[step] = {
      generation: state.evidence.generation,
      valid: valid(state.evidence, step),
    };
};
const change = (state: Model, patch: Partial<Omit<Evidence, "generation">>) => {
  state.evidence = { ...state.evidence, ...patch, generation: state.evidence.generation + 1 };
};
const restoreValues = (state: Model) => {
  const { generation: _, ...values } = baseline();
  change(state, values);
};
const hazards = [
  "declassify",
  "classification-outage",
  "unsupported-classification",
  "coverage-loss",
  "binding-change",
  "revoke",
  "expire",
  "authority-outage",
  "crash",
  "interrupt",
  "unknown-outcome",
] as const;
type Hazard = (typeof hazards)[number];
const disrupt = (state: Model, hazard: Hazard) => {
  switch (hazard) {
    case "declassify":
      return change(state, { classification: "ordinary" });
    case "classification-outage":
      return change(state, { classification: "unavailable" });
    case "unsupported-classification":
      return change(state, { classification: "unsupported" });
    case "coverage-loss":
      return change(state, { coverage: "incomplete" });
    case "binding-change":
      return change(state, { binding: "changed" });
    case "revoke":
      return change(state, { authority: "revoked" });
    case "expire":
      return change(state, { authority: "expired" });
    case "authority-outage":
      return change(state, { authority: "unavailable" });
    case "crash":
    case "interrupt":
    case "unknown-outcome":
      return retire(state);
  }
};
const run = (state: Model, boundary: Boundary, trace = steps, protocol: Protocol = "candidate") => {
  for (const step of trace) advance(state, boundary, step, protocol);
  expect(state.starts).toBeLessThanOrEqual(1);
  return state;
};
const observation = (state: Model) => ({
  phase: state.phase,
  canExecute: false as const,
  automaticResumption: false as const,
  allowOnceConsumption: false as const,
});

it("models a fresh handoff and separately revalidated callbacks without creating another start", () => {
  const state = run(initial("handoff"), "handoff");
  expect(state).toMatchObject({ phase: "active", starts: 1, callbacks: 0 });
  run(state, "callback");
  run(state, "callback");
  expect(state).toMatchObject({ phase: "active", starts: 1, callbacks: 2 });
  expect(observation(state)).toEqual({
    phase: "active",
    canExecute: false,
    automaticResumption: false,
    allowOnceConsumption: false,
  });
  run(state, "handoff");
  expect(state).toMatchObject({ phase: "retired", starts: 1, callbacks: 2 });
});

it("models hazards and value restoration at every asynchronous read/validate/commit boundary", () => {
  let schedules = 0;
  for (const boundary of ["handoff", "callback"] as const)
    for (const hazard of hazards)
      for (const restore of [false, true])
        for (let position = 0; position <= steps.length; position++) {
          const state = initial(boundary);
          run(state, boundary, steps.slice(0, position));
          const previous = { starts: state.starts, callbacks: state.callbacks };
          disrupt(state, hazard);
          if (restore) restoreValues(state);
          run(state, boundary, steps.slice(position));
          expect({ starts: state.starts, callbacks: state.callbacks }).toEqual(previous);
          // Fresh observations cannot resurrect the old attempt after a dependency transition.
          run(state, boundary);
          expect(state).toMatchObject({ phase: "retired", ...previous });
          expect(observation(state)).toMatchObject({
            canExecute: false,
            automaticResumption: false,
            allowOnceConsumption: false,
          });
          schedules++;
        }
  expect(schedules).toBe(352);
});

it.each(["handoff", "callback"] as const)(
  "shows cached validation is unsafe after a %s read and before commit",
  (boundary) => {
    const cached = run(initial(boundary), boundary, steps.slice(0, -1), "cached");
    const candidate = run(initial(boundary), boundary, steps.slice(0, -1));
    disrupt(cached, "coverage-loss");
    disrupt(candidate, "coverage-loss");
    advance(cached, boundary, "commit", "cached");
    advance(candidate, boundary, "commit");
    expect(boundary === "handoff" ? cached.starts : cached.callbacks).toBe(1);
    expect(boundary === "handoff" ? candidate.starts : candidate.callbacks).toBe(0);
    expect(candidate.phase).toBe("retired");
  },
);

it("shows individually valid reads can assemble authority that never existed together", () => {
  const mixed = (protocol: Protocol) => {
    const state = initial("handoff");
    change(state, { coverage: "incomplete" });
    run(state, "handoff", ["begin", "classification"], protocol);
    change(state, { classification: "ordinary" });
    change(state, { coverage: "complete" });
    run(state, "handoff", ["coverage", "binding", "authority", "validate", "commit"], protocol);
    return state;
  };
  expect(mixed("cached").starts).toBe(1);
  expect(mixed("candidate")).toMatchObject({ phase: "retired", starts: 0 });
});

it.each(["classification", "coverage", "binding"] as const)(
  "models %s ABA transitions invalidating a previous observation even after values match",
  (component) => {
    for (const boundary of ["handoff", "callback"] as const) {
      const state = run(initial(boundary), boundary, steps.slice(0, -1));
      const hazard =
        component === "classification"
          ? "declassify"
          : component === "coverage"
            ? "coverage-loss"
            : "binding-change";
      disrupt(state, hazard);
      restoreValues(state);
      expect(state.evidence).toEqual({ ...baseline(), generation: 2 });
      advance(state, boundary, "commit");
      expect(state).toMatchObject({
        phase: "retired",
        starts: boundary === "handoff" ? 0 : 1,
        callbacks: 0,
      });
    }
  },
);

it("models consumed callback observations and lost ownership as non-transferable", () => {
  const state = run(initial("callback"), "callback");
  expect(state.callbacks).toBe(1);
  advance(state, "callback", "commit");
  expect(state).toMatchObject({ phase: "retired", starts: 1, callbacks: 1 });
  restoreValues(state);
  run(state, "callback");
  expect(state.callbacks).toBe(1);
  const restarted = initial("callback");
  restarted.owner = false;
  run(restarted, "callback");
  expect(restarted).toMatchObject({ phase: "retired", starts: 1, callbacks: 0 });
});

it("models withdrawal after handoff refusing later callbacks without recalling the prior start", () => {
  const state = run(initial("handoff"), "handoff");
  disrupt(state, "revoke");
  run(state, "callback");
  expect(state).toMatchObject({ phase: "retired", starts: 1, callbacks: 0 });
});
