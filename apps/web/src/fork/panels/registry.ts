import { pcbPreviewPanel } from "../pcb-preview/panel";
import { modelPreview3dPanel } from "../model-preview-3d/panel";
import { appleBuildToolingPanel } from "../apple-build-tooling/panel";
import { deviceQaPanel } from "../device-qa/panel";
import { codeGraphPanel } from "../code-graph/panel";
import type { ForkPanelDefinition, ForkRightPanelSurface } from "./types";

/** One line per packet panel. Order is launcher order. */
export const FORK_PANELS: ReadonlyArray<ForkPanelDefinition> = [
  modelPreview3dPanel,
  pcbPreviewPanel,
  appleBuildToolingPanel,
  deviceQaPanel,
  codeGraphPanel,
];

export const findForkPanel = (panelId: string): ForkPanelDefinition | null =>
  FORK_PANELS.find((panel) => panel.id === panelId) ?? null;

export const forkPanelSurface = (panelId: string, resourceId?: string): ForkRightPanelSurface => ({
  id: resourceId === undefined ? `fork:${panelId}` : `fork:${panelId}:${resourceId}`,
  kind: "fork",
  panelId,
  ...(resourceId === undefined ? {} : { resourceId }),
});
