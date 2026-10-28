// fork: project-navigation - Material search announces the selected Threads/Projects mode.
import { useProjectNavigation } from "../../fork/project-navigation/useProjectNavigation";
import { BRAND_NAME } from "@t3tools/shared/brand"; // fork: brand
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import {
  BackHandler,
  Keyboard,
  type TextInputInstance,
  View,
  type LayoutChangeEvent,
} from "react-native";
import type { MenuAction } from "@react-native-menu/menu";

import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";
import { AndroidAnchoredMenu } from "../../components/ui/AndroidAnchoredMenu";
import { Menu } from "../../components/ui/Menu";
import { SearchField } from "../../components/ui/SearchField";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceListToolbarRow } from "../workspace/WorkspaceListToolbarRow";
import { useWorkspaceConnectionState } from "../../state/workspace";
import { useToolbarLayout } from "../../components/ui/useToolbarLayout";

export function ThreadListToolbar(props: {
  readonly searchQuery: string;
  readonly onSearchQueryChange: (query: string) => void;
  readonly filterActions: MenuAction[];
  readonly filterCustomized: boolean;
  readonly onFilterAction: NonNullable<ComponentProps<typeof Menu>["onPressAction"]>;
  readonly onOpenEnvironments: () => void;
  readonly sidebar?: boolean;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  readonly onRequestVisibility?: () => void;
}) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const { paddingTop, paddingBottom } = useToolbarLayout();
  const connectionState = useWorkspaceConnectionState();
  const { onRequestVisibility, onSearchQueryChange } = props;
  const { searchLabel, searchPlaceholder, view: navigationView } = useProjectNavigation(); // fork: project-navigation
  const searchRef = useRef<TextInputInstance>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || props.searchQuery.length > 0;
  const openSearch = () => {
    onRequestVisibility?.();
    setSearchOpen(true);
    searchRef.current?.focus();
    return true;
  };
  useHardwareKeyboardCommand("focusSearch", openSearch);

  const closeSearch = () => {
    onSearchQueryChange("");
    setSearchOpen(false);
    Keyboard.dismiss();
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to BackHandler while searching to close search on Android back
  useEffect(() => {
    if (!searching || !listFocused) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      // Frozen Home screens can keep effects alive after a detail route opens.
      const state = navigation.getState();
      if (
        !state ||
        state.routes[state.index]?.name !== "Home" ||
        isTabActive?.("threads") === false
      )
        return false;
      if (Keyboard.isVisible()) Keyboard.dismiss();
      else closeSearch();
      return true;
    });
    return () => subscription.remove();
  }, [closeSearch, searching, listFocused, navigation, isTabActive]);

  const filterIcon = props.filterCustomized
    ? "line.3.horizontal.decrease.circle.fill"
    : "line.3.horizontal.decrease.circle";
  const searchField = (
    <SearchField
      inputRef={searchRef}
      accessibilityLabel={searchLabel} // fork: project-navigation
      clearAccessibilityLabel="Clear search"
      placeholder={searchPlaceholder} // fork: project-navigation
      value={props.searchQuery}
      onChangeText={onSearchQueryChange}
    />
  );
  const filterButton = connectionState.hasConnections ? (
    <AndroidAnchoredMenu actions={props.filterActions} onPressAction={props.onFilterAction}>
      {(open) => (
        <AndroidHeaderIconButton
          accessibilityLabel={navigationView === "projects" ? "Filter projects" : "Filter threads"} // fork: project-navigation
          icon={filterIcon}
          onPress={open}
        />
      )}
    </AndroidAnchoredMenu>
  ) : null;

  return (
    <View
      onLayout={props.onLayout}
      className={props.sidebar ? "absolute inset-x-0 top-0 z-[4] bg-header px-2" : "bg-header px-2"}
      style={{ paddingTop, paddingBottom }}
    >
      <WorkspaceListToolbarRow
        searching={searching}
        searchField={searchField}
        onCloseSearch={closeSearch}
        onOpenSearch={openSearch}
        searchAccessibilityLabel={searchLabel} // fork: project-navigation
        titleAccessibilityLabel={`${BRAND_NAME}, Threads`} // fork: brand
        onOpenEnvironments={props.onOpenEnvironments}
        filter={filterButton}
      />
    </View>
  );
}
