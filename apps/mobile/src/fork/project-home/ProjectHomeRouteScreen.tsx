import { LegendList } from "@legendapp/list/react-native";
import { useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  buildProjectHome,
  resolveProjectHomeDestination,
  type ProjectHomeSectionId,
} from "@t3tools/client-runtime/fork";
import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { EmptyState } from "../../components/EmptyState";
import { ListChoiceRow } from "../../components/ListChoiceRow";
import { ControlPillMenu } from "../../components/ControlPill";
import { projectHomeThreadActions } from "./projectHomeThreadActions";
import { useThreadListActions } from "../../features/home/useThreadListActions";
import { MaterialButton } from "../../components/MaterialButton";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { buildHomeProjectScopes, findHomeProjectScope } from "../../features/home/homeThreadList";
import { useHomeThreadSelection } from "../../features/home/home-thread-navigation";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { scopedProjectKey } from "../../lib/scopedEntities";
import { relativeTime } from "../../lib/time";
import { useProjects, useNavigationThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { threadListEnvironmentsAtom } from "../../state/server";
import { useQueuedThreadKeys } from "../../state/use-thread-outbox";
import { useWorkspaceState } from "../../state/workspace";
import { ProjectCheckoutSection } from "../project-checkout/ProjectCheckoutSection";
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
  const insets = useSafeAreaInsets();
  const projects = useProjects();
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
  const listExtraData = useMemo(
    () => ({ chosenProjectRef, reviewProjectKey, permittedEnvironmentIds, environments }),
    [chosenProjectRef, reviewProjectKey, permittedEnvironmentIds, environments],
  );
  const taskProject = resolveProjectHomeDestination({
    memberProjects: scope?.projects ?? [],
    preferredProjectRef,
    chosenProjectRef,
    connectedEnvironmentIds,
    permittedEnvironmentIds,
  });
  const onlineProject = scope?.projects.find((project) =>
    connectedEnvironmentIds.has(project.environmentId),
  );
  const environmentLabel = (environmentId: EnvironmentId) =>
    environments.find((environment) => environment.environmentId === environmentId)?.label ??
    "Computer";
  const computerLabel = taskProject ? environmentLabel(taskProject.environmentId) : null;
  const selectThread = useHomeThreadSelection();
  const { settleThread, unsettleThread, unsnoozeThread } = useThreadListActions();
  const openSettings = () => {
    if (!onlineProject) return;
    navigation.navigate("SettingsSheet", {
      screen: "SettingsContent",
      params: {
        screen: "SettingsProjectOverview",
        params: {
          initialEnvironmentId: onlineProject.environmentId,
          initialProjectId: onlineProject.id,
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
  useEffect(() => {
    if (nextSnoozeWakeAt === null) return;
    const timer = setTimeout(
      () => setNow(new Date().toISOString()),
      Math.min(Math.max(0, nextSnoozeWakeAt - Date.parse(now)) + 50, 2_147_483_647),
    );
    return () => clearTimeout(timer);
  }, [nextSnoozeWakeAt, now]);
  const items = useMemo(() => projectHomeListItems(model, visibleCounts), [model, visibleCounts]);
  const renderItem = ({ item }: { readonly item: ProjectHomeListItem }) => {
    if (item.type === "overview")
      return (
        <View className="gap-5 px-4 pt-4 pb-6">
          <View className="gap-2">
            <Text accessibilityRole="header" className="text-2xl font-t3-bold text-foreground">
              {scope?.title}
            </Text>
            <Text className="text-sm text-foreground-muted">
              {model.counts.total} {model.counts.total === 1 ? "conversation" : "conversations"}{" "}
              across {scope?.projects.length}{" "}
              {scope?.projects.length === 1 ? "checkout" : "checkouts"}
            </Text>
            <Text className="text-sm leading-normal text-foreground-muted">
              Your project and conversations stay here when working files are released. Starting a
              task restores its selected checkout when needed.
            </Text>
            {model.counts.offline > 0 ? (
              <Text className="text-sm text-foreground-muted">
                {model.counts.offline} conversations are last known on offline computers. Their
                saved activity is not live.
              </Text>
            ) : null}
          </View>
          <SettingsSection title="Start work">
            <View className="gap-3 p-4">
              <Text className="text-sm text-foreground-muted">
                Choose the computer for the next task. Changing this choice leaves existing work
                where it is.
              </Text>
              <MaterialButton
                tone="primary"
                label={computerLabel ? `New task on ${computerLabel}` : "New task"}
                disabled={taskProject === null}
                onPress={() => {
                  if (
                    !taskProject ||
                    !readEnvironmentScope(taskProject.environmentId, AuthOrchestrationOperateScope)
                  )
                    return;
                  navigation.navigate("NewTaskSheet", {
                    screen: "NewTaskDraft",
                    params: {
                      environmentId: taskProject.environmentId,
                      projectId: taskProject.id,
                      title: scope?.title,
                    },
                  });
                }}
              />
              {taskProject === null ? (
                <Text className="text-sm text-foreground-muted">
                  {chosenProjectRef
                    ? "Your chosen checkout is unavailable or read-only. Choose another computer to start a task."
                    : "Reconnect a computer with task access to start work."}
                </Text>
              ) : null}
            </View>
            {scope?.projects.map((project, index) => {
              const connected = connectedEnvironmentIds.has(project.environmentId);
              const allowed = permittedEnvironmentIds.has(project.environmentId);
              const selected = chosenProjectRef
                ? chosenProjectRef.environmentId === project.environmentId &&
                  chosenProjectRef.projectId === project.id
                : taskProject?.environmentId === project.environmentId &&
                  taskProject.id === project.id;
              return (
                <ListChoiceRow
                  key={scopedProjectKey(project.environmentId, project.id)}
                  label={environmentLabel(project.environmentId)}
                  description={`${
                    connected
                      ? allowed
                        ? "Connected with task access"
                        : "Connected, read-only"
                      : "Offline, reconnect to start work"
                  }
${project.workspaceRoot}`}
                  selected={selected}
                  disabled={!connected || !allowed}
                  separated={index > 0}
                  onPress={() =>
                    setChosenProjectRef({
                      environmentId: project.environmentId,
                      projectId: project.id,
                    })
                  }
                />
              );
            })}
          </SettingsSection>
          <View className="flex-row flex-wrap gap-3">
            <MaterialButton
              label="Project settings"
              disabled={onlineProject === undefined}
              onPress={openSettings}
            />
            <MaterialButton
              label="Prepare another computer"
              disabled={onlineProject === undefined}
              onPress={() => {
                if (onlineProject)
                  navigation.navigate("ProjectPreparation", {
                    environmentId: onlineProject.environmentId,
                    projectId: onlineProject.id,
                  });
              }}
            />
            <MaterialButton
              label="Review storage"
              onPress={() => navigation.navigate("ProjectStorageInventory")}
            />
          </View>
          {model.counts.total === 0 ? (
            <Text className="text-sm text-foreground-muted">
              No conversations yet. Start a task to begin this project.
            </Text>
          ) : null}
        </View>
      );
    if (item.type === "section")
      return (
        <View className="flex-row items-center justify-between px-4 pt-5 pb-2">
          <Text accessibilityRole="header" className="text-lg font-t3-semibold text-foreground">
            {item.title}
          </Text>
          <Text className="text-sm text-foreground-muted">{item.count}</Text>
        </View>
      );
    if (item.type === "more")
      return (
        <View className="px-4 py-2">
          <MaterialButton
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
      const lifecycleActions = projectHomeThreadActions({
        activity,
        connected,
        permitted: permittedEnvironmentIds.has(thread.environmentId),
        settlementSupported: settlementEnvironmentIds.has(thread.environmentId),
        snoozeSupported: snoozeEnvironmentIds.has(thread.environmentId),
      });
      return (
        <View className="flex-row items-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${thread.title}, ${connected ? ACTIVITY_LABELS[activity] : "Offline, last known"}, ${environmentLabel(thread.environmentId)}`}
            onPress={() => selectThread(thread)}
            className="min-h-[56px] min-w-0 flex-1 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
          >
            <SymbolView
              name={connected ? ACTIVITY_ICONS[activity] : "wifi.slash"}
              size={20}
              tintColorClassName={
                connected && activity === "failed"
                  ? "accent-danger-foreground"
                  : connected && activity === "attention"
                    ? "accent-warning-foreground"
                    : "accent-icon-muted"
              }
            />
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-sm font-t3-medium text-foreground" numberOfLines={2}>
                {thread.title}
              </Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={2}>
                {environmentLabel(thread.environmentId)} ·{" "}
                {connected ? ACTIVITY_LABELS[activity] : `Last known: ${ACTIVITY_LABELS[activity]}`}{" "}
                · {relativeTime(thread.updatedAt)}
              </Text>
            </View>
            <SymbolView name="chevron.right" size={13} tintColorClassName="accent-icon-muted" />
          </Pressable>
          {lifecycleActions.length > 0 ? (
            <ControlPillMenu
              actions={[...lifecycleActions]}
              onPressAction={({ nativeEvent }) => {
                if (nativeEvent.event === "settle") void settleThread(thread);
                if (nativeEvent.event === "reopen") void unsettleThread(thread);
                if (nativeEvent.event === "wake") void unsnoozeThread(thread);
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Actions for ${thread.title}`}
                className="h-[44px] w-[44px] items-center justify-center"
              >
                <SymbolView name="ellipsis" size={18} tintColorClassName="accent-icon-muted" />
              </Pressable>
            </ControlPillMenu>
          ) : null}
        </View>
      );
    }
    return (
      <View className="gap-4 px-4 pt-6 pb-4">
        <Text accessibilityRole="header" className="text-lg font-t3-semibold text-foreground">
          Computers and working files
        </Text>
        <Text className="text-sm leading-normal text-foreground-muted">
          Review a checkout to see its current storage state and choose Keep, Release when settled,
          or the computer's default. Reviewing does not restore files.
        </Text>
        {scope?.projects.map((project) => {
          const key = scopedProjectKey(project.environmentId, project.id);
          const connected = connectedEnvironmentIds.has(project.environmentId);
          return (
            <View key={key} className="gap-3 rounded-2xl bg-card p-4">
              <Text className="text-base font-t3-medium text-foreground">
                {environmentLabel(project.environmentId)}
              </Text>
              <Text className="text-sm text-foreground-muted">
                {connected ? "Connected" : "Offline. Reconnect to review storage."}
              </Text>
              <Text selectable className="text-xs leading-normal text-foreground-muted">
                {project.workspaceRoot}
              </Text>
              <MaterialButton
                label={
                  connected && reviewProjectKey === key
                    ? "Hide storage review"
                    : "Review this checkout"
                }
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
    );
  };
  return (
    <View className="flex-1 bg-screen">
      <ScreenHeader
        title={scope?.title ?? "Project home"}
        onBack={() => navigation.goBack()}
        backInSplitView={{ accessibilityLabel: "Back to projects", icon: "arrow.left" }}
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
          onAction={() => navigation.goBack()}
        />
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
