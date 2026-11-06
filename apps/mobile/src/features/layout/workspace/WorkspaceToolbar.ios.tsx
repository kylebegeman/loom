import { useProjectNavigation } from "../../../fork/project-navigation/useProjectNavigation"; // fork: project-navigation
import { createNativeHeaderMenu } from "../../../components/ui/nativeHeaderMenu.ios";
import { useSettingsEnvironmentMenu } from "../../settings/components/SettingsEnvironmentFilterHeader";
import { useActiveNewTask } from "../../../state/active-new-task";
import { Toolbar } from "../../../components/ui/Toolbar";
import { useIsFocused } from "@react-navigation/native";
import { use, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { isDuoDevice } from "../../../lib/device-type";
import { useDeviceType } from "../../../native/native-layout-metrics";
import type { SearchBarCommands } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../../native/native-glass";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import {
  NativePrimaryColumnContext,
  NativeWorkspaceTabActivityContext,
} from "../../../native/v5-workspace-context";
import { useHardwareKeyboardCommand } from "../../keyboard/hardwareKeyboardCommands";
import { useAdaptiveWorkspaceLayout } from "../AdaptiveWorkspaceLayout";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { shouldRestoreNativeSearch, type WorkspaceSearchTab } from "./workspace-tabs-state";
import { useSidebarWorkspaceTabs } from "./useSystemWorkspaceTabBar";
import { WorkspaceTabToolbarButtons } from "./WorkspaceSectionToolbar";
import { useSelectWorkspaceTab } from "./useSelectWorkspaceTab";
import { acceptsNativeSearchEvent } from "./native-search-events";

const SEARCH_LABELS = {
  threads: "Search threads",
  sites: "Search websites",
  search: "Search Loom",
  pullRequests: "Search pull requests",
  settings: "Search settings",
} as const;

// fork: mobile-navigation
export function WorkspaceToolbar(props: {
  readonly onNewTask?: () => void;
  readonly sidebar?: boolean;
  readonly searchTab?: Exclude<WorkspaceSearchTab, "usage">;
  readonly showCompose?: boolean;
}) {
  const workspace = useWorkspaceTabs()!;
  const { searchLabel: navigationSearchLabel } = useProjectNavigation(); // fork: project-navigation
  const selectTab = useSelectWorkspaceTab();
  const activeNewTask = useActiveNewTask();
  const deviceType = useDeviceType();
  const sidebarTabs = useSidebarWorkspaceTabs();
  const duoSearch =
    props.searchTab === undefined && NATIVE_LIQUID_GLASS_SUPPORTED && isDuoDevice(deviceType);
  const tabActive = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const focused = useIsFocused();
  const { panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const searchRef = useRef<SearchBarCommands>(null);
  const settingsMenu = useSettingsEnvironmentMenu();
  // The Settings list takes the selected tab's place, so search follows it.
  const selectedTab =
    props.searchTab ?? (workspace.settingsOpen ? "settings" : workspace.state.selectedTab);
  const globalSearch = selectedTab === "search";
  const bottomSearch = !globalSearch && duoSearch && sidebarTabs !== "picker";
  const supportsSearch =
    props.searchTab !== undefined || globalSearch || selectedTab === "settings";
  const nativeToolbarCompose =
    props.showCompose !== false &&
    props.onNewTask !== undefined &&
    selectedTab === "threads" &&
    activeNewTask === null;
  const tab = workspace.state.tabs[selectedTab];
  // fork: project-navigation
  const searchLabel =
    selectedTab === "threads"
      ? navigationSearchLabel
      : SEARCH_LABELS[selectedTab === "usage" ? "threads" : selectedTab];
  const { isTabActive: isListTabActive } = workspace;
  // A retained tab slot stays mounted while another is shown.
  const isTabActive = (tab: typeof selectedTab) =>
    props.searchTab !== undefined ? focused : tab === "settings" ? tabActive : isListTabActive(tab);
  const foldedSearch =
    props.searchTab === undefined && deviceType === "duo-folded" && supportsSearch && !globalSearch;
  const primaryColumn = use(NativePrimaryColumnContext);
  // UIKit hosts integrated search outside the sidebar's sliding content.
  // Mount it after native appearance so it cannot precede the pane's reveal.
  const searchVisible =
    supportsSearch &&
    (props.searchTab !== undefined ||
      globalSearch ||
      (foldedSearch
        ? tab.searchMode !== "resting"
        : deviceType !== "duo-unfolded" || primaryColumn?.presented !== false));
  const enterSearch = useCallback(() => {
    workspace.dispatch({
      type: "scroll",
      tab: selectedTab,
      offset: workspace.getScrollOffset(selectedTab),
    });
    workspace.dispatch({ type: "search", tab: selectedTab });
    if (props.sidebar && !panes.primarySidebarVisible) togglePrimarySidebar();
  }, [workspace, selectedTab, props.sidebar, panes.primarySidebarVisible, togglePrimarySidebar]);
  const focusSearch = () => {
    if (!isTabActive(selectedTab)) return false;
    if (!supportsSearch) {
      selectTab("search");
      return true;
    }
    if (duoSearch || !NATIVE_LIQUID_GLASS_SUPPORTED) enterSearch();
    searchRef.current?.focus();
    return true;
  };
  const cancelSearch = () => {
    workspace.recordScrollOffset(selectedTab, tab.searchEntryOffset);
    workspace.dispatch({ type: "cancel", tab: selectedTab });
    if (globalSearch) selectTab(workspace.state.searchReturnTab);
  };
  const searchFocused = () => {
    return tab.searchMode === "resting"
      ? enterSearch()
      : workspace.dispatch({ type: "search", tab: selectedTab });
  };
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  // The sidebar remains visible while its detail owns navigation focus.
  const searchHostVisible =
    focused ||
    (!globalSearch && props.searchTab === undefined && primaryColumn?.presented === true);
  const restoreSearch = (afterTransition = false) => {
    if (
      searchHostVisible &&
      searchVisible &&
      isTabActive(selectedTab) &&
      shouldRestoreNativeSearch(tab, duoSearch)
    ) {
      searchRef.current?.setText(tab.query);
      if (globalSearch && !afterTransition) return;
      // Integrated search collapses to its button when its screen reappears,
      // which would hide the query that still filters the list.
      if (NATIVE_LIQUID_GLASS_SUPPORTED) {
        searchRef.current?.setActive(true);
        if (tab.searchMode === "active") searchRef.current?.focus();
      }
    }
  };
  const restoreNativeSearch = useRef(restoreSearch);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- native appearance callbacks read the latest committed query without resubscribing or rewriting text during typing
  useLayoutEffect(() => {
    restoreNativeSearch.current = restoreSearch;
  }, [restoreSearch]);
  const searchListeners = useMemo(
    () => ({ transitionEnd: () => requestAnimationFrame(() => restoreNativeSearch.current(true)) }),
    [],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- restores the field only when its host, tab or placement changes, leaving native text edits alone
  useEffect(() => {
    if (!tabActive || !searchHostVisible || !searchVisible) return;
    const frame = requestAnimationFrame(() => restoreNativeSearch.current());
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- switching the native tab or search placement requires restoring its controller
  }, [tabActive, bottomSearch, searchHostVisible, searchVisible, selectedTab]);
  const composeButton = nativeToolbarCompose ? (
    <Toolbar.Button
      identifier="workspace-compose"
      accessibilityLabel="New thread"
      icon="square.and.pencil"
      onPress={props.onNewTask}
      separateBackground
    />
  ) : null;
  const searchButton = foldedSearch ? (
    <Toolbar.Button
      identifier="workspace-search"
      accessibilityLabel={searchVisible ? "Close search" : searchLabel}
      icon={searchVisible ? "xmark" : "magnifyingglass"}
      onPress={searchVisible ? () => searchRef.current?.cancelSearch() : focusSearch}
      separateBackground
    />
  ) : null;
  return (
    <>
      <NativeStackScreenOptions
        optionsVersion={[selectedTab, tab.searchMode]}
        listeners={searchListeners}
        options={{
          // Without Liquid Glass, Settings keeps its search field out instead of a search button,
          // which would take the header's trailing items from the scope filter.
          headerSearchBarOptions:
            (NATIVE_LIQUID_GLASS_SUPPORTED ||
              tab.searchMode !== "resting" ||
              selectedTab === "settings") &&
            searchVisible
              ? {
                  ref: searchRef,
                  autoFocus: globalSearch
                    ? tabActive && focused && tab.searchMode === "resting"
                    : tab.searchMode === "active",
                  autoCapitalize: "none",
                  hideNavigationBar: false,
                  hideWhenScrolling: false,
                  obscureBackground: false,
                  placement: globalSearch
                    ? "automatic"
                    : NATIVE_LIQUID_GLASS_SUPPORTED
                      ? bottomSearch
                        ? "integrated"
                        : "integratedButton"
                      : "stacked",
                  allowToolbarIntegration:
                    NATIVE_LIQUID_GLASS_SUPPORTED &&
                    (globalSearch || deviceType !== "phone") &&
                    sidebarTabs !== "picker",
                  placeholder: searchLabel,
                  cancelButtonHidden: foldedSearch,
                  onFocus: searchFocused,
                  onBlur: () => workspace.dispatch({ type: "expand", tab: selectedTab }),
                  onSearchButtonPress: () => searchRef.current?.blur(),
                  onChangeText: ({ nativeEvent }) => {
                    if (
                      !acceptsNativeSearchEvent({
                        globalSearch,
                        focused:
                          focused || (props.sidebar === true && primaryColumn?.presented === true),
                        tabActive: isTabActive(selectedTab),
                      })
                    )
                      return;
                    workspace.dispatch({
                      type: "query",
                      query: nativeEvent.text,
                      tab: selectedTab,
                    });
                  },
                  onCancelButtonPress: cancelSearch,
                }
              : undefined,
        }}
      />
      {/* UIKit lays trailing items out from the edge inward. */}
      {selectedTab === "settings" ? (
        <Toolbar placement="right">
          {searchButton}
          {createNativeHeaderMenu(settingsMenu)}
        </Toolbar>
      ) : (
        <Toolbar placement="right">
          {searchButton}
          {nativeToolbarCompose && foldedSearch ? <Toolbar.Spacer width={8} /> : null}
          {composeButton}
          {!supportsSearch || NATIVE_LIQUID_GLASS_SUPPORTED ? null : (
            <Toolbar.Button
              accessibilityLabel={searchLabel}
              icon="magnifyingglass"
              onPress={focusSearch}
            />
          )}
        </Toolbar>
      )}
      <Toolbar placement="bottom">
        {props.searchTab === undefined && sidebarTabs === "toolbar" ? (
          <WorkspaceTabToolbarButtons />
        ) : null}
        {bottomSearch && searchVisible ? <Toolbar.SearchBarSlot /> : null}
      </Toolbar>
    </>
  );
}
