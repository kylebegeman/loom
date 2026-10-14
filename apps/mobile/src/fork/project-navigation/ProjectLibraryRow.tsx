import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import {
  createProjectLibraryPresentation,
  PROJECT_LIBRARY_PREVIEW_LIMIT,
} from "@t3tools/client-runtime/fork";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";
import { Pressable, useWindowDimensions, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import { scopedThreadKey } from "../../lib/scopedEntities";
import type { HomeProjectScope } from "../../features/home/homeThreadList";
import { readEnvironmentScope } from "../../state/session";
import { projectTaskDestination } from "./projectNavigation.logic";
import type { ProjectLibraryItem } from "./useProjectLibrary";

const STATUS_BADGE_STYLE = {
  attention: { surface: "bg-warning", text: "text-warning-foreground" },
  failed: { surface: "bg-danger", text: "text-danger-foreground" },
  working: { surface: "bg-subtle", text: "text-adaptive-sky-600-400" },
  ready: { surface: "bg-subtle", text: "text-foreground-muted" },
  snoozed: { surface: "bg-subtle", text: "text-foreground-muted" },
  settled: { surface: "bg-subtle", text: "text-foreground-muted" },
  offline: { surface: "bg-subtle", text: "text-foreground-muted" },
} as const;

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
  const { fontScale } = useWindowDimensions();
  const { entry, expanded, previewForcedOpen } = props.item;
  const presentation = createProjectLibraryPresentation(
    entry,
    props.computerNames,
    props.connectedEnvironmentIds,
  );
  const badgeStyle = presentation.status ? STATUS_BADGE_STYLE[presentation.status.kind] : null;
  const onlineProject = props.connectedEnvironmentIds.has(entry.group.representative.environmentId)
    ? entry.group.representative
    : entry.group.projects.find((project) =>
        props.connectedEnvironmentIds.has(project.environmentId),
      );
  const taskProject = projectTaskDestination(
    entry.group,
    props.connectedEnvironmentIds,
    props.operableEnvironmentIds,
  );
  const taskComputerName = taskProject
    ? (props.computerNames.get(taskProject.environmentId) ?? "Computer")
    : null;
  return (
    <View className="mx-2 mb-1">
      <View className="flex-row items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open project home for ${entry.title}`}
          accessibilityHint={`${presentation.accessibilitySummary}${previewForcedOpen ? ". Matching thread previews are shown while searching." : ""}`}
          onPress={() =>
            navigation.navigate("ProjectHome", {
              environmentId: entry.group.representative.environmentId,
              projectId: entry.group.representative.id,
            })
          }
          className="min-h-[64px] min-w-0 flex-1 flex-row items-start gap-3 pl-4 py-3 active:opacity-70"
        >
          <View className="w-6 items-center justify-center pt-0.5">
            <SymbolView
              name={{ ios: "folder.fill", android: "folder" }}
              size={20}
              tintColorClassName="accent-icon"
            />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View
              className={cn("gap-2", fontScale >= 1.5 ? "items-start" : "flex-row items-start")}
            >
              <Text
                className={cn(
                  "text-base font-t3-medium text-foreground",
                  fontScale < 1.5 && "min-w-0 flex-1",
                )}
              >
                {entry.title}
              </Text>
              {presentation.status && badgeStyle ? (
                <View
                  className={cn("max-w-full shrink-0 rounded-full px-2 py-0.5", badgeStyle.surface)}
                >
                  <Text className={cn("text-2xs font-t3-medium", badgeStyle.text)}>
                    {presentation.status.label}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text className="text-xs text-foreground-muted">{presentation.metadata}</Text>
          </View>
        </Pressable>
        {previewForcedOpen ? (
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-[44px] w-[44px] items-center justify-center opacity-45"
          >
            <SymbolView name="chevron.up" size={13} tintColorClassName="accent-icon-muted" />
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
              name={expanded ? "chevron.up" : "chevron.down"}
              size={13}
              tintColorClassName="accent-icon-muted"
            />
          </Pressable>
        )}
      </View>
      {expanded ? (
        <View>
          <View className="flex-row flex-wrap items-center gap-x-5 gap-y-1 pl-[52px] pr-4 pb-1">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`New task in ${entry.title}${taskComputerName ? ` on ${taskComputerName}` : ""}`}
              accessibilityState={{ disabled: taskProject === null }}
              disabled={taskProject === null}
              onPress={() => {
                if (
                  taskProject &&
                  readEnvironmentScope(taskProject.environmentId, AuthOrchestrationOperateScope)
                )
                  props.onNewThreadInProject(taskProject);
              }}
              className="min-h-[44px] min-w-0 max-w-full justify-center active:opacity-70"
            >
              <Text
                className={cn(
                  "text-sm font-t3-medium",
                  taskProject ? "text-foreground" : "text-foreground-muted",
                )}
              >
                {taskComputerName ? `New task on ${taskComputerName}` : "New task"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Settings for ${entry.title}`}
              accessibilityState={{ disabled: onlineProject === undefined }}
              disabled={onlineProject === undefined}
              onPress={() => {
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
              }}
              className="min-h-[44px] min-w-0 max-w-full justify-center active:opacity-70"
            >
              <Text
                className={cn(
                  "text-sm font-t3-medium",
                  onlineProject ? "text-foreground" : "text-foreground-muted",
                )}
              >
                Settings
              </Text>
            </Pressable>
          </View>
          {entry.previewThreads.length === 0 ? (
            <Text className="pl-[52px] pr-4 pb-3 text-sm text-foreground-muted">
              No threads yet. This project stays available when its files are released.
            </Text>
          ) : (
            entry.previewThreads.slice(0, PROJECT_LIBRARY_PREVIEW_LIMIT).map((thread) => {
              const online = props.connectedEnvironmentIds.has(thread.environmentId);
              return (
                <Pressable
                  key={scopedThreadKey(thread.environmentId, thread.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${thread.title} on ${props.computerNames.get(thread.environmentId) ?? "Computer"}${online ? "" : ", computer offline"}`}
                  accessibilityState={{
                    selected:
                      scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey,
                  }}
                  onPress={() => props.onSelectThread(thread)}
                  className={cn(
                    "min-h-12 flex-row items-center gap-3 pl-[52px] pr-4 py-2 active:opacity-70",
                    scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey &&
                      "bg-subtle-strong",
                  )}
                >
                  <SymbolView
                    name={{ ios: "text.bubble.fill", android: "chat_bubble" }}
                    size={16}
                    tintColorClassName="accent-icon-muted"
                  />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm text-foreground" numberOfLines={2}>
                      {thread.title}
                    </Text>
                    {entry.environmentIds.length > 1 || !online ? (
                      <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                        {props.computerNames.get(thread.environmentId) ?? "Computer"}
                        {online ? "" : " · Offline, last known"}
                      </Text>
                    ) : null}
                  </View>
                  <SymbolView
                    name="chevron.right"
                    size={12}
                    tintColorClassName="accent-icon-muted"
                  />
                </Pressable>
              );
            })
          )}
          {entry.threadCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View all ${entry.threadCount} threads in ${entry.title}`}
              onPress={() => props.onViewThreads(entry.group)}
              className="min-h-[44px] justify-center pl-[52px] pr-4 active:opacity-70"
            >
              <Text className="text-sm font-t3-medium text-primary">
                View all ({entry.threadCount})
              </Text>
            </Pressable>
          ) : null}
          {taskProject === null ? (
            <Text className="pl-[52px] pr-4 pb-3 text-xs text-foreground-muted">
              {onlineProject === undefined
                ? "Reconnect a computer to start a task or change project settings."
                : "These connected project checkouts are read-only. Use a connection with task access to start work."}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
