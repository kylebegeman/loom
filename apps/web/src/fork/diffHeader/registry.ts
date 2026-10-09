import type { ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";

import type { DiffPanelSelection } from "~/diffPanelStore";

export interface ForkDiffHeaderActionProps {
  readonly threadRef: ScopedThreadRef | null | undefined;
  readonly files: ReadonlyArray<{ readonly filePath: string }>;
  readonly scopeLabel: string;
  readonly selection: DiffPanelSelection;
}

export interface ForkDiffHeaderAction {
  /** The packet slug. */
  readonly id: string;
  /** Renders null when it does not apply (no thread, no files, feature missing). */
  readonly Component: ComponentType<ForkDiffHeaderActionProps>;
}

/** One line per packet. Order is left-to-right order in the header. */
export const FORK_DIFF_HEADER_ACTIONS: ReadonlyArray<ForkDiffHeaderAction> = [
  // codeGraphDiffHeaderAction,
];
