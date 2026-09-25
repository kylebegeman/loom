import { PuzzleIcon } from "lucide-react";
import type { ComponentType } from "react";

import { findForkPanel } from "./registry";
import type { ForkRightPanelSurface } from "./types";

/** Shape compatible with RightPanelTabs' launcher and "+" menu actions. */
export interface ForkSurfaceAction {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly shortcut: string;
  readonly description?: string;
  readonly available: boolean;
  readonly disabledReason: string;
  readonly onClick: () => void;
  readonly badgeCount: number;
}

export const forkSurfaceTitle = (surface: ForkRightPanelSurface): string =>
  surface.title ?? findForkPanel(surface.panelId)?.title ?? "Unavailable panel";

export function ForkSurfaceIcon({ surface }: { surface: ForkRightPanelSurface }) {
  const Icon = findForkPanel(surface.panelId)?.icon ?? PuzzleIcon;
  return <Icon className="size-3 shrink-0" />;
}
