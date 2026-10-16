import { useCallback } from "react";
import { useUiStateStore } from "~/uiStateStore";

const preferenceKey = (key: string) => `loom:sidebar-projects:${key}`;

/**
 * A persisted open or closed state for one Projects view section, kept apart from upstream's
 * project expansion so the two views never share a preference. One store subscription per caller.
 */
export function useProjectNavigationExpansion(key: string, defaultExpanded = false) {
  const storeKey = preferenceKey(key);
  const expanded = useUiStateStore(
    (state) => state.projectExpandedById[storeKey] ?? defaultExpanded,
  );
  const toggleExpanded = useCallback(() => {
    const state = useUiStateStore.getState();
    state.setProjectExpanded(storeKey, !(state.projectExpandedById[storeKey] ?? defaultExpanded));
  }, [defaultExpanded, storeKey]);
  return [expanded, toggleExpanded] as const;
}
