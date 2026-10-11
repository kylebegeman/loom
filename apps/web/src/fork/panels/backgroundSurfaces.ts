import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { useRightPanelStore, type RightPanelSurface } from "~/rightPanelStore";
/** Automatic tabs preserve the user's active surface and proactive-diff revision. */
export function addBackgroundSurfaces(
  threadRef: ScopedThreadRef,
  surfaces: readonly RightPanelSurface[],
) {
  useRightPanelStore.setState((state) => {
    const key = scopedThreadKey(threadRef),
      current = state.byThreadKey[key];
    if (!current?.isOpen) return state;
    const added = surfaces.filter(
      (surface) => !current.surfaces.some((entry) => entry.id === surface.id),
    );
    return added.length
      ? {
          byThreadKey: {
            ...state.byThreadKey,
            [key]: { ...current, surfaces: [...current.surfaces, ...added] },
          },
        }
      : state;
  });
}
/** Auto-opening is app state, so a later proactive diff remains eligible for this turn. */
export function openAutomaticSurfaces(
  threadRef: ScopedThreadRef,
  surfaces: readonly RightPanelSurface[],
) {
  if (!surfaces.length) return;
  useRightPanelStore.setState((state) => {
    const key = scopedThreadKey(threadRef),
      current = state.byThreadKey[key];
    const added = surfaces.filter(
      (surface) => !current?.surfaces.some((entry) => entry.id === surface.id),
    );
    const visibility = state.threadPanelVisibilityByThreadKey[key];
    let visibilityMap = state.threadPanelVisibilityByThreadKey;
    if (!current?.isOpen && visibility?.popoverOpen) {
      visibilityMap = { ...visibilityMap };
      if (visibility.inlineOpen) delete visibilityMap[key];
      else visibilityMap[key] = { ...visibility, popoverOpen: false };
    }
    return {
      byThreadKey: {
        ...state.byThreadKey,
        [key]: {
          ...current,
          isOpen: true,
          activeSurfaceId: surfaces[0]!.id,
          surfaces: [...(current?.surfaces ?? []), ...added],
        },
      },
      threadPanelVisibilityByThreadKey: visibilityMap,
    };
  });
}
