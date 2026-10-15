import type { DisplayPrecision, DisplayUnits, ModelPoint } from "@t3tools/contracts/fork";
import { formatLength } from "./units";

/** What the model context menu can do at a picked point. */
export type PointAction = "measure" | "pin" | "center" | "section" | "layFlat" | "copy";

/** A context pick: the snapped model-space point and, on a face, its outward normal. */
export type PointPick = { point: ModelPoint; face?: ModelPoint | null | undefined };

export type PointContext = {
  /** A model is loaded in a working 3D view. */
  canPick: boolean;
  measurements: number;
  pins: number;
  /** Most measurements one model holds, and most pins unless `pinLimit` says otherwise. */
  markupLimit: number;
  /** Loom keeps fewer pins than measurements. */
  pinLimit?: number;
  /** Markup and pose edits are possible. Without them only view actions remain. */
  canEdit?: boolean;
  /** The model supports lay flat. */
  canLayFlat?: boolean;
};

const LABELS: Record<PointAction, string> = {
  measure: "Measure from here",
  pin: "Pin a change here",
  center: "Center the view here",
  section: "Section through here",
  layFlat: "Lay this face flat",
  copy: "Copy coordinates",
};

/**
 * The menu entries that apply at a pick, in menu order. Entries that would fail are left out
 * rather than shown disabled: a full markup list drops its add action, and a pick off a face
 * cannot lay flat.
 */
export function pointActions(
  pick: PointPick,
  context: PointContext,
): { action: PointAction; label: string }[] {
  if (!context.canPick) return [];
  const edit = context.canEdit ?? true;
  const actions: PointAction[] = [];
  if (edit && context.measurements < context.markupLimit) actions.push("measure");
  if (edit && context.pins < (context.pinLimit ?? context.markupLimit)) actions.push("pin");
  actions.push("center", "section");
  if (edit && (context.canLayFlat ?? true) && pick.face?.some((n) => n !== 0))
    actions.push("layFlat");
  actions.push("copy");
  return actions.map((action) => ({ action, label: LABELS[action] }));
}

const AXES = ["x", "y", "z"] as const;

/**
 * The section axis for "Section through here". The current axis stays unless the picked face
 * lies in its plane, where the cut would only skim the face; then the plane turns to the axis
 * that runs most along the face.
 */
export function sectionAxisThrough(
  normal: readonly number[] | null | undefined,
  current: (typeof AXES)[number],
): (typeof AXES)[number] {
  const length = normal ? Math.hypot(...normal) : 0;
  if (!normal || !length) return current;
  const along = normal.map((n) => Math.abs(n) / length);
  if (along[AXES.indexOf(current)]! < 0.9) return current;
  return AXES[along.indexOf(Math.min(...along))]!;
}

/** The text "Copy coordinates" writes: the model-space point in display units and precision. */
export function coordinateText(
  point: ModelPoint,
  units: DisplayUnits,
  precision: DisplayPrecision,
) {
  return point.map((value) => formatLength(value, units, { precision })).join(", ");
}
