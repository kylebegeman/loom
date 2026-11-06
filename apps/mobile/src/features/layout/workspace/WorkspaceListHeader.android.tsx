// fork: project-navigation - Material search announces the selected Threads/Projects mode.
import { useProjectNavigation } from "../../../fork/project-navigation/useProjectNavigation";
import { BRAND_NAME } from "@t3tools/shared/brand"; // fork: brand
import { useEffect, useState } from "react";
import { useNavigation, useNavigationState } from "@react-navigation/native";
import { BackHandler, Keyboard } from "react-native";

import { AppBar } from "../../../components/ui/AppBar";
import { useWorkspaceConnectionState } from "../../../state/workspace";
import { useHardwareKeyboardCommand } from "../../keyboard/hardwareKeyboardCommands";
import { WorkspaceBrandTitle } from "./WorkspaceBrandTitle";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import {
  workspaceListFilterIcon,
  type WorkspaceListHeaderProps,
} from "./WorkspaceListHeader.types";

export function WorkspaceListHeader(props: WorkspaceListHeaderProps) {
  const navigation = useNavigation();
  const workspace = useWorkspaceTabs();
  const isTabActive = workspace?.isTabActive;
  const homeFocused = useNavigationState((state) => state.routes[state.index]?.name === "Home");
  const listFocused =
    homeFocused && (workspace === null || workspace.state.selectedTab === "threads");
  const connectionState = useWorkspaceConnectionState();
  const { search, sidebar } = props;
  const onSearchQueryChange = search.onChangeText;
  const { searchLabel, searchPlaceholder, view: navigationView } = useProjectNavigation(); // fork: project-navigation
  const [searchOpen, setSearchOpen] = useState(false);
  const searching = searchOpen || search.value.length > 0;
  const openSearch = () => {
    sidebar?.onRequestVisibility();
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
          accessibilityLabel={props.accessibilityLabel}
          onOpenEnvironments={props.onOpenEnvironments}
        />
      }
      search={{
        value: search.value,
        onChangeText: onSearchQueryChange,
        // fork: project-navigation
        placeholder: navigationView === "projects" ? searchPlaceholder : search.placeholder,
        accessibilityLabel: navigationView === "projects" ? searchLabel : search.accessibilityLabel,
        active: searching,
        onOpen: openSearch,
        onClose: closeSearch,
      }}
      menus={
        connectionState.hasConnections
          ? [
              {
                title: navigationView === "projects" ? "Filter projects" : "Filter threads", // fork: project-navigation
                icon: workspaceListFilterIcon(props.filter.customized),
                items: props.filter.items,
              },
            ]
          : undefined
      }
    />
  );
}
