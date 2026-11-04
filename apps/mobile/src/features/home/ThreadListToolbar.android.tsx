// fork: project-navigation - Material search announces the selected Threads/Projects mode.
import { useProjectNavigation } from "../../fork/project-navigation/useProjectNavigation";
import { BRAND_NAME } from "@t3tools/shared/brand"; // fork: brand
import { useEffect, useState } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { BackHandler, Keyboard } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { appBarMenuItemsFromActions } from "../../components/ui/menuActionItems";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { WorkspaceBrandTitle } from "../workspace/WorkspaceBrandTitle";
import { useWorkspaceConnectionState } from "../../state/workspace";
import type { ThreadListToolbarProps } from "./ThreadListToolbar.types";

export function ThreadListToolbar(props: ThreadListToolbarProps) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const connectionState = useWorkspaceConnectionState();
  const { onRequestVisibility, onSearchQueryChange } = props;
  const { searchLabel, searchPlaceholder, view: navigationView } = useProjectNavigation(); // fork: project-navigation
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || props.searchQuery.length > 0;
  const openSearch = () => {
    onRequestVisibility?.();
    setSearchOpen(true);
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

  return (
    <AppBar
      title={BRAND_NAME} // fork: brand
      titleContent={
        <WorkspaceBrandTitle
          accessibilityLabel={`${BRAND_NAME}, Threads`} // fork: brand
          onOpenEnvironments={props.onOpenEnvironments}
        />
      }
      search={{
        value: props.searchQuery,
        onChangeText: onSearchQueryChange,
        placeholder: searchPlaceholder, // fork: project-navigation
        accessibilityLabel: searchLabel, // fork: project-navigation
        active: searching,
        onOpen: openSearch,
        onClose: closeSearch,
      }}
      menus={
        connectionState.hasConnections
          ? [
              {
                title: navigationView === "projects" ? "Filter projects" : "Filter threads", // fork: project-navigation
                icon: props.filterCustomized
                  ? "line.3.horizontal.decrease.circle.fill"
                  : "line.3.horizontal.decrease.circle",
                items: appBarMenuItemsFromActions(props.filterActions, props.onFilterSelect),
              },
            ]
          : undefined
      }
    />
  );
}
