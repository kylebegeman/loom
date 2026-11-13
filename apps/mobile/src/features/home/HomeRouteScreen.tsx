import { uuidv4 } from "../../lib/uuid";
import { BRAND_NAME } from "@t3tools/shared/brand"; // fork: brand
import { useProjectNavigation } from "../../fork/project-navigation/useProjectNavigation"; // fork: project-navigation
import { useNewTaskFromSource } from "../../fork/library/NewTaskLibraryProjects"; // fork: library
import { ThreadUndoNotice } from "./ThreadUndoNotice";
// fork: library
import {
  isLibraryProjectScopeKey,
  useHomeLibraryProjects,
  useLibraryProjectFilter,
} from "../../fork/library/useHomeLibraryProjects";
import { use } from "react";
import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import * as Arr from "effect/Array";
import * as Order from "effect/Order";
import { useNavigation } from "@react-navigation/native";
import { useMemo, useState } from "react";
import { Platform } from "react-native";

import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { pickableProjectGroups } from "@t3tools/client-runtime/state/project-grouping";

import { useProjects } from "../../state/entities";
import { steadyNavigationThreadShellsAtom } from "../../state/threads";
import { useLaunchingThreads, usePendingNewTasks } from "../../state/use-pending-new-tasks";
import { useWorkspaceState } from "../../state/workspace";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import {
  useAdaptiveWorkspaceLayout,
  useWorkspacePaneState,
} from "../layout/AdaptiveWorkspaceLayout";
import { AndroidHomeFabLayout } from "./AndroidHomeFab";
import { HomeScreen } from "./HomeScreen";
import { useHomeListOptions } from "./home-list-options";
import {
  runWhenHomeCovered,
  useAtomValueWhileVisible,
  useHomeRouteVisible,
} from "./home-route-visibility";
import { buildHomeProjectScopes, resolveHomeProjectFilterScope } from "./homeThreadList";
import { usePendingTaskListActions } from "./usePendingTaskListActions";
import { useThreadListActions } from "./useThreadListActions";
import { useWorkspaceTabs } from "../layout/workspace/WorkspaceTabsContext";
import { openSettings } from "../settings/settings-navigation";
import { useSelectWorkspaceTab } from "../layout/workspace/useSelectWorkspaceTab";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { WorkspaceListEmptyDetail } from "../layout/workspace/WorkspaceListEmptyDetail";
import { WorkspaceListHeader } from "../layout/workspace/WorkspaceListHeader";
import { buildHomeListFilterMenuItems } from "./home-list-filter-menu";

export function HomeRouteScreen() {
  const {
    view: navigationView,
    title: navigationTitle,
    searchLabel,
    searchPlaceholder,
  } = useProjectNavigation(); // fork: project-navigation
  const nativePrimaryColumn = use(NativePrimaryColumnContext);
  const { layout, setPrimarySidebarSearchQuery, startNewTask } = useAdaptiveWorkspaceLayout();
  const { primarySidebarSearchQuery } = useWorkspacePaneState();
  const selectDetail = useSelectWorkspaceDetail();
  const projects = useProjects();
  // Stop rebuilding the streaming thread list while Thread covers Home.
  const visible = useHomeRouteVisible();
  const threads = useLaunchingThreads(
    useAtomValueWhileVisible(steadyNavigationThreadShellsAtom, visible),
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
  // Split layouts keep the query; only the stacked layout opens the thread over the list.
  // Android's search field keeps its own open state, which a cleared query would leave open.
  const clearsSearchOnOpen = Platform.OS !== "android" && !layout.usesSplitView;
  const selectThreadRoute = (params: ReactNavigation.RootParamList["Thread"]) => {
    if (searchQuery !== "" && clearsSearchOnOpen && workspace)
      runWhenHomeCovered(() => workspace.cancelSearch("threads"));
    selectDetail({ name: "Thread", params });
  };
  // fork: library -- live threads open here; Library history falls back below
  const selectLiveThread = (thread: EnvironmentThreadShell) =>
    selectThreadRoute({ environmentId: String(thread.environmentId), threadId: String(thread.id) });
  // fork: library - Threads on unreachable computers open their saved Library history.
  const libraryHome = useHomeLibraryProjects(selectLiveThread);
  const handleSelectThread = libraryHome.selectThread;
  const handleNewThreadOnBranch = useNewTaskFromSource();

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
  const connectionStateByEnvironmentId = new Map(
    workspaceEnvironments.map(
      (environment) => [environment.environmentId, environment.connectionState] as const,
    ),
  );
  const environments = Arr.sort(
    Object.values(savedConnectionsById).map((connection) => ({
      environmentId: connection.environmentId,
      label: connection.environmentLabel,
      connectionState: connectionStateByEnvironmentId.get(connection.environmentId) ?? "available",
    })),
    Order.mapInput(Order.String, (environment: { readonly label: string }) => environment.label),
  );
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
  const projectScopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: selectedEnvironmentId,
        projectGroupingMode: listOptions.projectGroupingMode,
      }),
    [listOptions.projectGroupingMode, projects, selectedEnvironmentId],
  );
  // fork: library -- a Library project key passes through; local keys resolve as upstream's do
  const selectedProjectKey = isLibraryProjectScopeKey(listOptions.selectedProjectKey)
    ? listOptions.selectedProjectKey // fork: library
    : (resolveHomeProjectFilterScope(projectScopes, projects, listOptions)?.key ?? null);
  const projectFilter = useLibraryProjectFilter(
    pickableProjectGroups(projectScopes), // fork: library
    selectedProjectKey, // fork: library
  ); // fork: library
  const projectFilterOptions = projectFilter.options; // fork: library

  // fork: library - A selected Library project leads the New task choices.
  const startConversation = () => libraryHome.startConversation(selectedProjectKey, startNewTask); // fork: library

  if (layout.usesSplitView && !nativePrimaryColumn) {
    return (
      <WorkspaceListEmptyDetail
        hasConnections={catalogState.hasConnections}
        onAddConnection={() => openSettings(navigation, "SettingsEnvironmentNew")}
        onStartNewTask={startConversation} // fork: library
      />
    );
  }

  return (
    <AndroidHomeFabLayout onStartNewTask={startConversation} /* fork: library */>
      <>
        <WorkspaceListHeader
          accessibilityLabel={`${BRAND_NAME}, ${navigationTitle}`} // fork: brand
          onOpenEnvironments={() => openSettings(navigation, "SettingsEnvironments")}
          onOpenSettings={() => selectTab("settings")}
          search={{
            value: searchQuery,
            onChangeText: setSearchQuery,
            placeholder: searchPlaceholder, // fork: project-navigation
            accessibilityLabel: searchLabel, // fork: project-navigation
          }}
          filter={{
            customized: selectedEnvironmentId !== null || selectedProjectKey !== null,
            items: buildHomeListFilterMenuItems({
              navigationView, // fork: project-navigation
              environments,
              projects: projectFilterOptions,
              selectedEnvironmentId,
              selectedProjectKey,
              onEnvironmentChange: setSelectedEnvironmentId,
              onProjectChange: setSelectedProjectKey,
            }),
          }}
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
          visible={visible}
        />
        <ThreadUndoNotice visible={visible} />
      </>
    </AndroidHomeFabLayout>
  );
}
