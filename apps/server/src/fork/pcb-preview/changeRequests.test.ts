import { it, expect } from "vite-plus/test";
import { applyRequestOperation, requestRefs, AGENT_REQUEST_REFUSAL } from "./changeRequests.ts";
import type {
  PcbWorkspace,
  PcbChangeRequestDraft,
  PcbChangeRequestOperation,
} from "@t3tools/contracts/fork";
const empty: PcbWorkspace = {
  version: 0,
  views: [],
  layerSets: [],
  measurements: [],
  annotations: [],
  simulations: [],
  variants: [],
  requests: [],
};
const draft: PcbChangeRequestDraft = {
  id: "one",
  title: "Move R1",
  request: "Move it left",
  anchor: { kind: "component", reference: "R1" },
  view: "pcb",
  sheet: "board",
  point: { x: 1, y: 2 },
  sourceHash: "old",
  referenceImage: null,
};
const context = {
  actor: "user" as const,
  now: "2026-10-11T12:00:00Z",
  sourceHash: "now",
  baseRef: "base",
  resolvedRef: "resolved",
};
const created = () =>
  applyRequestOperation(empty, { op: "create", request: draft, sent: false }, context);
it("records review, acceptance and reopen without losing the agent response", () => {
  let data = created();
  expect(data.requests[0]).toMatchObject({ status: "open", baseRef: "base", sentAt: null });
  data = applyRequestOperation(
    data,
    { op: "status", id: "one", status: "review", response: "Moved" },
    { ...context, actor: "agent" },
  );
  expect(data.requests[0]).toMatchObject({ reviewRevision: "now", response: "Moved" });
  data = applyRequestOperation(data, { op: "status", id: "one", status: "accepted" }, context);
  expect(data.requests[0]).toMatchObject({
    resolvedRef: "resolved",
    resolvedRevision: "now",
    resolvedAt: context.now,
  });
  data = applyRequestOperation(data, { op: "status", id: "one", status: "open" }, context);
  expect(data.requests[0]).toMatchObject({
    response: "Moved",
    resolvedRef: null,
    resolvedRevision: null,
    resolvedAt: null,
  });
});
it.each<PcbChangeRequestOperation>([
  { op: "create", request: draft, sent: true },
  { op: "convert-note", noteId: "n", request: draft },
  { op: "edit", id: "one", title: "changed" },
  { op: "remove", id: "one" },
  { op: "sent", ids: ["one"] },
  { op: "status", id: "one", status: "accepted" },
])("denies an agent's $op operation", (operation) => {
  expect(() => applyRequestOperation(created(), operation, { ...context, actor: "agent" })).toThrow(
    AGENT_REQUEST_REFUSAL,
  );
});
it("denies an agent reopening an accepted request", () => {
  const accepted = applyRequestOperation(
    created(),
    { op: "status", id: "one", status: "accepted" },
    context,
  );
  expect(() =>
    applyRequestOperation(
      accepted,
      { op: "status", id: "one", status: "open" },
      { ...context, actor: "agent" },
    ),
  ).toThrow(AGENT_REQUEST_REFUSAL);
});
it("enforces limits and unique ids, converts exactly one note and marks sent", () => {
  expect(() =>
    applyRequestOperation(created(), { op: "create", request: draft, sent: false }, context),
  ).toThrow("unique");
  const full = {
    ...empty,
    requests: Array.from({ length: 30 }, (_, i) => ({ ...created().requests[0]!, id: `r${i}` })),
  };
  expect(() =>
    applyRequestOperation(full, { op: "create", request: draft, sent: false }, context),
  ).toThrow("Delete accepted");
  const annotations = ["n1", "n2"].map((id) => ({
    id,
    text: id,
    view: "pcb" as const,
    sheet: "board",
    point: { x: 0, y: 0 },
    sourceHash: "a",
  }));
  let data = applyRequestOperation(
    { ...empty, annotations },
    { op: "convert-note", noteId: "n1", request: draft },
    context,
  );
  expect(data.annotations.map((n) => n.id)).toEqual(["n2"]);
  data = applyRequestOperation(data, { op: "sent", ids: ["one"] }, context);
  expect(data.requests[0]?.sentAt).toBe(context.now);
  expect(requestRefs("one")).toEqual({
    base: "refs/loom/pcb-requests/one/base",
    resolved: "refs/loom/pcb-requests/one/resolved",
  });
});
