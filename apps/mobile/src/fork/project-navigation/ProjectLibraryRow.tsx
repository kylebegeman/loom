import { AuthOrchestrationOperateScope, type EnvironmentId } from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { useNavigation } from "@react-navigation/native";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
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
  const { entry, expanded } = props.item;
  const computerNames = entry.environmentIds.map((id) => props.computerNames.get(id) ?? "Computer");
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
  const activity = [
    entry.attentionCount > 0 ? `${entry.attentionCount} need attention` : null,
    entry.workingCount > 0 ? `${entry.workingCount} working` : null,
    entry.failedCount > 0 ? `${entry.failedCount} failed` : null,
    entry.readyCount > 0 ? `${entry.readyCount} ready` : null,
    entry.snoozedCount > 0 ? `${entry.snoozedCount} snoozed` : null,
    entry.settledCount > 0 ? `${entry.settledCount} settled` : null,
    entry.offlineCount > 0 ? `${entry.offlineCount} offline` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View className="mx-2 mb-2 overflow-hidden rounded-2xl border-continuous bg-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.title}, ${entry.threadCount} ${entry.threadCount === 1 ? "thread" : "threads"}, ${computerNames.join(", ")}${activity ? `, ${activity}` : ""}`}
        accessibilityState={{ expanded }}
        onPress={() => props.onToggle(entry.key)}
        className="min-h-16 flex-row items-center gap-3 px-4 py-3 active:opacity-70"
      >
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-subtle">
          <SymbolView
            name={expanded ? { ios: "folder.fill", android: "folder_open" } : "folder"}
            size={20}
            tintColorClassName="accent-icon"
          />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={2}>
            {entry.title}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={2}>
            {entry.threadCount === 1 ? "1 thread" : `${entry.threadCount} threads`} ·{" "}
            {computerNames.join(", ")}
          </Text>
          {activity ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={2}>
              {activity}
            </Text>
          ) : null}
        </View>
        <SymbolView
          name={expanded ? "chevron.up" : "chevron.down"}
          size={13}
          tintColorClassName="accent-icon-muted"
        />
      </Pressable>
      {expanded ? (
        <View>
          {entry.previewThreads.length === 0 ? (
            <Text className="px-4 pb-3 text-sm text-foreground-muted">
              No threads yet. This project stays available when its files are released.
            </Text>
          ) : (
            entry.previewThreads.map((thread) => {
              const online = props.connectedEnvironmentIds.has(thread.environmentId);
              return (
                <Pressable
                  key={scopedThreadKey(thread.environmentId, thread.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${thread.title}${online ? "" : ", computer offline"}`}
                  accessibilityState={{
                    selected:
                      scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey,
                  }}
                  onPress={() => props.onSelectThread(thread)}
                  className={cn(
                    "min-h-12 flex-row items-center gap-3 px-4 py-2 active:opacity-70",
                    scopedThreadKey(thread.environmentId, thread.id) === props.selectedThreadKey &&
                      "bg-subtle-strong",
                  )}
                >
                  <SymbolView name="text.bubble" size={16} tintColorClassName="accent-icon-muted" />
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
          <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-2 pb-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View all threads in ${entry.title}`}
              onPress={() => props.onViewThreads(entry.group)}
              className="min-h-10 justify-center active:opacity-70"
            >
              <Text className="text-sm font-t3-medium text-primary">
                View threads{entry.hiddenThreadCount > 0 ? ` (${entry.threadCount})` : ""}
              </Text>
            </Pressable>
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
              className="min-h-10 justify-center active:opacity-70"
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
              className="min-h-10 justify-center active:opacity-70"
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
          {taskProject === null ? (
            <Text className="px-4 pb-3 text-xs text-foreground-muted">
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
