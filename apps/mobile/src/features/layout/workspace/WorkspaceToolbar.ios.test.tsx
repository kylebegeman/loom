import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import type { useWorkspaceTabs } from "./WorkspaceTabsContext";
import type { WorkspaceTab, WorkspaceTabsState } from "./workspace-tabs-state";

const harness = vi.hoisted(() => ({
  version: "27.0",
  workspace: null as ReturnType<typeof useWorkspaceTabs>,
  state: null as WorkspaceTabsState | null,
  cancel: undefined as (() => void) | undefined,
}));

vi.mock("../../../fork/project-navigation/useProjectNavigation", () => ({
  useProjectNavigation: () => ({ searchLabel: "Search threads" }),
}));
vi.mock("../../../components/ui/nativeHeaderMenu.ios", () => ({
  createNativeHeaderMenu: () => null,
}));
vi.mock("../../settings/components/SettingsEnvironmentFilterHeader", () => ({
  useSettingsEnvironmentMenu: () => ({}),
}));
vi.mock("../../../state/active-new-task", () => ({ useActiveNewTask: () => null }));
vi.mock("../../../components/ui/Toolbar", () => ({ Toolbar: () => null }));
vi.mock("@react-navigation/native", () => ({
  useIsFocused: () => true,
  useNavigationState: () => false,
}));
vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    get Version() {
      return harness.version;
    },
  },
}));
vi.mock("../../../native/native-layout-metrics", () => ({ useDeviceType: () => "pad" }));
vi.mock("../../../native/native-glass", () => ({ NATIVE_LIQUID_GLASS_SUPPORTED: true }));
vi.mock("../../../native/StackHeader", () => ({
  NativeStackScreenOptions: (props: {
    options: { headerSearchBarOptions?: { onCancelButtonPress?: () => void } };
  }) => {
    harness.cancel = props.options.headerSearchBarOptions?.onCancelButtonPress;
    return null;
  },
}));
vi.mock("../../keyboard/hardwareKeyboardCommands", () => ({
  useHardwareKeyboardCommand: () => undefined,
}));
vi.mock("../AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({ togglePrimarySidebar: () => undefined }),
  useWorkspacePaneState: () => ({ panes: { primarySidebarVisible: true } }),
}));
vi.mock("./WorkspaceTabsContext", () => ({ useWorkspaceTabs: () => harness.workspace }));
vi.mock("./useSystemWorkspaceTabBar", () => ({ useSidebarWorkspaceTabs: () => null }));
vi.mock("./WorkspaceSectionToolbar", () => ({ WorkspaceTabToolbarButtons: () => null }));
vi.mock("./useSelectWorkspaceTab", () => ({
  useSelectWorkspaceTab: () => (tab: WorkspaceTab) => {
    harness.state = workspaceTabsReducer(harness.state!, { type: "select", tab });
  },
}));

import { WorkspaceToolbar } from "./WorkspaceToolbar";
import { initialWorkspaceTabsState, workspaceTabsReducer } from "./workspace-tabs-state";

it.each([
  {
    label: "ignores a retained Search cancel after selecting Sites",
    version: "27.0",
    selected: "sites",
    expected: "sites",
    query: "Loom",
  },
  {
    label: "leaves native Search cancellation to UIKit",
    version: "27.0",
    selected: "search",
    expected: "search",
    query: "",
  },
  {
    label: "restores the previous tab on iOS 26.0",
    version: "26.0",
    selected: "search",
    expected: "threads",
    query: "",
  },
  {
    label: "restores the previous tab before Liquid Glass",
    version: "18.0",
    selected: "search",
    expected: "threads",
    query: "",
  },
] as const)("$label", (scenario) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  const root = createRoot(document.createElement("div"));
  try {
    harness.version = scenario.version;
    harness.state = workspaceTabsReducer(initialWorkspaceTabsState(), {
      type: "query",
      tab: "search",
      query: "Loom",
    });
    harness.state = workspaceTabsReducer(harness.state, { type: "select", tab: "search" });
    harness.workspace = {
      state: harness.state,
      dispatch: (action) => {
        harness.state = workspaceTabsReducer(harness.state!, action);
      },
      isTabActive: (tab) => harness.state?.selectedTab === tab,
      bottomClearance: 0,
      settingsOpen: false,
      getScrollOffset: () => 0,
      recordScrollOffset: () => undefined,
    };
    act(() => root.render(<WorkspaceToolbar />));
    const retainedCancel = harness.cancel;
    if (!retainedCancel) throw new Error("Expected a native Search cancel callback");

    harness.state = workspaceTabsReducer(harness.state, {
      type: "select",
      tab: scenario.selected,
    });
    act(retainedCancel);

    expect(harness.state.selectedTab).toBe(scenario.expected);
    expect(harness.state.tabs.search.query).toBe(scenario.query);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    harness.workspace = null;
    harness.state = null;
    harness.cancel = undefined;
  }
});
