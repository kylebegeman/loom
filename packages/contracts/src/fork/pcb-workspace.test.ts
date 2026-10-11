import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  PcbEditorAction,
  PcbCompleteEditorInput,
  PcbWorkspace,
  PcbWorkspaceInput,
  PcbEditorResult,
  PcbChangeRequest,
} from "./pcb-workspace.ts";

const readEditorAction = Schema.decodeUnknownSync(PcbEditorAction);
const readEditorCompletion = Schema.decodeUnknownSync(PcbCompleteEditorInput);
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(PcbWorkspace));
const decodeEditorResult = Schema.decodeUnknownSync(PcbEditorResult);
const encode = Schema.encodeSync(PcbWorkspace);
const decodeRequest = Schema.decodeUnknownSync(PcbChangeRequest);

describe("PcbWorkspace", () => {
  it("decodes a workspace saved before later collections existed", () => {
    const view = {
      id: "v1",
      name: "Top",
      view: "pcb",
      sheet: "board",
      camera: { x: 0, y: 0, scale: 1 },
      layers: [],
      sourceHash: "abc",
    };
    const saved = decode(JSON.stringify({ version: 3, views: [view] }));
    expect(saved).toEqual({
      version: 3,
      views: [view],
      layerSets: [],
      measurements: [],
      annotations: [],
      simulations: [],
      variants: [],
      requests: [],
    });
    // Defaults fill missing keys on read only; the written shape still carries every collection.
    expect(Object.keys(encode(saved))).toEqual(Object.keys(saved));
  });

  it("rejects a save that leaves out a collection instead of erasing it", () => {
    const save = Schema.decodeUnknownSync(PcbWorkspaceInput);
    const full = {
      version: 3,
      views: [],
      layerSets: [],
      measurements: [],
      annotations: [],
      simulations: [],
      variants: [],
    };
    expect(save(full)).toEqual(full);
    const { annotations: _omitted, ...partial } = full;
    expect(() => save(partial)).toThrow();
  });

  it("still rejects a missing version", () => {
    expect(() => decode(JSON.stringify({ views: [] }))).toThrow();
  });
});

it("decodes inspections from older servers and round-trips optional board statistics", async () => {
  const { PcbInspection } = await import("./pcb-workspace.ts");
  const read = Schema.decodeUnknownSync(PcbInspection);
  const older = {
    sourceHash: "hash",
    components: [],
    nets: [],
    layers: [],
    bounds: null,
    thickness: 1.6,
    mountingHoles: [],
    warnings: [],
  };
  expect(read(older)).toEqual(older);
  const stats = {
    size: { width: 20, height: 30 },
    areaMm2: 600,
    areaSource: "outline",
    copperLayers: 2,
    components: { front: 1, back: 0 },
    holes: { plated: 2, nonPlated: 1 },
    vias: { through: 1, blindOrMicro: 0 },
    measured: { drill: 0.3, track: null, annularRing: 0.15, viaDiameter: 0.6 },
    rules: null,
    tallest: { heightMm: 10, side: "front", reference: "J3", source: "glb" },
    heights: "measured",
  };
  expect(read({ ...older, stats }).stats).toEqual(stats);
});

it("retains old editor snapshots and bounds new finding metadata", () => {
  const state = {
    view: "pcb",
    sheet: "board",
    three: false,
    linked: false,
    selected: null,
    net: null,
    camera: null,
    drawingCamera: null,
    layers: [],
  };
  expect(decodeEditorResult({ message: "done", state })).toEqual({ message: "done", state });
  const finding = {
    id: "drc-one",
    source: "drc",
    severity: "error",
    message: "Too close",
    pointMm: { x: 1, y: 2 },
  };
  const findings = {
    visible: true,
    showExcluded: false,
    active: finding.id,
    total: 51,
    items: Array.from({ length: 50 }, () => finding),
  };
  expect(
    decodeEditorResult({ message: "done", state: { ...state, findings } }).state?.findings?.items,
  ).toHaveLength(50);
  expect(() =>
    decodeEditorResult({
      message: "done",
      state: { ...state, findings: { ...findings, items: [...findings.items, finding] } },
    }),
  ).toThrow();
  expect(() =>
    decodeEditorResult({
      message: "done",
      state: { ...state, findings: { ...findings, total: -1 } },
    }),
  ).toThrow();
});

it("decodes requests saved without optional metadata", () => {
  const request = decodeRequest({
    id: "r",
    title: "Move",
    request: "Move the part",
    anchor: { kind: "component", reference: "R1" },
    view: "pcb",
    sheet: "board",
    point: { x: 1, y: 2 },
    sourceHash: "hash",
    createdAt: "now",
  });
  expect(request).toMatchObject({
    status: "open",
    baseRef: null,
    referenceImage: null,
    sentAt: null,
    response: null,
    reviewRevision: null,
    resolvedRevision: null,
    resolvedRef: null,
    resolvedAt: null,
  });
});

it("decodes 3D editor tools and bounded points while retaining old actions", async () => {
  const read = readEditorAction;
  expect(read({ action: "snapshot" })).toEqual({ action: "snapshot" });
  expect(
    read({ action: "display", layers3d: { copper: false }, projection: "orthographic" }).projection,
  ).toBe("orthographic");
  expect(() => read({ action: "measure", points: [] })).toThrow();
  expect(() =>
    read({
      action: "measure",
      points: [
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
      ],
    }),
  ).toThrow();
  const measurement3d = {
    kind: "distance",
    start: [0, 0, 0],
    end: [3, 4, 0],
    lengthMm: 5,
    snaps: ["free", "vertex"],
  };
  const completion = readEditorCompletion({
    threadId: "thread",
    designId: "board",
    requestId: "request",
    message: "Measured",
    measurement3d,
    state: {
      view: "pcb",
      sheet: "board",
      three: true,
      linked: false,
      selected: null,
      net: null,
      camera: null,
      drawingCamera: null,
      layers: [],
      measurements3d: [measurement3d],
      tool3d: "distance",
      sectionCaps: "checking",
      snap3d: "ready",
    },
  });
  expect(completion.measurement3d).toEqual(measurement3d);
});
