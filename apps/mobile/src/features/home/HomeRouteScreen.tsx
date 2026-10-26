import { useNewTaskFromSource } from "../../fork/library/NewTaskLibraryProjects";
import { uuidv4 } from "../../lib/uuid";
import { ThreadUndoNotice } from "./ThreadUndoNotice";
import { Toolbar } from "../../components/ui/Toolbar";
// fork: library
import {
  isLibraryProjectScopeKey,
  useHomeLibraryProjects,
  useLibraryProjectFilter,
} from "../../fork/library/useHomeLibraryProjects";
// fork: project-navigation - Adaptive empty-detail headers reflect the selected navigation mode.
import { useProjectNavigation } from "../../fork/project-navigation/useProjectNavigation";
import { use } from "react";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, useWindowDimensions } from "react-native";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { resolveScratchProjectScopeKey } from "@t3tools/client-runtime/state/project-grouping";

import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useProjects } from "../../state/entities";
import { environmentThreadShells } from "../../state/threads";
import { usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { useDeviceType, useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { WorkspaceEmptyDetail } from "../layout/WorkspaceEmptyDetail";
import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { checkForAppUpdateOnLaunch, startAppUpdateForegroundRecheck } from "../updates/app-updates";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen } from "./HomeScreen";
import { HomeHeader } from "./HomeHeader";
import { useHomeListOptions } from "./home-list-options";
import { useAtomValueWhileVisible, useHomeRouteVisible } from "./home-route-visibility";
import { buildHomeProjectScopes } from "./homeThreadList";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { getConnectionAwareBrandHeaderOptions } from "./WorkspaceConnectionTitle";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "../workspace/useSelectWorkspaceTab";
import { useSelectWorkspaceDetail } from "../workspace/useSelectWorkspaceDetail";

export function HomeRouteScreen() {
  const { title: navigationTitle } = useProjectNavigation(); // fork: project-navigation
  const { width: windowWidth } = useWindowDimensions();
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  const columnMetrics = useNativeColumnLayoutMetrics();
  const deviceType = useDeviceType();
  const headerWidth = nativePrimaryColumn ? (columnMetrics?.width ?? windowWidth) : windowWidth;
  const { layout, panes, primarySidebarSearchQuery, setPrimarySidebarSearchQuery, startNewTask } =
    useAdaptiveWorkspaceLayout();
  const selectDetail = useSelectWorkspaceDetail();
  const projects = useProjects();
  // Stop rebuilding the streaming thread list while Thread covers Home.
  const visible = useHomeRouteVisible();
  const threads = useAtomValueWhileVisible(
    environmentThreadShells.navigationThreadShellsAtom,
    visible,
  );
  const { environments: workspaceEnvironments, state: catalogState } = useWorkspaceState();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const workspace = useWorkspaceTabs();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery =
    Platform.OS === "android"
      ? primarySidebarSearchQuery
      : (workspace?.state.tabs.threads.query ?? localSearchQuery);
  const setSearchQuery = (query: string) => {
    if (Platform.OS === "android") setPrimarySidebarSearchQuery(query);
    else if (workspace) workspace.dispatch({ type: "query", query, tab: "threads" });
    else setLocalSearchQuery(query);
  };
  const selectLiveThread = useCallback(
    (thread: EnvironmentThreadShell) =>
      selectDetail({
        name: "Thread",
        params: { environmentId: String(thread.environmentId), threadId: String(thread.id) },
      }),
    [selectDetail],
  );
  const selectThreadRoute = useCallback(
    (params: ReactNavigation.RootParamList["Thread"]) => selectDetail({ name: "Thread", params }),
    [selectDetail],
  );
  // fork: library - Threads on unreachable computers open their saved Library history.
  const libraryHome = useHomeLibraryProjects(selectLiveThread);
  const handleSelectThread = libraryHome.selectThread;
  const handleNewThreadOnBranch = useNewTaskFromSource();

  useEffect(() => {
    void checkForAppUpdateOnLaunch();
    startAppUpdateForegroundRecheck();
  }, []);

  const {
    archiveThread,
    confirmDeleteThread,
    settleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    setThreadAutoSettle,
    moveThread,
    renameThread,
    regenerateThreadTitle,
    unsettleThread,
  } = useThreadListActions();
  const pendingTasks = usePendingNewTasks();
  const { openPendingTask, confirmDeletePendingTask } =
    usePendingTaskListActions(selectThreadRoute);
  const environments = useMemo(() => {
    const connectionStateByEnvironmentId = new Map(
      workspaceEnvironments.map(
        (environment) => [environment.environmentId, environment.connectionState] as const,
      ),
    );
    return Arr.sort(
      Object.values(savedConnectionsById).map((connection) => ({
        environmentId: connection.environmentId,
        label: connection.environmentLabel,
        connectionState:
          connectionStateByEnvironmentId.get(connection.environmentId) ?? "available",
      })),
      Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
    );
  }, [savedConnectionsById, workspaceEnvironments]);
  const availableEnvironmentIds = useMemo(
    () => new Set(environments.map((environment) => environment.environmentId)),
    [environments],
  );
  const {
    options: listOptions,
    setSelectedEnvironmentId,
    setSelectedProjectKey,
  } = useHomeListOptions(availableEnvironmentIds);
  const selectedEnvironmentId = listOptions.selectedEnvironmentId;
  const projectScopeKey = listOptions.selectedProjectKey;
  // fork: library
  const resolvedProjectKey = isLibraryProjectScopeKey(projectScopeKey)
    ? projectScopeKey
    : resolveScratchProjectScopeKey(projectScopeKey, projects, {
        sidebarProjectGroupingMode: listOptions.projectGroupingMode,
        sidebarProjectGroupingOverrides: {},
      });
  useEffect(() => {
    if (resolvedProjectKey !== projectScopeKey) {
      setSelectedProjectKey(resolvedProjectKey);
    }
  }, [projectScopeKey, resolvedProjectKey, setSelectedProjectKey]);
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: selectedEnvironmentId,
        projectGroupingMode: listOptions.projectGroupingMode,
      }),
    [listOptions.projectGroupingMode, projects, selectedEnvironmentId],
  );
  const projectFilter = useLibraryProjectFilter(projectScopes, resolvedProjectKey); // fork: library
  const projectFilterOptions = projectFilter.options; // fork: library
  const selectedProjectKey =
    isLibraryProjectScopeKey(resolvedProjectKey) || // fork: library
    projectFilterOptions.some((project) => project.key === resolvedProjectKey)
      ? resolvedProjectKey
      : null;

  // fork: library - A selected Library project leads the New task choices.
  const startConversation = () => libraryHome.startConversation(selectedProjectKey, startNewTask); // fork: library

  if (layout.usesSplitView && !nativePrimaryColumn) {
    return (
      <>
        <NativeStackScreenOptions
          options={
            Platform.OS === "android"
              ? { headerShown: false }
              : {
                  title: "",
                  headerTitle: "",
                  unstable_headerLeftItems: () => [],
                  headerSearchBarOptions: undefined,
                  unstable_headerRightItems: () => [],
                  unstable_headerToolbarItems: () => [],
                }
          }
        />
        {Platform.OS === "ios" ? (
          <Toolbar placement="left">
            <Toolbar.Button
              accessibilityLabel="New task"
              icon="square.and.pencil"
              onPress={startConversation}
            />
          </Toolbar>
        ) : null}
        {/* fork: project-navigation */}
        {Platform.OS === "android" ? <AndroidScreenHeader title={navigationTitle} /> : null}
        <WorkspaceEmptyDetail
          onAddConnection={
            Platform.OS === "android" && !catalogState.hasConnections
              ? () => openSettings(navigation, "SettingsEnvironmentNew")
              : undefined
          }
          onStartNewTask={
            Platform.OS === "android" && panes.primarySidebarVisible ? undefined : startConversation // fork: library
          }
        />
      </>
    );
  }

  return (
    <AndroidHomeFabLayout
      disabled={workspace !== null && Platform.OS !== "android"}
      onStartNewTask={startConversation} // fork: library
    >
      <>
        {/* Screen options merge shallowly; restore the header after split view. */}
        {workspace !== null && Platform.OS === "ios" ? null : (
          <NativeStackScreenOptions
            optionsVersion={headerWidth}
            options={{
              ...getConnectionAwareBrandHeaderOptions({
                headerWidth,
                trailingItemCount: nativePrimaryColumn && deviceType === "pad" ? 2 : 1,
                onOpenEnvironments: () => openSettings(navigation, "SettingsEnvironments"),
              }),
              headerShown: Platform.OS !== "android",
            }}
          />
        )}
        <HomeHeader
          environments={environments}
          projects={projectFilterOptions}
          searchQuery={searchQuery}
          selectedEnvironmentId={selectedEnvironmentId}
          selectedProjectKey={selectedProjectKey}
          onEnvironmentChange={setSelectedEnvironmentId}
          onProjectChange={setSelectedProjectKey}
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          onOpenSettings={() => selectTab("settings")}
          onSearchQueryChange={setSearchQuery}
          onStartNewTask={startConversation} // fork: library
        />

        <HomeScreen
          catalogState={catalogState}
          environments={environments}
          onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
          onArchiveThread={archiveThread}
          onDeleteThread={confirmDeleteThread}
          onSettleThread={settleThread}
          onSnoozeThread={snoozeThread}
          onUnsnoozeThread={unsnoozeThread}
          onUnsettleThread={unsettleThread}
          onPinThread={pinThread}
          onUnpinThread={unpinThread}
          onSetThreadAutoSettle={setThreadAutoSettle}
          onMoveThread={moveThread}
          onRenameThread={renameThread}
          onRegenerateThreadTitle={regenerateThreadTitle}
          onEnvironmentChange={setSelectedEnvironmentId}
          onProjectChange={setSelectedProjectKey}
          onOpenSettings={() => selectTab("settings")}
          onOpenComputers={() => navigation.navigate("Connections")} // fork: fleet-connections
          onSearchQueryChange={setSearchQuery}
          onSelectThread={handleSelectThread}
          onSelectPendingTask={openPendingTask}
          onDeletePendingTask={confirmDeletePendingTask}
          onNewThreadOnBranch={handleNewThreadOnBranch}
          onNewThreadInProject={(project) => {
            selectThreadRoute({
              draft: {
                requestId: uuidv4(),
                environmentId: String(project.environmentId),
                projectId: String(project.id),
                title: project.title,
              },
            });
          }}
          onStartNewTask={startConversation} // fork: library
          pendingTasks={pendingTasks}
          projectGroupingMode={listOptions.projectGroupingMode}
          projects={projects}
          projectFilterOptions={projectFilterOptions} // fork: library
          libraryProjectKeys={projectFilter.libraryProjectKeys} // fork: library
          projectSortOrder={listOptions.projectSortOrder}
          savedConnectionsById={savedConnectionsById}
          searchQuery={searchQuery}
          selectedEnvironmentId={selectedEnvironmentId}
          selectedProjectKey={selectedProjectKey}
          threads={threads}
        />
        <ThreadUndoNotice visible={visible} />
      </>
    </AndroidHomeFabLayout>
  );
}
