import { useActiveNewTask } from "../../state/active-new-task";
import { Toolbar } from "../../components/ui/Toolbar";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { use, useCallback, useEffect, useRef } from "react";
import { isDuoDevice } from "../../lib/device-type";
import { useDeviceType } from "../../native/native-layout-metrics";
import type { SearchBarCommands } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import {
  NativePrimaryColumnContext,
  NativeWorkspaceTabActivityContext,
} from "../../native/v5-workspace-context";
import { useHardwareKeyboardCommand } from "../keyboard/hardwareKeyboardCommands";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useWorkspaceTabs } from "./WorkspaceTabsContext";
import { shouldRestoreNativeSearch, type WorkspaceSearchTab } from "./workspace-tabs-state";
import { useSidebarWorkspaceTabs } from "./useSystemWorkspaceTabBar";
import { WorkspaceTabToolbarButtons } from "./WorkspaceSectionToolbar";

const SEARCH_LABELS = {
  threads: "Search threads",
  results: "Search results",
  pullRequests: "Search pull requests",
  settings: "Search settings",
} as const;

export function WorkspaceToolbar(props: {
  readonly onNewTask?: () => void;
  readonly sidebar?: boolean;
  readonly searchTab?: Exclude<WorkspaceSearchTab, "usage">;
  readonly showCompose?: boolean;
}) {
  const workspace = useWorkspaceTabs()!;
  const activeNewTask = useActiveNewTask();
  const deviceType = useDeviceType();
  const sidebarTabs = useSidebarWorkspaceTabs();
  const duoSearch =
    props.searchTab === undefined && NATIVE_LIQUID_GLASS_SUPPORTED && isDuoDevice(deviceType);
  const bottomSearch = duoSearch && sidebarTabs !== "picker";
  const tabActive = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const focused = useIsFocused();
  const { panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const searchRef = useRef<SearchBarCommands>(null);
  // The Settings list takes the selected tab's place, so search follows it.
  const selectedTab =
    props.searchTab ?? (workspace.settingsOpen ? "settings" : workspace.state.selectedTab);
  const nativeToolbarCompose =
    props.showCompose !== false &&
    props.onNewTask !== undefined &&
    selectedTab === "threads" &&
    activeNewTask === null;
  const tab = workspace.state.tabs[selectedTab];
  const searchLabel = SEARCH_LABELS[selectedTab === "usage" ? "threads" : selectedTab];
  const { isTabActive: isListTabActive } = workspace;
  // A retained tab slot stays mounted while another is shown.
  const isTabActive = (tab: typeof selectedTab) =>
    props.searchTab !== undefined ? focused : tab === "settings" ? tabActive : isListTabActive(tab);
  const foldedSearch = props.searchTab === undefined && deviceType === "duo-folded";
  const primaryColumn = use(NativePrimaryColumnContext);
  // UIKit hosts integrated search outside the sidebar's sliding content.
  // Mount it after native appearance so it cannot precede the pane's reveal.
  const searchVisible =
    props.searchTab !== undefined ||
    (foldedSearch
      ? tab.searchMode !== "resting"
      : deviceType !== "duo-unfolded" || primaryColumn?.presented !== false);
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
    if (duoSearch || !NATIVE_LIQUID_GLASS_SUPPORTED) enterSearch();
    searchRef.current?.focus();
    return true;
  };
  const cancelSearch = () => {
    workspace.recordScrollOffset(selectedTab, tab.searchEntryOffset);
    workspace.dispatch({ type: "cancel", tab: selectedTab });
  };
  const searchFocused = () =>
    tab.searchMode === "resting"
      ? enterSearch()
      : workspace.dispatch({ type: "search", tab: selectedTab });
  useHardwareKeyboardCommand("focusSearch", focusSearch);
  // The sidebar remains visible while its detail owns navigation focus.
  const searchHostVisible =
    focused || (props.searchTab === undefined && primaryColumn?.presented === true);
  const restoreSearch = () => {
    if (
      searchHostVisible &&
      searchVisible &&
      isTabActive(selectedTab) &&
      shouldRestoreNativeSearch(tab, duoSearch)
    ) {
      searchRef.current?.setText(tab.query);
      // Integrated search collapses to its button when its screen reappears,
      // which would hide the query that still filters the list.
      if (NATIVE_LIQUID_GLASS_SUPPORTED) {
        searchRef.current?.setActive(true);
        if (tab.searchMode === "active") searchRef.current?.focus();
      }
    }
  };
  useFocusEffect(
    useCallback(() => {
      const frame = requestAnimationFrame(restoreSearch);
      return () => cancelAnimationFrame(frame);
    }, [restoreSearch]),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- schedules a frame to restore the native search bar's text and focus when its tab becomes active
  useEffect(() => {
    if (!tabActive) return;
    const frame = requestAnimationFrame(restoreSearch);
    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Moving the search bar to the bottom toolbar restores its focus and query.
  }, [restoreSearch, tabActive, bottomSearch]);
  const composeButton = nativeToolbarCompose ? (
    <Toolbar.Button
      identifier="workspace-compose"
      accessibilityLabel="New chat"
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
        listeners={{ transitionEnd: restoreSearch }}
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
                  autoFocus: tab.searchMode === "active",
                  autoCapitalize: "none",
                  hideNavigationBar: false,
                  hideWhenScrolling: false,
                  obscureBackground: false,
                  placement: NATIVE_LIQUID_GLASS_SUPPORTED
                    ? bottomSearch
                      ? "integrated"
                      : "integratedButton"
                    : "stacked",
                  allowToolbarIntegration:
                    NATIVE_LIQUID_GLASS_SUPPORTED &&
                    deviceType !== "phone" &&
                    sidebarTabs !== "picker",
                  placeholder: searchLabel,
                  cancelButtonHidden: foldedSearch,
                  onFocus: searchFocused,
                  onBlur: () => workspace.dispatch({ type: "expand", tab: selectedTab }),
                  onSearchButtonPress: () => searchRef.current?.blur(),
                  onChangeText: ({ nativeEvent }) =>
                    workspace.dispatch({
                      type: "query",
                      query: nativeEvent.text,
                      tab: selectedTab,
                    }),
                  onCancelButtonPress: cancelSearch,
                }
              : undefined,
        }}
      />
      {/* UIKit lays trailing items out from the edge inward. A trailing toolbar replaces the
          header's own items, so an empty one would hide the Settings scope filter. */}
      {selectedTab === "settings" && !foldedSearch ? null : (
        <Toolbar placement="right">
          {searchButton}
          {nativeToolbarCompose && foldedSearch ? <Toolbar.Spacer width={8} /> : null}
          {composeButton}
          {NATIVE_LIQUID_GLASS_SUPPORTED ? null : (
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
