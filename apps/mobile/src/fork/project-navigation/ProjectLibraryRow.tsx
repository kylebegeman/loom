import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import {
  createProjectLibraryPresentation,
  buildProjectHomeComputerChoices,
  projectHomeComputerChoiceKey,
  PROJECT_LIBRARY_PREVIEW_LIMIT,
} from "@t3tools/client-runtime/fork";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Menu } from "../../components/ui/Menu";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { HomeProjectScope } from "../../features/home/homeThreadList";
import { readEnvironmentScope } from "../../state/session";
import { projectTaskDestination } from "./projectNavigation.logic";
import type { ProjectLibraryItem } from "./useProjectLibrary";

export function ProjectLibraryRow(props: {
  readonly item: ProjectLibraryItem;
  readonly computerNames: ReadonlyMap<string, string>;
  readonly connectedEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly operableEnvironmentIds: ReadonlySet<EnvironmentId>;
  readonly selectedThreadKey?: string | null;
  readonly onToggle: (key: string) => void;
  readonly onViewThreads: (scope: HomeProjectScope) => void;
  readonly onSelectThread: (thread: EnvironmentThreadShell) => void;
  readonly onNewThreadInProject: (project: EnvironmentProject) => void;
}) {
  const navigation = useNavigation();
  const { entry, expanded, previewForcedOpen } = props.item;
  const representative = entry.group.representative;
  const presentation = createProjectLibraryPresentation(
    entry,
    props.computerNames,
    props.connectedEnvironmentIds,
  );
  const urgentStatus =
    presentation.status?.kind === "attention" ||
    presentation.status?.kind === "failed" ||
    presentation.status?.kind === "working"
      ? presentation.status
      : null;
  const onlineProject = props.connectedEnvironmentIds.has(representative.environmentId)
    ? representative
    : entry.group.projects.find((project) =>
        props.connectedEnvironmentIds.has(project.environmentId),
      );
  const taskProject = projectTaskDestination(
    entry.group,
    props.connectedEnvironmentIds,
    props.operableEnvironmentIds,
  );
  const computerChoices = buildProjectHomeComputerChoices({
    projects: entry.group.projects,
    environmentLabels: new Map(
      entry.environmentIds.map((id) => [id, props.computerNames.get(id) ?? "Computer"]),
    ),
    connectedEnvironmentIds: props.connectedEnvironmentIds,
    permittedEnvironmentIds: props.operableEnvironmentIds,
  });
  const taskComputerName = taskProject
    ? (computerChoices.find((choice) => choice.value === projectHomeComputerChoiceKey(taskProject))
        ?.triggerLabel ??
      props.computerNames.get(taskProject.environmentId) ??
      "Computer")
    : null;
  return (
    <View className="mx-2 mb-1">
      <View className="flex-row items-center">
        {previewForcedOpen ? (
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-[44px] w-[44px] items-center justify-center opacity-45"
          >
            <SymbolView name="chevron.down" size={12} tintColorClassName="accent-icon-muted" />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${expanded ? "Hide" : "Show"} thread preview for ${entry.title}`}
            accessibilityState={{ expanded }}
            onPress={() => props.onToggle(entry.key)}
            className="h-[44px] w-[44px] items-center justify-center active:opacity-70"
          >
            <SymbolView
              name={expanded ? "chevron.down" : "chevron.right"}
              size={12}
              tintColorClassName="accent-icon-muted"
            />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open computer folder for ${entry.title}`}
          accessibilityHint={`${presentation.accessibilitySummary}${previewForcedOpen ? ". Matching thread previews are shown while searching." : ""}`}
          onPress={() =>
            navigation.navigate("ProjectHome", {
              environmentId: representative.environmentId,
              projectId: representative.id,
            })
          }
          className="min-h-[64px] min-w-0 flex-1 flex-row items-start gap-3 py-3 active:opacity-70"
        >
          <View
            className="pt-0.5"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <ProjectFavicon
              environmentId={representative.environmentId}
              projectTitle={representative.title}
              workspaceRoot={representative.workspaceRoot}
              faviconPath={representative.faviconPath}
              projectIcon={representative.projectIcon}
              open={expanded}
              size={24}
            />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-t3-medium text-foreground">{entry.title}</Text>
            <Text className="text-xs text-foreground-muted">{presentation.metadata}</Text>
            {urgentStatus ? (
              <Text
                className={cn(
                  "text-2xs font-t3-medium",
                  urgentStatus.kind === "attention"
                    ? "text-warning-foreground"
                    : urgentStatus.kind === "failed"
                      ? "text-danger-foreground"
                      : "text-adaptive-sky-600-400",
                )}
              >
                {urgentStatus.label}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Menu
          actions={[
            {
              id: "new-task",
              title: taskComputerName ? `New task on ${taskComputerName}` : "New task",
              image: "square.and.pencil",
              attributes: { disabled: taskProject === null },
            },
            {
              id: "settings",
              title: "Project settings",
              image: "gearshape",
              attributes: { disabled: onlineProject === undefined },
            },
          ]}
          onPressAction={({ nativeEvent }) => {
            if (
              nativeEvent.event === "new-task" &&
              taskProject &&
              readEnvironmentScope(taskProject.environmentId, AuthOrchestrationOperateScope)
            )
              props.onNewThreadInProject(taskProject);
            if (nativeEvent.event === "settings" && onlineProject)
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
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Actions for ${entry.title}`}
            accessibilityHint={
              taskProject === null
                ? onlineProject === undefined
                  ? "Reconnect a computer to start a task or change settings."
                  : "New tasks need a connection with task access."
                : `New task on ${taskComputerName} and project settings.`
            }
            className="h-[44px] w-[44px] items-center justify-center active:opacity-70"
          >
            <SymbolView name="ellipsis" size={17} tintColorClassName="accent-icon-muted" />
          </Pressable>
        </Menu>
      </View>
      {expanded ? (
        <View className="pb-2">
          {entry.previewThreads.length === 0 ? (
            <Text className="pl-[80px] pr-4 pb-2 text-xs text-foreground-muted">
              Start a task from this project's home.
            </Text>
          ) : (
            entry.previewThreads.slice(0, PROJECT_LIBRARY_PREVIEW_LIMIT).map((thread) => {
              const online = props.connectedEnvironmentIds.has(thread.environmentId);
              const selected =
                scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey;
              return (
                <Pressable
                  key={scopedThreadKey(thread.environmentId, thread.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${thread.title} on ${props.computerNames.get(thread.environmentId) ?? "Computer"}${online ? "" : ", computer offline"}`}
                  accessibilityState={{ selected }}
                  onPress={() => props.onSelectThread(thread)}
                  className={cn(
                    "min-h-[44px] min-w-0 flex-row items-start gap-3 rounded-lg pl-[80px] pr-4 py-2 active:opacity-70",
                    selected && "bg-subtle-strong",
                  )}
                >
                  <View className="pt-0.5">
                    <SymbolView
                      name={
                        online ? { ios: "text.bubble.fill", android: "chat_bubble" } : "wifi.slash"
                      }
                      size={15}
                      tintColorClassName="accent-icon-muted"
                    />
                  </View>
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-sm text-foreground" numberOfLines={2}>
                      {thread.title}
                    </Text>
                    {entry.environmentIds.length > 1 || !online ? (
                      <Text className="text-2xs text-foreground-muted">
                        {props.computerNames.get(thread.environmentId) ?? "Computer"}
                        {online ? "" : " · Offline, last known"}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })
          )}
          {entry.threadCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${entry.title} in Threads view, ${entry.threadCount} ${entry.threadCount === 1 ? "thread" : "threads"}`}
              onPress={() => props.onViewThreads(entry.group)}
              className="min-h-[44px] justify-center pl-[108px] pr-4 active:opacity-70"
            >
              <Text className="text-xs font-t3-medium text-foreground-muted">
                Open in Threads ({entry.threadCount})
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
