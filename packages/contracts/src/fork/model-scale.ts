import * as Schema from "effect/Schema";

/** An everyday object drawn beside the part for scale. */
export const ScaleReference = Schema.Literals([
  "none",
  "card",
  "coin-us",
  "coin-euro",
  "aa-battery",
  "brick-2x4",
  "m3-screw",
  "hand",
]);
export type ScaleReference = typeof ScaleReference.Type;

/** Shared labels without loading the viewer's geometry into settings and menus. */
export const SCALE_REFERENCE_LABELS = {
  none: "Nothing",
  card: "Credit card",
  "coin-us": "US quarter",
  "coin-euro": "1 euro coin",
  "aa-battery": "AA battery",
  "brick-2x4": "LEGO 2×4 brick",
  "m3-screw": "M3×10 screw",
  hand: "Hand (average adult)",
} as const satisfies Record<ScaleReference, string>;
