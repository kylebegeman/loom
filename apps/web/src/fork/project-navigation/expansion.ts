import { useCallback } from "react";
import { useUiStateStore } from "~/uiStateStore";

const preferenceKey = (projectKey: string) => `loom:project-library:${projectKey}`;

export function useProjectLibraryExpansion(projectKey: string) {
  const key = preferenceKey(projectKey);
  const expanded = useUiStateStore((state) => state.projectExpandedById[key] ?? false);
  const toggleExpanded = useCallback(() => {
    const state = useUiStateStore.getState();
    state.setProjectExpanded(key, !(state.projectExpandedById[key] ?? false));
  }, [key]);
  return [expanded, toggleExpanded] as const;
}
