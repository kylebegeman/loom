import { expect, it } from "@effect/vitest";
import type { VaultGrant } from "@t3tools/contracts/fork";
import { evaluateVaultPolicy, grantAttenuates } from "./VaultPolicy.ts";

// Design-only trust model. No service, wire contract or persisted record consumes these types.
type Binding = {
  environment: string;
  item: string;
  itemVersion: number;
  project: string;
  thread: string;
  run: string;
  action: string;
  destination: string;
  digest: string;
  request: string;
  waitingOperation: string;
  requestRevision: number;
  grantRevision: number;
  adapter: string;
};
const binding: Binding = {
  environment: "environment",
  item: "item",
  itemVersion: 1,
  project: "project",
  thread: "thread",
  run: "run",
  action: "use",
  destination: "destination",
  digest: "digest",
  request: "request",
  waitingOperation: "waiting",
  requestRevision: 2,
  grantRevision: 1,
  adapter: "ssh",
};
const operationPaths = ["ssh", "git-ssh", "github-api"] as const;
const unsupportedPaths = [
  "ssh-agent",
  "workload-session",
  "github-terminal",
  "raw-release",
  "unknown-adapter",
] as const;
type Path =
  | (typeof operationPaths)[number]
  | (typeof unsupportedPaths)[number]
  | "delegate"
  | "metadata";
const surfaces = [
  "web",
  "desktop",
  "mobile",
  "mcp",
  "cli",
  "provider",
  "scheduler",
  "broker",
] as const;
type Invocation = {
  path: Path;
  surface: (typeof surfaces)[number];
  reference: string | null;
  requestedMode: "timed" | "once" | null;
};
type Authority = {
  // Loaded in the destination environment, never selected by Invocation.requestedMode.
  itemMode: "ordinary" | "protected" | "unavailable" | "unsupported";
  coverage: "complete" | "incomplete";
  metadataAllowed: boolean;
  ordinaryGrant: boolean;
  actual: Binding;
  intent: null | {
    reference: string;
    reviewed: Binding;
    humanReviewed: boolean;
    state: "unused" | "spent" | "revoked" | "unknown";
  };
};
const authority = (): Authority => ({
  itemMode: "protected",
  coverage: "complete",
  metadataAllowed: true,
  ordinaryGrant: true,
  actual: { ...binding },
  intent: { reference: "intent", reviewed: { ...binding }, humanReviewed: true, state: "unused" },
});
const invocation = (): Invocation => ({
  path: "ssh",
  surface: "mcp",
  reference: "intent",
  requestedMode: "once",
});
type Observation = "denied" | "metadata-only" | "ordinary-policy" | "intent-eligible";
const observe = (result: Observation) => ({
  result,
  canExecute: false as const,
  automaticResumption: false as const,
  allowOnceConsumption: false as const,
});
const boundary = (trusted: Authority, input: Invocation) => {
  if (input.path === "metadata")
    return observe(trusted.metadataAllowed ? "metadata-only" : "denied");
  if (trusted.itemMode === "unavailable" || trusted.itemMode === "unsupported")
    return observe("denied");
  if (trusted.itemMode === "ordinary")
    return observe(
      input.requestedMode === "once" || input.reference !== null || !trusted.ordinaryGrant
        ? "denied"
        : "ordinary-policy",
    );
  if (trusted.coverage !== "complete" || !operationPaths.some((path) => path === input.path))
    return observe("denied");
  const intent = trusted.intent;
  if (
    !intent ||
    input.reference !== intent.reference ||
    !intent.humanReviewed ||
    intent.state !== "unused"
  )
    return observe("denied");
  if (
    (Object.keys(binding) as Array<keyof Binding>).some(
      (key) => trusted.actual[key] !== intent.reviewed[key],
    )
  )
    return observe("denied");
  if (trusted.actual.adapter !== input.path) return observe("denied");
  return observe("intent-eligible");
};
const expectClosed = (value: ReturnType<typeof boundary>) => {
  expect(value).toMatchObject({
    canExecute: false,
    automaticResumption: false,
    allowOnceConsumption: false,
  });
};

it("shows that a current ordinary grant can satisfy an invocation which omits its consumed intent", () => {
  const projectGrant: VaultGrant = {
    definition: {
      id: "a".repeat(32),
      label: "Synthetic project access",
      principal: { kind: "project", id: "project" },
      itemIds: ["b".repeat(32)],
      actions: ["use", "delegate"],
      projectId: "project",
      destination: "destination",
      notBefore: 0,
      expiresAt: 1000,
      parentId: null,
    },
    state: "active",
    revision: 1,
    createdBy: "human",
    updatedBy: "human",
  };
  const legacyDecision = evaluateVaultPolicy(
    [projectGrant],
    { threadId: "child", projectId: "project" },
    { itemId: "b".repeat(32), action: "use", destination: "destination" },
    100,
    1,
  );
  expect(legacyDecision.allowed).toBe(true);
  const trusted = authority();
  trusted.intent!.state = "spent";
  trusted.actual.thread = "child";
  for (const requestedMode of [null, "timed", "once"] as const) {
    const result = boundary(trusted, { ...invocation(), reference: null, requestedMode });
    expect(result.result).toBe("denied");
    expectClosed(result);
  }
});

it("shows that timed grant attenuation does not attenuate a hypothetical one-time budget", () => {
  const parent: VaultGrant = {
    definition: {
      id: "a".repeat(32),
      label: "Synthetic parent",
      principal: { kind: "thread", id: "parent" },
      itemIds: ["b".repeat(32)],
      actions: ["use", "delegate"],
      projectId: "project",
      destination: "destination",
      notBefore: 0,
      expiresAt: 1000,
      parentId: null,
    },
    state: "active",
    revision: 1,
    createdBy: "human",
    updatedBy: "human",
  };
  const hypotheticalParent = {
    ...parent,
    definition: { ...parent.definition, intent: { state: "spent" } },
  };
  const child = {
    ...parent,
    definition: {
      ...parent.definition,
      id: "c".repeat(32),
      principal: { kind: "thread" as const, id: "child" },
      parentId: parent.definition.id,
      actions: ["use" as const],
      notBefore: 10,
      expiresAt: 500,
    },
  };
  expect(grantAttenuates(hypotheticalParent, child)).toBe(true);
  expect(
    evaluateVaultPolicy(
      [hypotheticalParent, child],
      { threadId: "child", projectId: "project" },
      { itemId: "b".repeat(32), action: "use", destination: "destination" },
      100,
      1,
    ),
  ).toMatchObject({ allowed: true, grantId: child.definition.id });
  expect(boundary(authority(), { ...invocation(), path: "delegate" }).result).toBe("denied");
});

it("models omitted, foreign, stale and spent references across all entry paths and caller surfaces", () => {
  let checks = 0;
  for (const path of [...operationPaths, ...unsupportedPaths, "delegate"] as const)
    for (const surface of surfaces)
      for (const reference of [null, "foreign", "intent"])
        for (const requestedMode of [null, "timed", "once"] as const)
          for (const state of ["unused", "spent", "revoked", "unknown"] as const) {
            const trusted = authority();
            trusted.actual.adapter = path;
            trusted.intent!.reviewed.adapter = path;
            trusted.intent!.state = state;
            const result = boundary(trusted, { path, surface, reference, requestedMode });
            expect(result.result).toBe(
              operationPaths.some((supported) => supported === path) &&
                reference === "intent" &&
                state === "unused"
                ? "intent-eligible"
                : "denied",
            );
            expectClosed(result);
            expect(
              boundary(
                { ...trusted, ordinaryGrant: false },
                { path, surface, reference, requestedMode },
              ),
            ).toEqual(result);
            checks++;
          }
  expect(checks).toBe(2592);
});

it("models every reviewed binding field as mandatory at each supported operation boundary", () => {
  for (const path of operationPaths) {
    const trusted = authority();
    trusted.actual.adapter = path;
    trusted.intent!.reviewed.adapter = path;
    const input = { ...invocation(), path };
    expect(boundary(trusted, input).result).toBe("intent-eligible");
    for (const key of Object.keys(binding) as Array<keyof Binding>) {
      const actual = {
        ...trusted.actual,
        [key]: typeof trusted.actual[key] === "number" ? 99 : "changed",
      };
      const result = boundary({ ...trusted, actual }, input);
      expect(result.result, key).toBe("denied");
      expectClosed(result);
    }
    expect(boundary({ ...trusted, coverage: "incomplete" }, input).result).toBe("denied");
    expect(boundary({ ...trusted, intent: null }, input).result).toBe("denied");
    expect(
      boundary({ ...trusted, intent: { ...trusted.intent!, humanReviewed: false } }, input).result,
    ).toBe("denied");
  }
});

it("models child and grandchild calls requiring new review rather than copied parent authority", () => {
  const trusted = authority();
  for (const thread of ["child", "grandchild"]) {
    const child = { ...trusted, actual: { ...trusted.actual, thread, run: "child-run" } };
    expect(boundary(child, invocation()).result).toBe("denied");
    const childBinding = {
      ...child.actual,
      request: `request-${thread}`,
      waitingOperation: `waiting-${thread}`,
    };
    const separatelyReviewed = {
      ...child,
      actual: childBinding,
      intent: {
        reference: "new-intent",
        reviewed: childBinding,
        humanReviewed: true,
        state: "unused" as const,
      },
    };
    expect(boundary(separatelyReviewed, { ...invocation(), reference: "new-intent" }).result).toBe(
      "intent-eligible",
    );
    expect(trusted.intent!.reviewed).toEqual(binding);
  }
});

it("models unknown classification refusing credential use while metadata remains a separate observation", () => {
  for (const itemMode of ["unavailable", "unsupported"] as const)
    for (const path of [...operationPaths, ...unsupportedPaths, "delegate"] as const) {
      const result = boundary({ ...authority(), itemMode }, { ...invocation(), path });
      expect(result.result).toBe("denied");
      expectClosed(result);
    }
  const trusted = { ...authority(), itemMode: "unavailable" as const };
  expect(boundary(trusted, { ...invocation(), path: "metadata" }).result).toBe("metadata-only");
  expect(
    boundary({ ...trusted, metadataAllowed: false }, { ...invocation(), path: "metadata" }).result,
  ).toBe("denied");
});

it("models ordinary access retaining timed semantics and refusing a silent downgrade of explicit one-time intent", () => {
  const trusted = { ...authority(), itemMode: "ordinary" as const, intent: null };
  const input = { ...invocation(), requestedMode: "timed" as const, reference: null };
  expect(boundary(trusted, input).result).toBe("ordinary-policy");
  expect(boundary({ ...trusted, ordinaryGrant: false }, input).result).toBe("denied");
  expect(boundary(trusted, { ...input, requestedMode: "once" }).result).toBe("denied");
  expect(boundary(trusted, invocation()).result).toBe("denied");
});
