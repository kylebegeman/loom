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
