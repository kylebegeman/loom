import { LegendList } from "@legendapp/list/react-native";
import {
  projectStorageRolloutComputerLabels,
  projectStorageRolloutTargetReason,
} from "@t3tools/client-runtime/fork";
import { useNavigation } from "@react-navigation/native";
import { useMemo, useState, type ComponentProps } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { EmptyState } from "../../components/ui/EmptyState";
import { Button } from "../../components/ui/Button";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { AppBar } from "../../components/ui/AppBar";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useMobileProjectGroupingSettings } from "../../state/project-grouping";
import { useWorkspaceState } from "../../state/workspace";
import { ProjectStorageRolloutQueue } from "../project-checkout/storageRollout/ProjectStorageRolloutQueue";
import { useProjectStorageRollout } from "../project-checkout/storageRollout/useProjectStorageRollout";
import {
  PROJECT_STORAGE_INVENTORY_PAGE_SIZE,
  filterProjectStorageInventory,
  projectStorageInventory,
} from "./projectStorageInventory";

function renderInventoryScrollView(props: ComponentProps<typeof ScreenScrollView>) {
  return <ScreenScrollView {...props} />;
}

/** Only explicitly selected known working-file locations are reviewed; opening this list changes nothing. */
export function ProjectStorageInventoryRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const grouping = useMobileProjectGroupingSettings();
  const { environments } = useEnvironments();
  const { state: catalog } = useWorkspaceState();
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PROJECT_STORAGE_INVENTORY_PAGE_SIZE);
  const computerNames = useMemo(
    () =>
      projectStorageRolloutComputerLabels(
        new Map(environments.map((environment) => [environment.environmentId, environment.label])),
      ),
    [environments],
  );
  const knownRecords = useMemo(
    () => projectStorageInventory(projects, computerNames, "", grouping.sidebarProjectGroupingMode),
    [projects, computerNames, grouping.sidebarProjectGroupingMode],
  );
  const projectNames = useMemo(
    () => new Map(knownRecords.map((entry) => [entry.key, entry.groupTitle])),
    [knownRecords],
  );
  const { controller, snapshot } = useProjectStorageRollout(projectNames);
  const busy = snapshot.phase === "reviewing" || snapshot.phase === "saving";
  const rowsByKey = useMemo(
    () => new Map(snapshot.rows.map((row) => [row.key, row])),
    [snapshot.rows],
  );
  const records = useMemo(
    () => filterProjectStorageInventory(knownRecords, query),
    [knownRecords, query],
  );
  const visibleRecords = useMemo(() => records.slice(0, visibleCount), [records, visibleCount]);
  const listExtraData = useMemo(() => ({ rowsByKey, busy }), [rowsByKey, busy]);
  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title="Files on computers"
        onBack={() => navigation.goBack()}
        backInSplitView={{ accessibilityLabel: "Back to projects", icon: "arrow.left" }}
        search={{
          value: query,
          placeholder: "Search projects, computers or locations",
          onChangeText: (value) => {
            setQuery(value);
            setVisibleCount(PROJECT_STORAGE_INVENTORY_PAGE_SIZE);
          },
        }}
      />
      <LegendList
        data={visibleRecords}
        keyExtractor={(entry) => entry.key}
        estimatedItemSize={84}
        recycleItems={false}
        extraData={listExtraData}
        renderScrollComponent={Platform.OS === "ios" ? renderInventoryScrollView : undefined}
        automaticallyAdjustContentInsets={Platform.OS === "ios"}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 20,
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
          paddingBottom: Math.max(insets.bottom, 24) + 24,
        }}
        style={{ flex: 1 }}
        ListHeaderComponent={
          <View className="gap-5 pt-4 pb-2">
            <Text className="px-2 text-xs leading-normal text-foreground-muted">
              Projects and threads stay in Loom. These are known working-file locations on your
              computers. Choose to keep files there, or safely free space after settling and restore
              them when you resume work.
            </Text>
            <ProjectStorageRolloutQueue controller={controller} snapshot={snapshot} />
            <View className="flex-row items-center justify-between gap-3 px-2 pt-1">
              <Text
                accessibilityRole="header"
                className="text-sm font-t3-medium text-foreground-muted"
              >
                Projects and working files
              </Text>
              <Text className="text-xs tabular-nums text-foreground-muted">
                {records.length} {query.trim() ? "matching locations" : "locations"}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            variant="plain"
            title={
              catalog.isLoadingConnections || !catalog.hasLoadedShellSnapshot
                ? "Loading working-file locations"
                : query.trim()
                  ? "No matching locations"
                  : "No working-file locations yet"
            }
            detail={
              catalog.isLoadingConnections || !catalog.hasLoadedShellSnapshot
                ? "Loading saved projects from your computers."
                : "Add a project or choose another search to review its working files."
            }
          />
        }
        ListFooterComponent={
          visibleCount < records.length ? (
            <View className="py-4">
              <Button
                label={`Show more (${records.length - visibleCount})`}
                onPress={() =>
                  setVisibleCount((count) => count + PROJECT_STORAGE_INVENTORY_PAGE_SIZE)
                }
              />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const { project, computerLabel, key, groupKey, groupTitle, recordLabel } = item;
          const firstInProject = visibleRecords[index - 1]?.groupKey !== groupKey;
          const lastInProject = visibleRecords[index + 1]?.groupKey !== groupKey;
          const row = rowsByKey.get(key);
          const selected = row?.selected === true;
          const saved = row?.status === "saved";
          const reason = row
            ? projectStorageRolloutTargetReason(row.target)
            : "Loading storage access…";
          const accessLabel =
            reason ??
            (!row?.target.canAdopt && !row?.target.canSetRetention
              ? "Review only, settings permission required to save"
              : selected
                ? "Selected for review"
                : "Connected, select to review");
          return (
            <View>
              {firstInProject ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open project ${groupTitle} and its threads`}
                  onPress={() =>
                    navigation.navigate("ProjectHome", {
                      environmentId: project.environmentId,
                      projectId: project.id,
                    })
                  }
                  className="min-h-[44px] flex-row items-center gap-2.5 px-2 pt-5 pb-2 active:opacity-70"
                >
                  <ProjectFavicon
                    environmentId={project.environmentId}
                    projectTitle={groupTitle}
                    workspaceRoot={project.workspaceRoot}
                    faviconPath={project.faviconPath}
                    projectIcon={project.projectIcon}
                    size={20}
                  />
                  <Text className="min-w-0 flex-1 text-sm font-t3-medium text-foreground">
                    {groupTitle}
                  </Text>
                  <SymbolView
                    name="chevron.right"
                    size={12}
                    tintColorClassName="accent-icon-muted"
                  />
                </Pressable>
              ) : null}
              <View
                className={
                  firstInProject && lastInProject
                    ? "overflow-hidden rounded-[24px] border-continuous bg-grouped-card"
                    : firstInProject
                      ? "overflow-hidden rounded-t-[24px] border-continuous bg-grouped-card"
                      : lastInProject
                        ? "overflow-hidden rounded-b-[24px] border-continuous bg-grouped-card"
                        : "overflow-hidden bg-grouped-card"
                }
              >
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${groupTitle}, working files on ${computerLabel}${recordLabel ? `. ${recordLabel}` : ""}`}
                  accessibilityHint={`Project record ${project.title}, ${project.id}. Computer ${project.environmentId}. Location ${project.workspaceRoot}. ${saved ? "Preference saved." : accessLabel}`}
                  accessibilityState={{
                    checked: selected || saved,
                    disabled: busy || saved || !row,
                  }}
                  disabled={busy || saved || !row}
                  onPress={() => controller.setSelected(key, !selected)}
                  className={
                    firstInProject
                      ? "min-h-[80px] flex-row items-center gap-3 px-4 py-3 active:opacity-70"
                      : "min-h-[80px] flex-row items-center gap-3 border-t border-border-subtle px-4 py-3 active:opacity-70"
                  }
                >
                  <SymbolView
                    name={saved || selected ? "checkmark.circle.fill" : "circle"}
                    size={18}
                    tintColorClassName={
                      selected || saved ? "accent-primary-text" : "accent-icon-muted"
                    }
                  />
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-sm font-t3-medium text-foreground" numberOfLines={2}>
                      Working files on {computerLabel}
                    </Text>
                    {recordLabel ? (
                      <Text className="text-xs text-foreground-muted">{recordLabel}</Text>
                    ) : null}
                    <View className="min-w-0 flex-row gap-1">
                      <Text className="text-xs text-foreground-muted">Location</Text>
                      <Text
                        className="min-w-0 flex-1 text-xs text-foreground-muted"
                        numberOfLines={1}
                        ellipsizeMode="middle"
                      >
                        {project.workspaceRoot}
                      </Text>
                    </View>
                    <Text className="text-xs text-foreground-muted">
                      {saved ? "Saved" : accessLabel}
                    </Text>
                  </View>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
