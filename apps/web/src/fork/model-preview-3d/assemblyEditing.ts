import type { AssemblyOperation, AssemblyPart } from "@t3tools/contracts/fork";

export const ASSEMBLY_AXES = ["x", "y", "z"] as const;
export type AssemblyAxis = (typeof ASSEMBLY_AXES)[number];
export function parseAssemblyTransform(value: readonly string[], rotation = false) {
  const limit = rotation ? 360 : 100_000;
  if (value.length !== 3 || value.some((item) => !item.trim())) return null;
  const parsed = value.map(Number);
  return parsed.every((item) => Number.isFinite(item) && Math.abs(item) <= limit)
    ? (parsed as [number, number, number])
    : null;
}
/** Exact local nudges stay in millimetres regardless of the display preference. */
export function assemblyNudge(
  part: AssemblyPart,
  axis: AssemblyAxis,
  direction: 1 | -1,
  rotation: boolean,
  modifiers: { shiftKey: boolean; altKey: boolean },
): AssemblyOperation {
  const amount = rotation ? 15 : modifiers.altKey ? 0.1 : modifiers.shiftKey ? 10 : 1;
  const delta: [number, number, number] = [0, 0, 0];
  delta[ASSEMBLY_AXES.indexOf(axis)] = direction * amount;
  return rotation
    ? { op: "move-part", id: part.id, rotateBy: delta }
    : { op: "move-part", id: part.id, by: delta };
}
export const pairIdentity = (a: string, b: string) => [a, b].sort().join("\0");
