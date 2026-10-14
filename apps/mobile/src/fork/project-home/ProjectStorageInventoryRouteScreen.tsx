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
        title="Review project storage"
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
        estimatedItemSize={132}
        recycleItems={false}
        extraData={listExtraData}
        renderScrollComponent={Platform.OS === "ios" ? renderInventoryScrollView : undefined}
        automaticallyAdjustContentInsets={Platform.OS === "ios"}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: Math.max(insets.bottom, 24) + 24,
        }}
        style={{ flex: 1 }}
        ListHeaderComponent={
          <View className="gap-2 pt-4 pb-5">
            <Text className="text-sm leading-normal text-foreground-muted">
              Select the folders you want to review. Choose a storage preference for each, then
              confirm the exact choices before saving. Opening this list changes no working files.
            </Text>
            <Text className="text-sm text-foreground-muted">
              {records.length} {query.trim() ? "matching" : "known"}{" "}
              {records.length === 1 ? "checkout" : "checkouts"}. This list uses projects already in
              Loom and does not scan your filesystem.
            </Text>
            <ProjectStorageRolloutQueue controller={controller} snapshot={snapshot} />
            <Text
              accessibilityRole="header"
              className="pt-3 text-base font-t3-medium text-foreground"
            >
              Known folders
            </Text>
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
        renderItem={({ item }) => {
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
            <View className="mb-3 overflow-hidden rounded-2xl bg-card">
              <Pressable
                accessibilityRole="checkbox"
                accessibilityLabel={`${project.title} on ${computerLabel}`}
                accessibilityHint={`${project.workspaceRoot}. ${saved ? "Preference saved." : accessLabel}`}
                accessibilityState={{ checked: selected || saved, disabled: busy || saved || !row }}
                disabled={busy || saved || !row}
                onPress={() => controller.setSelected(key, !selected)}
                className="min-h-[72px] flex-row items-center gap-3 p-4 active:opacity-70"
              >
                <SymbolView
                  name={saved || selected ? "checkmark.circle.fill" : "circle"}
                  size={22}
                  tintColorClassName={
                    selected || saved ? "accent-primary-text" : "accent-icon-muted"
                  }
                />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-base font-t3-medium text-foreground" numberOfLines={2}>
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
