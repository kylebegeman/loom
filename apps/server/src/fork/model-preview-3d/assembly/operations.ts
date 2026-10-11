import type { BoardFeatures } from "../../pcb-preview/enclosure/features.ts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  AssemblyPart,
  EnclosureRequirements,
  partMatrix,
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
const decodeRequirements = Schema.decodeUnknownEffect(EnclosureRequirements);
const partDecode = Schema.decodeUnknownSync(AssemblyPart);
const invalid = (message: string) =>
  new ModelPreviewError({ reason: "invalid-parameter", message });
export const applyOperations = Effect.fn("Assembly.applyOperations")(function* (
  doc: ModelAssembly,
  operations: readonly AssemblyOperation[],
  ctx: {
    assemblyPath: string;
    features?: (part: AssemblyPart) => Effect.Effect<BoardFeatures, ModelPreviewError>;
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
      ["update-part", "move-part", "align", "remove-part", "place-board", "swap-board"].includes(
        op.op,
      ) &&
      !find(op.id)
    )
      return yield* invalid(`${at}: No part with id "${op.id}".`);
    if (op.op === "set-enclosure") {
      const requirements = yield* decodeRequirements({
        ...next.enclosure?.requirements,
        ...op.requirements,
      }).pipe(Effect.mapError(() => invalid(`${at}: Invalid fit requirements.`)));
      next = Object.assign({}, next, {
        enclosure: {
          board: op.board,
          parts: op.parts ?? next.enclosure?.parts ?? [],
          requirements,
        },
      });
    } else if (op.op === "clear-enclosure") next = Object.assign({}, next, { enclosure: null });
    else if (op.op === "place-board" || op.op === "swap-board") {
      const part = find(op.id)!;
      if (!ctx.features) return yield* invalid("Board reference data is unavailable.");
      const old = yield* ctx.features(part);
      let updated = part;
      if (op.op === "place-board") {
        if (next.enclosure?.board !== op.id)
          return yield* invalid("Choose the enclosure board to place.");
        const ids = next.enclosure.parts.length
          ? next.enclosure.parts
          : next.parts.filter((p) => p.id !== op.id && p.visible).map((p) => p.id);
        if (!ids.length) return yield* invalid("Add a case part before placing the board.");
        const boxes = yield* Effect.forEach(ids, (id) => ctx.bounds(id, next));
        const rotation =
          op.quarterTurns === undefined ? part.rotation : ([0, 0, 90 * op.quarterTurns] as const);
        const m = partMatrix([0, 0, 0], rotation),
          loop = old.outline.loops[old.outline.outer]!;
        const cx = (Math.min(...loop.map((p) => p[0])) + Math.max(...loop.map((p) => p[0]))) / 2,
          cy = (Math.min(...loop.map((p) => p[1])) + Math.max(...loop.map((p) => p[1]))) / 2;
        const x =
            (Math.min(...boxes.map((b) => b.min[0])) + Math.max(...boxes.map((b) => b.max[0]))) / 2,
          y =
            (Math.min(...boxes.map((b) => b.min[1])) + Math.max(...boxes.map((b) => b.max[1]))) / 2;
        updated = {
          ...part,
          rotation,
          position: [
            x - m[0]! * cx - m[4]! * cy,
            y - m[1]! * cx - m[5]! * cy,
            op.zMm ?? part.position[2],
          ],
        };
      } else {
        yield* ctx.addPath(op.path);
        const freshPart = { ...part, path: relativePartPath(ctx.assemblyPath, op.path) },
          fresh = yield* ctx.features(freshPart);
        if ((old.frame.sx === fresh.frame.sx) !== (old.frame.sy === fresh.frame.sy))
          return yield* invalid(
            "The new board frame changed handedness. Place the new reference explicitly.",
          );
        const rotation =
          old.frame.sx !== fresh.frame.sx
            ? composeRotation(part.rotation, [0, 0, 180])
            : part.rotation;
        const before = partMatrix([0, 0, 0], part.rotation),
          after = partMatrix([0, 0, 0], rotation);
        const loop = old.outline.loops[old.outline.outer]!,
          cx = (Math.min(...loop.map((p) => p[0])) + Math.max(...loop.map((p) => p[0]))) / 2,
          cy = (Math.min(...loop.map((p) => p[1])) + Math.max(...loop.map((p) => p[1]))) / 2;
        const u = (cx - old.frame.ox) / old.frame.sx,
          v = (cy - old.frame.oy) / old.frame.sy;
        const a = [cx, cy, old.body.bottom],
          b = [
            fresh.frame.sx * u + fresh.frame.ox,
            fresh.frame.sy * v + fresh.frame.oy,
            fresh.body.bottom,
          ];
        updated = {
          ...freshPart,
          rotation,
          position: part.position.map(
            (value, axis) =>
              value +
              before[axis]! * a[0]! +
              before[axis + 4]! * a[1]! +
              before[axis + 8]! * a[2]! -
              after[axis]! * b[0]! -
              after[axis + 4]! * b[1]! -
              after[axis + 8]! * b[2]!,
          ) as [number, number, number],
        };
      }
      next = Object.assign({}, next, {
        parts: next.parts.map((p) => (p.id === op.id ? updated : p)),
      });
    } else if (op.op === "add-part") {
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
        enclosure:
          next.enclosure?.board === op.id
            ? null
            : next.enclosure
              ? { ...next.enclosure, parts: next.enclosure.parts.filter((id) => id !== op.id) }
              : null,
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
    next = Object.assign({}, next, { version: next.enclosure ? 2 : 1 });
    next = yield* Effect.try({
      try: () => decode(next),
      catch: () => invalid(`${at}: The change exceeds assembly limits or has invalid coordinates.`),
    });
    const problem = validateAssembly(next, ctx.assemblyPath);
    if (problem) return yield* invalid(`${at}: ${problem.path}: ${problem.message}`);
  }
  return next;
});
