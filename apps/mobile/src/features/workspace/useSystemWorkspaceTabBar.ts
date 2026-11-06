import { isDuoDevice } from "../../lib/device-type";
import { Platform } from "react-native";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { useDeviceType, useNativeLayoutMetrics } from "../../native/native-layout-metrics";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { workspaceUsesColumns } from "./workspace-tabs-state";

function useWorkspacePage() {
  const workspace = useWorkspaceTabs();
  return (
    workspace !== null && !workspaceUsesColumns(workspace.state.selectedTab, workspace.settingsOpen)
  );
}

export function useSidebarWorkspaceTabs(): "picker" | "toolbar" | null {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  const metrics = useNativeLayoutMetrics();
  const page = useWorkspacePage();
  if (Platform.OS !== "ios" || NATIVE_LIQUID_GLASS_SUPPORTED || !layout.usesSplitView || page)
    return null;
  if (deviceType === "pad") return null;
  // Portrait Duo has no system rail; keep its tabs in the sidebar like iPad.
  if (deviceType === "duo-unfolded" && (metrics?.verticalBarEdge ?? "none") === "none")
    return "picker";
  return (metrics?.verticalBarEdge ?? "none") === "none" ? "toolbar" : null;
}

export function useCompactWorkspaceTabs() {
  const { layout } = useAdaptiveWorkspaceLayout();
  const deviceType = useDeviceType();
  // Medium-width layouts use the sidebar's native bar when no system bar is visible.
  return (
    Platform.OS === "ios" &&
    !NATIVE_LIQUID_GLASS_SUPPORTED &&
    deviceType !== "pad" &&
    layout.variant === "medium" &&
    !layout.usesSplitView &&
    !isDuoDevice(deviceType)
  );
}

export function useSystemWorkspaceTabBar() {
  const deviceType = useDeviceType();
  const { layout } = useAdaptiveWorkspaceLayout();
  const sidebarTabs = useSidebarWorkspaceTabs();
  const compactTabs = useCompactWorkspaceTabs();
  return (
    Platform.OS === "ios" &&
    (NATIVE_LIQUID_GLASS_SUPPORTED ||
      (deviceType !== "pad" && layout.variant !== "medium" && sidebarTabs === null && !compactTabs))
  );
}
