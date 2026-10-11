import { it, expect } from "vite-plus/test";
import type { PcbChangeRequest, PcbInspection, PcbComparison } from "@t3tools/contracts/fork";
import { anchorPoint, requestStatus, changesNearAnchor, requestPrompt } from "./requests";
const inspection: PcbInspection = {
  sourceHash: "a",
  components: [
    {
      id: "r",
      reference: "R1",
      value: "10k",
      footprint: "",
      pcb: { x: 1, y: 2 },
      schematic: { x: 10, y: 20, sheet: "one" },
      pins: [{ number: "1", name: "", net: "N", pcb: { x: 2, y: 3 } }],
    },
    {
      id: "c",
      reference: "C1",
      value: "",
      footprint: "",
      pcb: { x: 3, y: 2 },
      pins: [{ number: "1", name: "", net: "N", pcb: { x: 4, y: 3 } }],
    },
  ],
  nets: [],
  layers: [],
  bounds: null,
  thickness: 1.6,
  mountingHoles: [],
  warnings: [],
};
const request: PcbChangeRequest = {
  id: "one",
  title: "Move R1",
  request: "Move it left",
  anchor: { kind: "component", reference: "R1" },
  view: "pcb",
  sheet: "board",
  point: { x: 1, y: 2 },
  sourceHash: "a",
  createdAt: "now",
  status: "open",
  baseRef: "base",
  referenceImage: "private-image",
  sentAt: null,
  response: null,
  reviewRevision: null,
  resolvedRevision: null,
  resolvedRef: null,
  resolvedAt: null,
};
it("derives statuses without confusing sent and review", () => {
  expect(requestStatus(request, "a")).toBe("Draft");
  expect(requestStatus({ ...request, sentAt: "now" }, "a")).toBe("Requested");
  expect(requestStatus(request, "b")).toBe("Design changed");
  expect(requestStatus({ ...request, status: "review" }, "b")).toBe("Ready for review");
  expect(requestStatus({ ...request, status: "accepted" }, "b")).toBe("Accepted");
});
it("anchors semantic parts, sheet-specific nets and areas", () => {
  expect(anchorPoint(request.anchor, inspection, "pcb", "board")).toEqual({ x: 1, y: 2 });
  expect(anchorPoint(request.anchor, inspection, "schematic", "other")).toBeNull();
  expect(anchorPoint({ kind: "net", name: "N" }, inspection, "pcb", "board")).toEqual({
    x: 3,
    y: 3,
  });
  expect(
    anchorPoint({ kind: "component", reference: "gone" }, inspection, "pcb", "board"),
  ).toBeNull();
  expect(
    anchorPoint({ kind: "area", box: { x: 2, y: 4, width: 8, height: 10 } }, null, "pcb", "board"),
  ).toEqual({ x: 6, y: 9 });
});
it("groups nearby changes from both versions and prepares numbered text without images", () => {
  const comparison: PcbComparison = {
    from: "a",
    to: "b",
    before: inspection,
    after: { ...inspection, components: [] },
    changes: [
      { kind: "removed", reference: "R1", detail: "removed" },
      { kind: "changed", reference: "C1", detail: "value" },
      { kind: "added", reference: "U2", detail: "added" },
    ],
    beforeSvg: null,
    afterSvg: null,
    log: "",
  };
  expect(changesNearAnchor(comparison, request.anchor, "pcb").near.map((c) => c.reference)).toEqual(
    ["R1", "C1"],
  );
  expect(
    changesNearAnchor(comparison, { kind: "net", name: "N" }, "pcb").elsewhere.map(
      (c) => c.reference,
    ),
  ).toEqual(["U2"]);
  expect(
    changesNearAnchor(
      comparison,
      { kind: "area", box: { x: 0, y: 0, width: 1, height: 1 } },
      "pcb",
    ).near.map((c) => c.reference),
  ).toEqual(["R1", "C1"]);
  const prompt = requestPrompt([request, { ...request, id: "two", title: "Second" }], "board", "a");
  expect(prompt).toContain("1. Move R1");
  expect(prompt).toContain("2. Second");
  expect(prompt).toContain("requestId one");
  expect(prompt).not.toContain("private-image");
});
