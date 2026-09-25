import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

export type InspectorDensity = "full" | "compact";

export interface ForkInspectorSection {
  /** `<slug>:<name>` */
  readonly id: string;
  readonly title: string;
  /**
   * A hook-backed component; render null when there is nothing to show. A packet with a
   * server part checks its own `loomFeatures` entry here.
   */
  readonly Component: ComponentType<{
    readonly threadRef: ScopedThreadRef;
    readonly density: InspectorDensity;
  }>;
}

/** One line per packet; rendered after the built-in sections in this order. */
export const FORK_INSPECTOR_SECTIONS: ReadonlyArray<ForkInspectorSection> = [];
