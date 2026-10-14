import { LegendList } from "@legendapp/list/react-native";
import {
  projectStorageRolloutComputerLabels,
  projectStorageRolloutTargetReason,
} from "@t3tools/client-runtime/fork";
import { useNavigation } from "@react-navigation/native";
import { useMemo, useState, type ComponentProps } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { MaterialButton } from "../../components/MaterialButton";
import { ScreenHeader } from "../../components/ScreenHeader";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { SymbolView } from "../../components/AppSymbol";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useWorkspaceState } from "../../state/workspace";
import { ProjectStorageRolloutQueue } from "../project-checkout/storageRollout/ProjectStorageRolloutQueue";
import { useProjectStorageRollout } from "../project-checkout/storageRollout/useProjectStorageRollout";
import {
  PROJECT_STORAGE_INVENTORY_PAGE_SIZE,
  projectStorageInventory,
} from "./projectStorageInventory";

function renderInventoryScrollView(props: ComponentProps<typeof ScreenScrollView>) {
  return <ScreenScrollView {...props} />;
}

/** Only explicitly selected known folders are reviewed; opening this list changes nothing. */
export function ProjectStorageInventoryRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const { state: catalog } = useWorkspaceState();
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PROJECT_STORAGE_INVENTORY_PAGE_SIZE);
  const { controller, snapshot } = useProjectStorageRollout();
  const busy = snapshot.phase === "reviewing" || snapshot.phase === "saving";
  const rowsByKey = useMemo(
    () => new Map(snapshot.rows.map((row) => [row.key, row])),
    [snapshot.rows],
  );
  const computerNames = useMemo(
    () =>
      projectStorageRolloutComputerLabels(
        new Map(environments.map((environment) => [environment.environmentId, environment.label])),
      ),
    [environments],
  );
  const records = useMemo(
    () => projectStorageInventory(projects, computerNames, query),
    [projects, computerNames, query],
  );
  const visibleRecords = useMemo(() => records.slice(0, visibleCount), [records, visibleCount]);
  const listExtraData = useMemo(() => ({ rowsByKey, busy }), [rowsByKey, busy]);
  return (
    <View className="flex-1 bg-screen">
      <ScreenHeader
        title="Project storage"
        onBack={() => navigation.goBack()}
        backInSplitView={{ accessibilityLabel: "Back to projects", icon: "arrow.left" }}
        search={{
          value: query,
          placeholder: "Search projects or computers",
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
              Select known folders to review their storage preferences. No files change until you
              confirm your choices.
            </Text>
            <ProjectStorageRolloutQueue controller={controller} snapshot={snapshot} />
            <View className="flex-row items-center justify-between gap-3 px-2 pt-1">
              <Text
                accessibilityRole="header"
                className="text-sm font-t3-medium text-foreground-muted"
              >
                Known folders
              </Text>
              <Text className="text-xs tabular-nums text-foreground-muted">
                {records.length} {query.trim() ? "matching" : "total"}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            variant="plain"
            title={
              catalog.isLoadingConnections || !catalog.hasLoadedShellSnapshot
                ? "Loading project storage"
                : query.trim()
                  ? "No matching checkouts"
                  : "No project checkouts yet"
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
              <MaterialButton
                label={`Show more (${records.length - visibleCount})`}
                onPress={() =>
                  setVisibleCount((count) => count + PROJECT_STORAGE_INVENTORY_PAGE_SIZE)
                }
              />
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          const { project, computerLabel, key } = item;
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
            <View
              className={
                index === 0 && visibleRecords.length === 1
                  ? "overflow-hidden rounded-[24px] border-continuous bg-grouped-card"
                  : index === 0
                    ? "overflow-hidden rounded-t-[24px] border-continuous bg-grouped-card"
                    : index === visibleRecords.length - 1
                      ? "overflow-hidden rounded-b-[24px] border-continuous bg-grouped-card"
                      : "overflow-hidden bg-grouped-card"
              }
            >
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${project.title} on ${computerLabel}`}
                accessibilityHint={`${project.workspaceRoot}. ${saved ? "Preference saved." : accessLabel}`}
                accessibilityState={{ checked: selected || saved, disabled: busy || saved || !row }}
                disabled={busy || saved || !row}
                onPress={() => controller.setSelected(key, !selected)}
                className={
                  index === 0
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
                  <Text className="text-sm font-t3-medium text-foreground" numberOfLines={1}>
                    {project.title}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {computerLabel} · {saved ? "Saved" : accessLabel}
                  </Text>
                  <Text
                    className="text-xs text-foreground-muted"
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {project.workspaceRoot}
                  </Text>
                </View>
              </Pressable>
            </View>
          );
        }}
      />
    </View>
  );
}
