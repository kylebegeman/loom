import type { RunId, ScopedThreadRef } from "@t3tools/contracts";
import type { ComponentType } from "react";
import type { TurnDiffFileChange } from "~/types";
import { PcbTurnChip } from "../pcb-preview/PcbTurnChip";
import { ModelTurnChip } from "../model-preview-3d/ModelTurnChip";
export interface ForkChangedFilesActionProps {
  readonly threadRef: ScopedThreadRef;
  readonly runId: RunId;
  readonly files: ReadonlyArray<TurnDiffFileChange>;
}
export interface ForkChangedFilesAction {
  readonly id: string;
  readonly Component: ComponentType<ForkChangedFilesActionProps>;
}
/** One registration per packet, in header order. */
export const FORK_CHANGED_FILES_ACTIONS: readonly ForkChangedFilesAction[] = [
  { id: "model-follow-agent", Component: ModelTurnChip },
  { id: "pcb-follow-agent", Component: PcbTurnChip },
];
