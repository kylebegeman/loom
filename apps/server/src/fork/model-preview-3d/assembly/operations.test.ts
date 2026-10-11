import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ModelAssembly } from "@t3tools/contracts/fork";
import { applyOperations } from "./operations.ts";
const empty = Schema.decodeUnknownSync(ModelAssembly)({
  format: "loom-assembly",
  version: 1,
  name: "Test",
});
const context = {
  assemblyPath: "design/test.loom-assembly.json",
  addPath: () => Effect.void,
  bounds: (_id: string, doc: typeof empty) => {
    const part = doc.parts.find((p) => p.id === _id)!;
    return Effect.succeed({
      min: part.position,
      max: part.position.map((v) => v + 10) as [number, number, number],
    });
  },
};
it.effect("applies sequential placement and clearance upsert, then removes dangling pairs", () =>
  Effect.gen(function* () {
    let doc = yield* applyOperations(
      empty,
      [
        { op: "add-part", id: "case", path: "case.stl" },
        { op: "add-part", id: "lid", path: "lid.stl" },
        { op: "move-part", id: "case", by: [0, 0, 20] },
        { op: "align", id: "lid", to: "case", axis: "z", mode: "after", offsetMm: 0.5 },
        { op: "set-clearance", a: "case", b: "lid", requiredMm: 0.3, label: "Gap" },
        { op: "set-clearance", a: "lid", b: "case", requiredMm: 0.5, label: null },
      ],
      context,
    );
    expect(doc.parts[1]?.position).toEqual([0, 0, 30.5]);
    expect(doc.parts[0]?.path).toBe("../case.stl");
    expect(doc.clearances).toHaveLength(1);
    expect(doc.clearances[0]?.label).toBeNull();
    doc = yield* applyOperations(doc, [{ op: "remove-part", id: "case" }], context);
    expect(doc.clearances).toEqual([]);
    expect(empty.parts).toEqual([]);
  }),
);
it.effect("rejects an invalid later operation without changing the input", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      applyOperations(
        empty,
        [
          { op: "add-part", id: "case", path: "case.stl" },
          { op: "move-part", id: "missing", by: [0, 0, 1] },
        ],
        context,
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(empty.parts).toEqual([]);
  }),
);
it.effect(
  "configures requirements, places a rotated board, swaps its frame and clears dangling enclosure ids",
  () =>
    Effect.gen(function* () {
      const features: import("../../pcb-preview/enclosure/features.ts").BoardFeatures = {
        revision: "r",
        kind: "kicad",
        frame: { sx: 1, sy: -1, ox: 0, oy: 0, matched: 3, mirrored: false },
        body: { top: 1.6, bottom: 0, box: { min: [0, 0, 0], max: [60, 40, 1.6] } },
        outline: {
          outer: 0,
          source: "bounds",
          loops: [
            [
              [0, 0],
              [60, 0],
              [60, 40],
              [0, 40],
            ],
          ],
        },
        parts: [],
        holes: [],
        connectors: [],
        warnings: [],
      };
      const ctx = {
        ...context,
        features: (p: import("@t3tools/contracts/fork").AssemblyPart) =>
          Effect.succeed(
            p.path.includes("new")
              ? {
                  ...features,
                  frame: { ...features.frame, ox: 10 },
                  body: { ...features.body, bottom: -1 },
                }
              : features,
          ),
      };
      let doc = yield* applyOperations(
        empty,
        [
          { op: "add-part", id: "board", path: "board.glb" },
          { op: "add-part", id: "case", path: "case.stl" },
          {
            op: "set-enclosure",
            board: "board",
            parts: ["case"],
            requirements: { wallGapMm: 0.8 },
          },
          { op: "set-enclosure", board: "board", requirements: { lidGapMm: 2 } },
          { op: "place-board", id: "board", quarterTurns: 1, zMm: 3 },
        ],
        ctx,
      );
      expect(doc.version).toBe(2);
      expect(doc.enclosure?.requirements).toMatchObject({ wallGapMm: 0.8, lidGapMm: 2 });
      expect(doc.parts[0]?.position).toEqual([25, -25, 3]);
      doc = yield* applyOperations(doc, [{ op: "swap-board", id: "board", path: "new.glb" }], ctx);
      expect(doc.parts[0]?.position[0]).toBeCloseTo(25);
      expect(doc.parts[0]?.position[1]).toBeCloseTo(-35);
      expect(doc.parts[0]?.position[2]).toBe(4);
      doc = yield* applyOperations(doc, [{ op: "remove-part", id: "case" }], ctx);
      expect(doc.enclosure?.parts).toEqual([]);
      doc = yield* applyOperations(doc, [{ op: "remove-part", id: "board" }], ctx);
      expect(doc.enclosure).toBeNull();
      expect(doc.version).toBe(1);
    }),
);
