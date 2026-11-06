import { Keyboard } from "react-native";

import { useAdaptiveWorkspaceLayout } from "../adaptive-workspace-context";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab } from "./workspace-tabs-state";

/** Opens a workspace tab, Settings included, from a tab bar, rail, toolbar or command. */
// fork: mobile-navigation
export function useSelectWorkspaceTab() {
  const dispatch = useWorkspaceTabs()?.dispatch;
  const { openWorkspaceTab } = useAdaptiveWorkspaceLayout();
  return (tab: WorkspaceTab | "settings") => {
    if (tab !== "search") Keyboard.dismiss();
    openWorkspaceTab(tab);
    if (tab !== "settings") dispatch?.({ type: "select", tab });
  };
}
