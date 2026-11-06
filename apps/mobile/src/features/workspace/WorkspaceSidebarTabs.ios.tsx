import { requireNativeView } from "expo";
import type { NativeSyntheticEvent, ViewProps } from "react-native";
import { useControlTheme } from "../../components/ui/useControlTheme";
import { useNavigationTabOrder, useHiddenNavigationTabs } from "./navigation-tabs";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";

const NativeSidebarTabBar = requireNativeView<
  ViewProps & {
    tabs: readonly string[];
    selectedTab: string;
    selectedColor: string;
    appearance: string;
    showsCompose: boolean;
    compact?: boolean;
    onSelectionChange: (event: NativeSyntheticEvent<{ tab: string }>) => void;
    onCompose: () => void;
  }
>("T3NativeControls", "SidebarTabBar");

// fork: mobile-navigation
export function WorkspaceSidebarTabs(props: {
  readonly onNewTask?: () => void;
  readonly compact?: boolean;
  readonly reserveComposeSpace?: boolean;
}) {
  const workspace = useWorkspaceTabs()!;
  const order = useNavigationTabOrder();
  const hidden = useHiddenNavigationTabs();
  const tabs = order.filter((tab) => !hidden.includes(tab));
  const selectTab = useSelectWorkspaceTab();
  const { colors, colorScheme } = useControlTheme();
  // UIKit loses accessible names when updating nil-titled items in place.
  const tabBarKey = tabs.join(":");
  return (
    <NativeSidebarTabBar
      key={tabBarKey}
      tabs={tabs}
      selectedTab={workspace.state.selectedTab}
      selectedColor={colors["--color-primary"]}
      appearance={colorScheme}
      showsCompose={false}
      compact={props.compact}
      onCompose={() => props.onNewTask?.()}
      onSelectionChange={({ nativeEvent }) => {
        const tab = tabs.find((candidate) => candidate === nativeEvent.tab);
        if (tab) selectTab(tab);
      }}
      // Keep the host stable while UIKit updates the bars' intrinsic size and safe area together.
      style={{
        position: "absolute",
        bottom: 0,
        left: props.compact ? 8 : 0,
        right: props.compact ? 12 : 0,
        height: 128,
      }}
    />
  );
}
