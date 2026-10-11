import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AssemblyPart,
  ModelAssembly,
  ModelPreviewError,
  alignPosition,
  composeRotation,
  relativePartPath,
  slugId,
  validateAssembly,
  type AssemblyOperation,
  type AssemblyBounds,
} from "@t3tools/contracts/fork";
const decode = Schema.decodeUnknownSync(ModelAssembly);
const partDecode = Schema.decodeUnknownSync(AssemblyPart);
const invalid = (message: string) =>
  new ModelPreviewError({ reason: "invalid-parameter", message });
export const applyOperations = Effect.fn("Assembly.applyOperations")(function* (
  doc: ModelAssembly,
  operations: readonly AssemblyOperation[],
  ctx: {
    assemblyPath: string;
    addPath: (path: string) => Effect.Effect<void, ModelPreviewError>;
    bounds: (id: string, doc: ModelAssembly) => Effect.Effect<AssemblyBounds, ModelPreviewError>;
  },
) {
  let next = doc;
  for (const [index, op] of operations.entries()) {
    const at = `operations[${index}]`,
      find = (id: string) => next.parts.find((part) => part.id === id);
    if (
      "id" in op &&
      op.id &&
      ["update-part", "move-part", "align", "remove-part"].includes(op.op) &&
      !find(op.id)
    )
      return yield* invalid(`${at}: No part with id "${op.id}".`);
    if (op.op === "add-part") {
      yield* ctx.addPath(op.path);
      const name =
        op.name ??
        op.path
          .split("/")
          .at(-1)!
          .replace(/\.[^.]+$/, "");
      const id =
        op.id ??
        slugId(
          name,
          next.parts.map((part) => part.id),
        );
      const part = partDecode({
        ...op,
        id,
        name,
        path: relativePartPath(ctx.assemblyPath, op.path),
      });
      next = Object.assign({}, next, { parts: [...next.parts, part] });
    } else if (op.op === "update-part") {
      const { op: _op, id, ...patch } = op;
      next = Object.assign({}, next, {
        parts: next.parts.map((part) => (part.id === id ? { ...part, ...patch } : part)),
      });
    } else if (op.op === "move-part") {
      const part = find(op.id)!;
      next = Object.assign({}, next, {
        parts: next.parts.map((item) =>
          item.id === op.id
            ? {
                ...part,
                position: part.position.map((value, axis) => value + (op.by?.[axis] ?? 0)) as [
                  number,
                  number,
                  number,
                ],
                rotation: op.rotateBy ? composeRotation(part.rotation, op.rotateBy) : part.rotation,
              }
            : item,
        ),
      });
    } else if (op.op === "align") {
      if (op.to === op.id) return yield* invalid(`${at}: Align to a different part.`);
      const bounds = yield* ctx.bounds(op.id, next);
      const target =
        op.to === "origin"
          ? { min: [0, 0, 0] as const, max: [0, 0, 0] as const }
          : yield* ctx.bounds(op.to, next);
      next = Object.assign({}, next, {
        parts: next.parts.map((part) =>
          part.id === op.id
            ? {
                ...part,
                position: alignPosition({
                  position: part.position,
                  bounds,
                  target,
                  axis: op.axis,
                  mode: op.mode,
                  ...(op.offsetMm !== undefined ? { offsetMm: op.offsetMm } : {}),
                }),
              }
            : part,
        ),
      });
    } else if (op.op === "remove-part")
      next = Object.assign({}, next, {
        parts: next.parts.filter((part) => part.id !== op.id),
        clearances: next.clearances.filter((c) => c.a !== op.id && c.b !== op.id),
      });
    else if (op.op === "set-clearance") {
      const prior = next.clearances.find(
        (c) => (c.a === op.a && c.b === op.b) || (c.a === op.b && c.b === op.a),
      );
      const clearance = {
        id:
          op.id ??
          prior?.id ??
          slugId(
            `${op.a}-${op.b}`,
            next.clearances.map((c) => c.id),
          ),
        a: op.a,
        b: op.b,
        requiredMm: op.requiredMm,
        label: op.label !== undefined ? op.label : (prior?.label ?? null),
      };
      next = Object.assign({}, next, {
        clearances: prior
          ? next.clearances.map((c) => (c === prior ? clearance : c))
          : [...next.clearances, clearance],
      });
    } else if (op.op === "remove-clearance")
      next = Object.assign({}, next, { clearances: next.clearances.filter((c) => c.id !== op.id) });
    else if (op.op === "set-name") next = Object.assign({}, next, { name: op.name });
    next = yield* Effect.try({
      try: () => decode(next),
      catch: () => invalid(`${at}: The change exceeds assembly limits or has invalid coordinates.`),
    });
    const problem = validateAssembly(next, ctx.assemblyPath);
    if (problem) return yield* invalid(`${at}: ${problem.path}: ${problem.message}`);
  }
  return next;
});
