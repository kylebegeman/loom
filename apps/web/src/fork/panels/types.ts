import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

/** The one right-panel surface kind the fork adds. */
export interface ForkRightPanelSurface {
  id: `fork:${string}`;
  kind: "fork";
  /** A key of FORK_PANELS. */
  panelId: string;
  /** Distinguishes several tabs of one panel. */
  resourceId?: string;
  title?: string;
}

export interface ForkPanelProps {
  readonly surface: ForkRightPanelSurface;
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
}

export interface ForkPanelAvailabilityContext {
  readonly threadRef: ScopedThreadRef | null;
  readonly loomFeatures: ReadonlyArray<string>;
}

export interface ForkPanelDefinition {
  /** `<slug>` or `<slug>:<name>`. */
  readonly id: string;
  readonly title: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** The panel's letter from "Launcher letters" in EXTENSION-POINTS.md; "" for none. */
  readonly shortcut: string;
  /** Optional one-sentence description, shown by the panel picker (L12). */
  readonly description?: string;
  readonly unavailableHint: string;
  readonly isAvailable: (context: ForkPanelAvailabilityContext) => boolean;
  readonly Component: ComponentType<ForkPanelProps>;
}
