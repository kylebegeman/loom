import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PcbWorkspace, PcbWorkspaceInput } from "./pcb-workspace.ts";

const decode = Schema.decodeUnknownSync(Schema.fromJsonString(PcbWorkspace));
const encode = Schema.encodeSync(PcbWorkspace);

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
