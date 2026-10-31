import { scopedThreadKey } from "../../lib/scopedEntities";
import { useReleasedCheckoutIds, useRestoreThreadCheckout } from "../project-lifecycle/state";
import { LegendList } from "@legendapp/list/react-native";
import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  buildProjectHome,
  buildProjectHomeComputerChoices,
  projectHomeComputerChoiceKey,
  resolveProjectHomeDestination,
  selectProjectHomeConversations,
  PROJECT_CONVERSATION_VIEWS,
  supportsLoomFeature,
  type ProjectConversationView,
  type ProjectHomeSectionId,
} from "@t3tools/client-runtime/fork";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { CHECKOUT_RELEASE_FEATURE } from "@t3tools/contracts/fork";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListChoiceRow } from "../../components/ui/ListChoiceRow";
import { Menu } from "../../components/ui/Menu";
import { projectHomeThreadMenuActions } from "./projectHomeThreadMenuActions";
import { pinProjectHomeView } from "./projectHomeView";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { cn } from "../../lib/cn";
import { appAtomRegistry } from "../../state/atom-registry";
import { environmentPresentations, threadListEnvironmentsAtom } from "../../state/presentation";
import {
  useReleaseThreadCheckout,
  useThreadListActions,
} from "../../features/home/useThreadListActions";
import { threadCanArchive } from "../../features/home/threadArchive";
import { Button } from "../../components/ui/Button";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { buildHomeProjectScopes, findHomeProjectScope } from "../../features/home/homeThreadList";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import { uuidv4 } from "../../lib/uuid";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { relativeTime } from "../../lib/time";
import { useProjects, useNavigationThreadShells, useServerConfigs } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useWorkspaceState } from "../../state/workspace";
import { useWorkspacePageBack } from "../library/workspacePageBack";
import { ProjectCheckoutSection } from "../project-checkout/ProjectCheckoutSection";
import { ProjectFolderLocation } from "../project-navigation/ProjectFolderLocation";
import { projectThreadActivity } from "../project-navigation/projectNavigation.logic";
import {
  PROJECT_HOME_PAGE_SIZE,
  projectHomeListItems,
  type ProjectHomeListItem,
} from "./projectHomeList";

const ACTIVITY_LABELS = {
  attention: "Needs your attention",
  failed: "Failed",
  working: "Working",
  ready: "Ready to continue",
  settled: "Settled",
  snoozed: "Snoozed",
} as const;
const ACTIVITY_ICONS: Record<keyof typeof ACTIVITY_LABELS, AppSymbolName> = {
  attention: "exclamationmark.circle",
  failed: "exclamationmark.triangle",
  working: "hammer",
  ready: "text.bubble",
  settled: "checkmark.circle",
  snoozed: "clock",
};

function renderProjectScrollView(props: ComponentProps<typeof ScreenScrollView>) {
  return <ScreenScrollView {...props} />;
}

export function ProjectHomeRouteScreen({
  route,
}: StaticScreenProps<{ readonly environmentId: string; readonly projectId: string }>) {
  return (
    <ProjectHomeContent
      key={`${route.params.environmentId}:${route.params.projectId}`}
      environmentId={EnvironmentId.make(route.params.environmentId)}
      projectId={ProjectId.make(route.params.projectId)}
    />
  );
}

function ProjectHomeContent(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  const navigation = useNavigation();
  const back = useWorkspacePageBack();
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const configs = useServerConfigs();
  const threads = useNavigationThreadShells();
  const { environments } = useEnvironments();
  const { state: catalog } = useWorkspaceState();
  const grouping = useMobileProjectGroupingSettings();
  const { settlementEnvironmentIds, snoozeEnvironmentIds } = useAtomValue(
    threadListEnvironmentsAtom,
  );
  const queuedThreadKeys = useQueuedThreadKeys();
  const [chosenProjectRef, setChosenProjectRef] = useState<ScopedProjectRef | null>(() => ({
    environmentId: props.environmentId,
    projectId: props.projectId,
  }));
  const [visibleCounts, setVisibleCounts] = useState<Partial<Record<ProjectHomeSectionId, number>>>(
    {},
  );
  const [reviewProjectKey, setReviewProjectKey] = useState<string | null>(null);
  const [threadView, setThreadView] = useState<ProjectConversationView | null>(null);
  const [query, setQuery] = useState("");
  const [destinationExpanded, setDestinationExpanded] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());
  const preferredProjectRef = useMemo(
    () => ({ environmentId: props.environmentId, projectId: props.projectId }),
    [props.environmentId, props.projectId],
  );
  const scopes = useMemo(
    () =>
      buildHomeProjectScopes({
        projects,
        environmentId: null,
        projectGroupingMode: grouping.sidebarProjectGroupingMode,
      }),
    [projects, grouping.sidebarProjectGroupingMode],
  );
  const scope = useMemo(
    () => findHomeProjectScope(scopes, scopedProjectKey(props.environmentId, props.projectId)),
    [scopes, props.environmentId, props.projectId],
  );
  const connectedEnvironmentIds = useMemo(
    () =>
      new Set(
        environments
          .filter(
            (environment) =>
              environment.entry.enabled && environment.connection.phase === "connected",
          )
          .map((environment) => environment.environmentId),
      ),
    [environments],
  );
  const permittedEnvironmentIds = useEnvironmentsWithScope(
    environments,
    AuthOrchestrationOperateScope,
  );
  const model = useMemo(
    () =>
      buildProjectHome({
        projectRefs: scope?.projectRefs ?? [],
        threads: threads.filter((thread) => thread.lineage.relationshipToParent !== "subagent"),
        connectedEnvironmentIds,
        getThreadActivity: (thread) =>
          projectThreadActivity(thread, {
            now,
            settlementEnvironmentIds,
            snoozeEnvironmentIds,
            queuedThreadKeys,
          }),
      }),
    [
      scope,
      threads,
      connectedEnvironmentIds,
      now,
      settlementEnvironmentIds,
      snoozeEnvironmentIds,
      queuedThreadKeys,
    ],
  );
  const conversations = useMemo(
    () => selectProjectHomeConversations({ sections: model.sections, view: threadView, query }),
    [model.sections, threadView, query],
  );
  const pinnedView = pinProjectHomeView(threadView, conversations);
  if (threadView !== pinnedView) setThreadView(pinnedView);
  const taskProject = resolveProjectHomeDestination({
    memberProjects: scope?.projects ?? [],
    preferredProjectRef,
    chosenProjectRef,
    connectedEnvironmentIds,
    permittedEnvironmentIds,
  });
  const availableTaskProject = resolveProjectHomeDestination({
    memberProjects: scope?.projects ?? [],
    connectedEnvironmentIds,
    permittedEnvironmentIds,
  });
  const selectedProject = scope?.projects.find(
    (project) =>
      project.environmentId === (chosenProjectRef ?? preferredProjectRef).environmentId &&
      project.id === (chosenProjectRef ?? preferredProjectRef).projectId,
  );
  const onlineProject = scope?.projects.find((project) =>
    connectedEnvironmentIds.has(project.environmentId),
  );
  const environmentLabels = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const environmentLabel = (environmentId: EnvironmentId) =>
    environmentLabels.get(environmentId) ?? "Computer";
  const computerChoices = useMemo(
    () =>
      buildProjectHomeComputerChoices({
        projects: scope?.projects ?? [],
        environmentLabels,
        connectedEnvironmentIds,
        permittedEnvironmentIds,
      }),
    [scope?.projects, environmentLabels, connectedEnvironmentIds, permittedEnvironmentIds],
  );
  const selectedChoice = selectedProject
    ? computerChoices.find(
        (choice) => choice.value === projectHomeComputerChoiceKey(selectedProject),
      )
    : undefined;
  const selectedComputer =
    selectedChoice?.triggerLabel ??
    (selectedProject ? environmentLabel(selectedProject.environmentId) : null);
  const computerCount = new Set(scope?.projects.map((project) => project.environmentId) ?? []).size;
  const selectDetail = useSelectWorkspaceDetail();
  const selectThread = (thread: { readonly environmentId: string; readonly id: string }) =>
    selectDetail({
      name: "Thread",
      params: { environmentId: thread.environmentId, threadId: thread.id },
    });
  const { settleThread, unsettleThread, unsnoozeThread } = useThreadListActions();
  const releaseCheckout = useReleaseThreadCheckout();
  const restoreCheckout = useRestoreThreadCheckout();
  const releasedCheckoutIds = useReleasedCheckoutIds();
  const openSettings = () => {
    if (!onlineProject) return;
    navigation.navigate("SettingsProjectOverview", {
      initialEnvironmentId: onlineProject.environmentId,
      initialProjectId: onlineProject.id,
    });
  };
  const prepareComputer = () => {
    if (!onlineProject) return;
    navigation.navigate("ProjectPreparation", {
      environmentId: onlineProject.environmentId,
      projectId: onlineProject.id,
    });
  };
  const startTask = () => {
    if (
      !taskProject ||
      !readEnvironmentScope(taskProject.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    const current = appAtomRegistry.get(
      environmentPresentations.presentationAtom(taskProject.environmentId),
    );
    if (current?.entry.enabled !== true || current.connection.phase !== "connected") return;
    selectDetail({
      name: "Thread",
      params: {
        draft: {
          requestId: uuidv4(),
          environmentId: taskProject.environmentId,
          projectId: taskProject.id,
          ...(scope ? { title: scope.title } : {}),
        },
      },
    });
  };
  useFocusEffect(
    useCallback(() => {
      setNow(new Date().toISOString());
      const timer = setInterval(() => setNow(new Date().toISOString()), 60_000);
      return () => clearInterval(timer);
    }, []),
  );
  const nextSnoozeWakeAt =
    model.sections
      .find((section) => section.id === "snoozed")
      ?.rows.reduce((nearest: number | null, row) => {
        const wake = Date.parse(row.thread.snoozedUntil ?? "");
        return Number.isFinite(wake) && (nearest === null || wake < nearest) ? wake : nearest;
      }, null) ?? null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- timer that advances the clock when the nearest snoozed conversation wakes
  useEffect(() => {
    if (nextSnoozeWakeAt === null) return;
    const timer = setTimeout(
      () => setNow(new Date().toISOString()),
      Math.min(Math.max(0, nextSnoozeWakeAt - Date.parse(now)) + 50, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [nextSnoozeWakeAt, now]);
  const items = useMemo(
    () => projectHomeListItems(conversations, visibleCounts),
    [conversations, visibleCounts],
  );
  const listExtraData = useMemo(
    () => ({
      chosenProjectRef,
      reviewProjectKey,
      destinationExpanded,
      detailsExpanded,
      permittedEnvironmentIds,
      environments,
      configs,
      threadView,
      query,
    }),
    [
      chosenProjectRef,
      reviewProjectKey,
      destinationExpanded,
      detailsExpanded,
      permittedEnvironmentIds,
      environments,
      configs,
      threadView,
      query,
    ],
  );
  const renderItem = ({ item }: { readonly item: ProjectHomeListItem }) => {
    if (item.type === "overview")
      return (
        <View className="gap-5 px-4 pt-4 pb-5">
          <View className="flex-row items-start gap-3">
            {scope ? (
              <View
                className="pt-0.5"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <ProjectFavicon
                  environmentId={scope.representative.environmentId}
                  projectTitle={scope.representative.title}
                  workspaceRoot={scope.representative.workspaceRoot}
                  faviconPath={scope.representative.faviconPath}
                  projectIcon={scope.representative.projectIcon}
                  size={36}
                />
              </View>
            ) : null}
            <View className="min-w-0 flex-1 gap-1">
              <Text accessibilityRole="header" className="text-xl font-t3-bold text-foreground">
                {scope?.title}
              </Text>
              <Text className="text-xs text-foreground-muted">
                {model.counts.total} {model.counts.total === 1 ? "thread" : "threads"} on{" "}
                {computerCount} {computerCount === 1 ? "computer" : "computers"}
              </Text>
            </View>
          </View>
          <View className="flex-row items-start gap-3">
            <Button
              tone="primary"
              label="New task"
              disabled={taskProject === null}
              onPress={startTask}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                selectedProject
                  ? `Change task computer, ${selectedComputer}`
                  : "Choose task computer"
              }
              accessibilityHint={selectedProject?.workspaceRoot}
              accessibilityState={{ expanded: destinationExpanded }}
              onPress={() => setDestinationExpanded((expanded) => !expanded)}
              className="min-h-[48px] min-w-0 flex-1 flex-row items-center gap-2 rounded-xl px-2 py-1.5 active:opacity-70"
            >
              <View className="pt-0.5">
                <SymbolView
                  name="desktopcomputer"
                  size={17}
                  tintColorClassName="accent-icon-muted"
                />
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <Text className="text-sm font-t3-medium text-foreground">
                  {selectedComputer ?? "Choose a computer"}
                </Text>
                {!selectedProject ? (
                  <Text className="text-2xs text-foreground-muted">Checkout unavailable</Text>
                ) : null}
              </View>
              <SymbolView
                name={destinationExpanded ? "chevron.up" : "chevron.down"}
                size={12}
                tintColorClassName="accent-icon-muted"
              />
            </Pressable>
          </View>
          {destinationExpanded ? (
            <View className="overflow-hidden rounded-xl bg-card">
              {scope?.projects.map((project, index) => {
                const connected = connectedEnvironmentIds.has(project.environmentId);
                const allowed = permittedEnvironmentIds.has(project.environmentId);
                return (
                  <ListChoiceRow
                    key={scopedProjectKey(project.environmentId, project.id)}
                    label={
                      computerChoices.find(
                        (choice) => choice.value === projectHomeComputerChoiceKey(project),
                      )?.triggerLabel ?? environmentLabel(project.environmentId)
                    }
                    description={`${connected ? (allowed ? "Connected with task access" : "Connected, read-only") : "Offline, reconnect to start work"}\n${project.workspaceRoot}`}
                    selected={
                      selectedProject?.environmentId === project.environmentId &&
                      selectedProject.id === project.id
                    }
                    disabled={!connected || !allowed}
                    separated={index > 0}
                    onPress={() => {
                      setChosenProjectRef({
                        environmentId: project.environmentId,
                        projectId: project.id,
                      });
                      setDestinationExpanded(false);
                    }}
                  />
                );
              })}
            </View>
          ) : null}
          {taskProject === null ? (
            <View className="gap-1">
              <Text className="text-xs text-foreground-muted">
                {onlineProject
                  ? "Choose a connected checkout with task access, or review the source to prepare another copy. Existing threads stay on their current computer."
                  : "Reconnect a computer with this project to start work or review its origin before preparing another copy."}
              </Text>
              <Button
                tone="text"
                label={
                  availableTaskProject
                    ? "Choose another computer"
                    : onlineProject
                      ? "Prepare another computer"
                      : "Reconnect a computer"
                }
                onPress={
                  availableTaskProject
                    ? () => setDestinationExpanded(true)
                    : onlineProject
                      ? prepareComputer
                      : () => navigation.navigate("Connections")
                }
              />
            </View>
          ) : null}
        </View>
      );
    if (item.type === "conversations")
      return (
        <View className="gap-3 px-4 pb-2">
          <Text accessibilityRole="header" className="text-lg font-t3-medium text-foreground">
            Threads
          </Text>
          <View className="min-h-[44px] flex-row items-center gap-2 rounded-xl border border-input-border bg-input pl-3">
            <SymbolView name="magnifyingglass" size={16} tintColorClassName="accent-icon-muted" />
            <TextInput
              accessibilityLabel="Search all thread titles"
              placeholder="Search threads"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              className="min-h-[44px] min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 py-2 text-sm"
            />
            {query.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear thread search"
                onPress={() => setQuery("")}
                className="h-[44px] w-[44px] items-center justify-center"
              >
                <SymbolView
                  name="xmark.circle.fill"
                  size={17}
                  tintColorClassName="accent-icon-muted"
                />
              </Pressable>
            ) : (
              <View className="w-3" />
            )}
          </View>
          {conversations.searching ? (
            <Text accessibilityLiveRegion="polite" className="py-2 text-xs text-foreground-muted">
              {conversations.matchingCount}{" "}
              {conversations.matchingCount === 1 ? "match" : "matches"} across all threads
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-1">
              {PROJECT_CONVERSATION_VIEWS.map((view) => (
                <Pressable
                  key={view.id}
                  accessibilityRole="tab"
                  accessibilityLabel={`${view.label}, ${conversations.counts[view.id]} threads`}
                  accessibilityState={{ selected: conversations.view === view.id }}
                  onPress={() => setThreadView(view.id)}
                  className={cn(
                    "min-h-[44px] flex-row items-center gap-1.5 rounded-lg px-2 py-2 active:opacity-70",
                    conversations.view === view.id && "bg-subtle-strong",
                  )}
                >
                  <Text
                    className={cn(
                      "text-xs",
                      conversations.view === view.id
                        ? "font-t3-medium text-foreground"
                        : "text-foreground-muted",
                    )}
                  >
                    {view.label}
                  </Text>
                  <Text className="text-2xs text-foreground-muted">
                    {conversations.counts[view.id]}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      );
    if (item.type === "empty")
      return (
        <View className="gap-1 px-4 py-6">
          <Text className="text-sm font-t3-medium text-foreground">
            {conversations.searching
              ? "No matching threads"
              : conversations.counts.all === 0
                ? "No threads yet"
                : `No ${conversations.view === "all" ? "saved" : conversations.view} threads`}
          </Text>
          <Text className="text-xs text-foreground-muted">
            {conversations.searching
              ? "Try another title or clear the search."
              : conversations.counts.all === 0
                ? "Start a new task to begin this project."
                : "Choose another view to browse this project's threads."}
          </Text>
        </View>
      );
    if (item.type === "section")
      return (
        <View className="flex-row items-center justify-between gap-2 px-4 pt-4 pb-1">
          <Text accessibilityRole="header" className="text-xs font-t3-medium text-foreground-muted">
            {item.id === "offline" ? "Offline computers" : item.title}
          </Text>
          <Text className="text-2xs text-foreground-muted">{item.count}</Text>
        </View>
      );
    if (item.type === "more")
      return (
        <View className="px-4 py-1">
          <Button
            label={`Show more (${item.hiddenCount})`}
            tone="text"
            onPress={() =>
              setVisibleCounts((current) => ({
                ...current,
                [item.id]: (current[item.id] ?? PROJECT_HOME_PAGE_SIZE) + PROJECT_HOME_PAGE_SIZE,
              }))
            }
          />
        </View>
      );
    if (item.type === "thread") {
      const { thread, activity, connected } = item.row;
      const actions = projectHomeThreadMenuActions({
        activity,
        connected,
        permitted: permittedEnvironmentIds.has(thread.environmentId),
        settlementSupported: settlementEnvironmentIds.has(thread.environmentId),
        snoozeSupported: snoozeEnvironmentIds.has(thread.environmentId),
        handoffSupported: supportsLoomFeature(
          configs.get(thread.environmentId)?.environment.capabilities,
          "workspace-handoff",
        ),
        checkoutReleased: releasedCheckoutIds.has(scopedThreadKey(thread.environmentId, thread.id)),
        checkoutReleaseSupported:
          thread.worktreePath != null &&
          supportsLoomFeature(
            configs.get(thread.environmentId)?.environment.capabilities,
            CHECKOUT_RELEASE_FEATURE,
          ),
        running: !threadCanArchive(thread.runtime),
      });
      return (
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${thread.title}, ${connected ? ACTIVITY_LABELS[activity] : `Offline, last known ${ACTIVITY_LABELS[activity]}`}, ${environmentLabel(thread.environmentId)}`}
            onPress={() => selectThread(thread)}
            className="min-h-[56px] min-w-0 flex-1 flex-row items-start gap-3 px-4 py-2.5 active:opacity-70"
          >
            <View className="pt-0.5">
              <SymbolView
                name={connected ? ACTIVITY_ICONS[activity] : "wifi.slash"}
                size={17}
                tintColorClassName={
                  connected && activity === "failed"
                    ? "accent-danger-foreground"
                    : connected && activity === "attention"
                      ? "accent-warning-foreground"
                      : "accent-icon-muted"
                }
              />
            </View>
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-sm font-t3-medium text-foreground">{thread.title}</Text>
              {releasedCheckoutIds.has(scopedThreadKey(thread.environmentId, thread.id)) ? (
                <Text className="text-xs text-foreground-muted">Checkout released</Text>
              ) : null}
              <View className="flex-row flex-wrap items-center gap-x-2 gap-y-0.5">
                <Text
                  className={cn(
                    "text-2xs",
                    connected && activity === "failed"
                      ? "text-danger-foreground"
                      : connected && activity === "attention"
                        ? "text-warning-foreground"
                        : connected && activity === "working"
                          ? "text-adaptive-sky-600-400"
                          : "text-foreground-muted",
                  )}
                >
                  {connected
                    ? ACTIVITY_LABELS[activity]
                    : `Last known: ${ACTIVITY_LABELS[activity]}`}
                </Text>
                <Text className="text-2xs text-foreground-muted">
                  {environmentLabel(thread.environmentId)}
                </Text>
                <Text className="text-2xs text-foreground-muted">
                  {relativeTime(thread.updatedAt)}
                </Text>
              </View>
            </View>
          </Pressable>
          {actions.length > 0 ? (
            <Menu
              actions={[...actions]}
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "settle") void settleThread(thread);
                if (nativeEvent.event === "reopen") void unsettleThread(thread);
                if (nativeEvent.event === "wake") void unsnoozeThread(thread);
                if (nativeEvent.event === "release-checkout") void releaseCheckout(thread);
                if (nativeEvent.event === "restore-checkout") void restoreCheckout(thread);
                if (
                  nativeEvent.event === "move-work" &&
                  readEnvironmentScope(thread.environmentId, AuthOrchestrationOperateScope)
                )
                  navigation.navigate("WorkspaceHandoff", {
                    environmentId: thread.environmentId,
                    threadId: thread.id,
                  });
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${thread.title}`}
                className="h-[44px] w-[44px] items-center justify-center"
              >
                <SymbolView name="ellipsis" size={17} tintColorClassName="accent-icon-muted" />
              </Pressable>
            </Menu>
          ) : null}
        </View>
      );
    }
    return (
      <View className="px-4 pt-5 pb-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Working files"
          accessibilityState={{ expanded: detailsExpanded }}
          onPress={() => setDetailsExpanded((expanded) => !expanded)}
          className="min-h-[44px] flex-row items-center justify-between gap-3 py-2 active:opacity-70"
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-sm font-t3-medium text-foreground">Working files</Text>
            <Text className="text-2xs text-foreground-muted">
              {scope?.projects.length ?? 0} working{" "}
              {(scope?.projects.length ?? 0) === 1 ? "copy" : "copies"}
            </Text>
          </View>
          <SymbolView
            name={detailsExpanded ? "chevron.down" : "chevron.right"}
            size={13}
            tintColorClassName="accent-icon-muted"
          />
        </Pressable>
        {detailsExpanded ? (
          <View className="gap-5 pt-3">
            <Text className="text-xs leading-normal text-foreground-muted">
              Your project and conversations stay in Loom. These are its working-file locations.
              Loom can free space by removing safe, settled copies, then restore their files when
              you resume work. Checking a location does not restore files.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label="Prepare another computer"
                disabled={onlineProject === undefined}
                onPress={prepareComputer}
              />
              <Button
                label="Manage working files"
                onPress={() => navigation.navigate("ProjectStorageInventory")}
              />
              <Button
                label="Manage computers"
                tone="text"
                onPress={() => navigation.navigate("Connections")}
              />
            </View>
            {scope?.projects.map((project) => {
              const key = scopedProjectKey(project.environmentId, project.id);
              const connected = connectedEnvironmentIds.has(project.environmentId);
              return (
                <View key={key} className="gap-2">
                  <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
                    <Text className="text-sm font-t3-medium text-foreground">
                      {environmentLabel(project.environmentId)}
                    </Text>
                    <Text className="text-2xs text-foreground-muted">
                      {connected ? "Connected" : "Offline"}
                    </Text>
                  </View>
                  <Text selectable className="text-xs leading-normal text-foreground-muted">
                    {project.workspaceRoot}
                  </Text>
                  <ProjectFolderLocation
                    project={project}
                    computerLabel={environmentLabel(project.environmentId)}
                  />
                  <Button
                    label={
                      connected && reviewProjectKey === key
                        ? "Hide storage review"
                        : "Review this checkout"
                    }
                    tone="text"
                    disabled={!connected}
                    onPress={() => setReviewProjectKey((current) => (current === key ? null : key))}
                  />
                  {connected && reviewProjectKey === key ? (
                    <ProjectCheckoutSection
                      environmentId={project.environmentId}
                      projectId={project.id}
                      workspaceRoot={project.workspaceRoot}
                      computerLabel={environmentLabel(project.environmentId)}
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    );
  };
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={scope?.title ?? "Project home"}
        onBack={back}
        optionsVersion={scope?.title}
        actions={[
          {
            accessibilityLabel: "Project settings",
            icon: "gearshape",
            onPress: openSettings,
            disabled: onlineProject === undefined,
          },
        ]}
      />
      {scope === null ? (
        <ScreenScrollView className="flex-1" contentInsetAdjustmentBehavior="automatic">
          <EmptyState
            variant="plain"
            title={
              catalog.isLoadingConnections || !catalog.hasLoadedShellSnapshot
                ? "Loading project"
                : "Project unavailable"
            }
            detail={
              catalog.isLoadingConnections || !catalog.hasLoadedShellSnapshot
                ? "Loading saved project details from your computers."
                : "This project's record is no longer available. Return to the project library."
            }
            actionLabel="Back to projects"
            onAction={back}
          />
        </ScreenScrollView>
      ) : (
        <LegendList
          data={items}
          extraData={listExtraData}
          keyExtractor={(item) => item.key}
          getItemType={(item) => item.type}
          renderItem={renderItem}
          renderScrollComponent={Platform.OS === "ios" ? renderProjectScrollView : undefined}
          estimatedItemSize={72}
          recycleItems={false}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustContentInsets={Platform.OS === "ios"}
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24 }}
          style={{ flex: 1 }}
        />
      )}
    </View>
  );
}
