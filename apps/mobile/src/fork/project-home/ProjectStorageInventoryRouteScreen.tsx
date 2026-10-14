import { LegendList } from "@legendapp/list/react-native";
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
import { ProjectCheckoutSection } from "../project-checkout/ProjectCheckoutSection";
import {
  PROJECT_STORAGE_INVENTORY_PAGE_SIZE,
  projectStorageInventory,
} from "./projectStorageInventory";

function renderInventoryScrollView(props: ComponentProps<typeof ScreenScrollView>) {
  return <ScreenScrollView {...props} />;
}

/** Reviews are loaded one checkout at a time; opening this inventory never changes storage. */
export function ProjectStorageInventoryRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const projects = useProjects();
  const { environments } = useEnvironments();
  const { state: catalog } = useWorkspaceState();
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PROJECT_STORAGE_INVENTORY_PAGE_SIZE);
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const computerNames = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
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
  const records = useMemo(
    () => projectStorageInventory(projects, computerNames, query),
    [projects, computerNames, query],
  );
  const visibleRecords = useMemo(() => records.slice(0, visibleCount), [records, visibleCount]);
  const listExtraData = useMemo(
    () => ({ reviewKey, connectedEnvironmentIds }),
    [reviewKey, connectedEnvironmentIds],
  );
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
            setReviewKey(null);
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
              Review existing project folders one at a time before Loom manages their working files.
              Nothing is adopted, released, or restored by opening this list.
            </Text>
            <Text className="text-sm text-foreground-muted">
              {records.length} known {records.length === 1 ? "checkout" : "checkouts"}. This list
              uses projects already in Loom and does not scan your filesystem.
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
          const connected = connectedEnvironmentIds.has(project.environmentId);
          const expanded = connected && reviewKey === key;
          return (
            <View className="mb-3 overflow-hidden rounded-2xl bg-card">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Review ${project.title} on ${computerLabel}${connected ? "" : ", computer offline"}`}
                accessibilityState={{ expanded, disabled: !connected }}
                disabled={!connected}
                onPress={() => setReviewKey((current) => (current === key ? null : key))}
                className="min-h-[72px] flex-row items-center gap-3 p-4 active:opacity-70"
              >
                <SymbolView name="folder" size={22} tintColorClassName="accent-icon" />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-base font-t3-medium text-foreground" numberOfLines={2}>
                    {project.title}
                  </Text>
                  <Text className="text-xs text-foreground-muted">
                    {computerLabel} ·{" "}
                    {connected
                      ? "Connected, open review for current storage state"
                      : "Offline, reconnect to review storage"}
                  </Text>
                  <Text className="text-xs text-foreground-muted" numberOfLines={2}>
                    {project.workspaceRoot}
                  </Text>
                </View>
                <SymbolView
                  name={expanded ? "chevron.up" : "chevron.down"}
                  size={14}
                  tintColorClassName="accent-icon-muted"
                />
              </Pressable>
              {connected && expanded ? (
                <View className="px-3 pb-3">
                  <ProjectCheckoutSection
                    environmentId={project.environmentId}
                    projectId={project.id}
                    workspaceRoot={project.workspaceRoot}
                    computerLabel={computerLabel}
                  />
                </View>
              ) : null}
            </View>
          );
        }}
      />
    </View>
  );
}
