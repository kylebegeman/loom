import type {
  ModelAnnotation,
  ModelMeasurement,
  ModelOrientation,
  ModelSection,
  ModelWorkspaceOperation,
} from "@t3tools/contracts/fork";
import type { ParameterState } from "./parameterHistory";
import { same } from "./undoHistory";

/** The model panel state undo and redo cover, kept per file revision. */
export type UndoSlice = {
  measurements: readonly ModelMeasurement[];
  annotations: readonly ModelAnnotation[];
  section: ModelSection;
  orientation: ModelOrientation | null;
  /** Customizer values; null for a mesh file or before its parameters load. */
  parameters: ParameterState | null;
};

type Change = { label: string; key: string };
type Item = { id: string; visible?: boolean };

/** Ids in `list` and not in `other`, so a key names the items an add or delete touched. */
const onlyIn = (list: readonly Item[], other: readonly Item[]) =>
  list
    .filter((item) => !other.some((each) => each.id === item.id))
    .map((item) => item.id)
    .join(",");

/**
 * Adds, deletes, clears, shows or hides an item; otherwise the edited pair. Adds and deletes are
 * keyed by their items, so two quick picks or deletions of different items stay separate steps.
 */
function listChange<T extends Item>(
  before: readonly T[],
  after: readonly T[],
  noun: string,
  plural: string,
): Change | { edited: [T, T] } {
  if (after.length > before.length)
    return {
      label: after.length - before.length > 1 ? `added ${plural}` : `added ${noun}`,
      key: `add-${onlyIn(after, before)}`,
    };
  if (after.length < before.length)
    return {
      label:
        !after.length && before.length > 1
          ? `cleared ${plural}`
          : before.length - after.length > 1
            ? `deleted ${plural}`
            : `deleted ${noun}`,
      key: `delete-${onlyIn(before, after)}`,
    };
  const index = after.findIndex((item, i) => !same(item, before[i]));
  const was = before[Math.max(index, 0)]!,
    now = after[Math.max(index, 0)]!;
  if (was.id === now.id && was.visible !== now.visible)
    return { label: `${now.visible ? "showed" : "hid"} ${noun}`, key: `visible-${now.id}` };
  return { edited: [was, now] };
}

/**
 * Names a change for "Undid: …" announcements and gives it a coalescing key, so a slider drag or
 * a run of edits on one target undoes as one step. When several fields change together, the
 * first in slice order names the step.
 */
export function describeChange(before: Partial<UndoSlice>, after: Partial<UndoSlice>): Change {
  const fields = Object.keys(after).join("+");
  const named = (change: Change): Change => ({
    label: change.label,
    key: `${fields}:${change.key}`,
  });
  if (before.measurements && after.measurements) {
    const change = listChange(
      before.measurements,
      after.measurements,
      "a measurement",
      "measurements",
    );
    if (!("edited" in change)) return named(change);
    const [was, now] = change.edited;
    return named(
      was.name !== now.name
        ? { label: "renamed a measurement", key: `name-${now.id}` }
        : { label: "moved a point", key: `point-${now.id}` },
    );
  }
  if (before.annotations && after.annotations) {
    const change = listChange(before.annotations, after.annotations, "a pin", "pins");
    if (!("edited" in change)) return named(change);
    const [was, now] = change.edited;
    return named(
      was.request !== now.request || was.name !== now.name
        ? { label: "edited a pin", key: `text-${now.id}` }
        : was.status !== now.status
          ? { label: "changed a pin's status", key: `status-${now.id}` }
          : { label: "moved a pin", key: `point-${now.id}` },
    );
  }
  if (before.section && after.section) {
    const [was, now] = [before.section, after.section];
    return named(
      was.enabled !== now.enabled
        ? { label: `turned the section ${now.enabled ? "on" : "off"}`, key: "enabled" }
        : was.axis !== now.axis
          ? { label: "changed the section axis", key: "axis" }
          : was.flipped !== now.flipped
            ? { label: "flipped the section", key: "flipped" }
            : (was.caps ?? true) !== (now.caps ?? true)
              ? { label: `turned the filled cut ${(now.caps ?? true) ? "on" : "off"}`, key: "caps" }
              : { label: "moved the section", key: "offset" },
    );
  }
  if ("orientation" in after)
    return named(
      after.orientation
        ? { label: "changed the orientation", key: "orientation" }
        : { label: "reset the orientation", key: "orientation" },
    );
  if (after.parameters) {
    const was = before.parameters,
      now = after.parameters;
    if (!was || was.setName !== now.setName)
      return named(
        now.setName
          ? { label: "chose a parameter set", key: "set" }
          : { label: "restored source defaults", key: "set" },
      );
    const name = [...new Set([...Object.keys(was.overrides), ...Object.keys(now.overrides)])].find(
      (key) => was.overrides[key] !== now.overrides[key],
    );
    return named(
      name
        ? { label: "changed a parameter", key: `parameter-${name}` }
        : { label: "changed the parameters", key: "parameters" },
    );
  }
  return named({ label: "changed the view", key: "other" });
}

type ListField = "measurements" | "annotations";

/** The list field a workspace operation edits, or null when undo does not cover it. */
export function operationField(operation: ModelWorkspaceOperation): ListField | null {
  if (operation.kind === "measurement") return "measurements";
  if (operation.kind === "annotation") return "annotations";
  if (
    operation.kind === "remove" &&
    (operation.collection === "measurements" || operation.collection === "annotations")
  )
    return operation.collection;
  return null;
}

/** A list after an upsert or removal, matching how the server applies the operation. */
export function applyToList<T extends { id: string }>(
  list: readonly T[],
  operation: { kind: "remove"; id: string } | { kind: "upsert"; item: T },
): readonly T[] {
  if (operation.kind === "remove") return list.filter((item) => item.id !== operation.id);
  const index = list.findIndex((item) => item.id === operation.item.id);
  return index < 0
    ? [...list, operation.item]
    : list.map((item, i) => (i === index ? operation.item : item));
}

/**
 * The live list with undo and redo saves that the workspace stream has not shown yet laid over
 * it, by item id; null marks a removal. Undoing again before the stream catches up then compares
 * against what the last undo wrote rather than reading it as a change made elsewhere.
 */
export function withPending<T extends { id: string }>(
  live: readonly T[],
  pending: ReadonlyMap<string, { item: T | null }>,
): readonly T[] {
  let list = live;
  for (const [id, { item }] of pending)
    list = applyToList(list, item ? { kind: "upsert", item } : { kind: "remove", id });
  return list;
}

/**
 * The item edits that turn `from` into `to`, applied only where the live list still matches
 * `from`. An item changed elsewhere since, by the agent or another window, is a conflict and is
 * left alone rather than overwritten. One already at its target, such as an added measurement
 * deleted elsewhere before its add is undone, is settled and needs no edit.
 */
export function listPatch<T extends { id: string }>(
  live: readonly T[],
  from: readonly T[],
  to: readonly T[],
  equal: (a: T | undefined, b: T | undefined) => boolean = same,
): { upserts: T[]; removes: string[]; settled: number; conflicts: number } {
  const ids = [...new Set([...from, ...to].map((item) => item.id))];
  const result = { upserts: [] as T[], removes: [] as string[], settled: 0, conflicts: 0 };
  for (const id of ids) {
    const was = from.find((item) => item.id === id),
      next = to.find((item) => item.id === id);
    if (equal(was, next)) continue;
    const now = live.find((item) => item.id === id);
    if (equal(now, next)) result.settled++;
    else if (!equal(now, was)) result.conflicts++;
    else if (next) result.upserts.push(next);
    else result.removes.push(id);
  }
  return result;
}

/**
 * Pins compare without their reference image: the workspace hands it back as a freshly signed
 * URL, so the same image does not read the same twice.
 */
export const samePin = (a: ModelAnnotation | undefined, b: ModelAnnotation | undefined) =>
  same(a && { ...a, referenceImage: null }, b && { ...b, referenceImage: null });
