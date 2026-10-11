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
