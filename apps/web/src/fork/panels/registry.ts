import type { ForkPanelDefinition, ForkRightPanelSurface } from "./types";

/** One line per packet panel. Order is launcher order. */
export const FORK_PANELS: ReadonlyArray<ForkPanelDefinition> = [
  // snippetsPanel,
];

export const findForkPanel = (panelId: string): ForkPanelDefinition | null =>
  FORK_PANELS.find((panel) => panel.id === panelId) ?? null;

export const forkPanelSurface = (panelId: string, resourceId?: string): ForkRightPanelSurface => ({
  id: resourceId === undefined ? `fork:${panelId}` : `fork:${panelId}:${resourceId}`,
  kind: "fork",
  panelId,
  ...(resourceId === undefined ? {} : { resourceId }),
});
