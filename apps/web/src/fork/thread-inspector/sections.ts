import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

/** The card is a glance; the panel shows everything. A section may render less on the card. */
export type InspectorSurface = "card" | "panel";

export interface ForkInspectorSection {
  /** `<slug>:<name>` */
  readonly id: string;
  readonly title: string;
  /**
   * A hook-backed component; render null when there is nothing to show. A packet with a
   * server part checks its own `loomFeatures` entry here. Build it from the primitives in
   * `parts.tsx` (InspectorSection, InspectorGlanceRow) so it reads like the built-in ones.
   */
  readonly Component: ComponentType<{
    readonly threadRef: ScopedThreadRef;
    readonly surface: InspectorSurface;
  }>;
}

/** One line per packet; rendered after the built-in sections in this order. */
export const FORK_INSPECTOR_SECTIONS: ReadonlyArray<ForkInspectorSection> = [];
