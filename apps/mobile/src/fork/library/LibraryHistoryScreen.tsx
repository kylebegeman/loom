import { LegendList } from "@legendapp/list/react-native";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { shouldRefreshLibraryArchive } from "@t3tools/client-runtime/fork";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { LibraryArchiveFeedRow } from "./LibraryArchiveFeed";
import { libraryArchiveRows } from "./libraryArchive";
import { LibraryReplicationNotice } from "./LibraryReplicationNotice";
import { LibraryBriefSuggestionOffer, LibrarySuggestBriefUpdates } from "./LibraryBriefSuggestions";
import { LibraryNotice, LibraryPage } from "./LibraryScreens";
import { library, useLibraryAuthority } from "./libraryState";

export function LibraryHistoryRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId: string; readonly archiveId: string }>) {
  const authority = useLibraryAuthority(),
    navigation = useNavigation(),
    { environments } = useEnvironments();
  const [historyOffset, setHistoryOffset] = useState(0);
  const [previousOffsets, setPreviousOffsets] = useState<readonly number[]>([]);
  const query = useEnvironmentQuery(
    authority.environmentId
      ? library.history({
          environmentId: authority.environmentId,
          input: { id: route.params.archiveId, offset: historyOffset, limit: 100 },
        })
      : null,
  );
  const archive = query.data;
  const threads = useEnvironmentQuery(
    authority.environmentId
      ? library.threads({
          environmentId: authority.environmentId,
          input: { projectId: archive?.summary.projectId ?? route.params.projectId },
        })
      : null,
  );
  const listed = threads.data?.find((thread) => thread.id === route.params.archiveId);
  const refreshSequence = shouldRefreshLibraryArchive(archive?.summary ?? null, listed)
    ? `${authority.environmentId}:${route.params.archiveId}:${archive?.summary.sequence}:${listed?.sequence}`
    : null;
  const rows = useMemo(() => (archive ? libraryArchiveRows(archive.projection) : []), [archive]);
  const host = archive
    ? environments.find((env) => env.environmentId === archive.summary.environmentId)
    : undefined;
  const canContinue = useEnvironmentScope(
    archive?.summary.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  const connected = host?.entry.enabled === true && host.connection.phase === "connected";
  const insets = useSafeAreaInsets();
  const refresh = query.refresh;
  useEffect(() => {
    if (refreshSequence !== null && authority.connected && authority.canRead) refresh();
  }, [refreshSequence, authority.connected, authority.canRead, refresh]);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  if (!archive || !authority.environmentId)
    return (
      <LibraryPage title="Saved conversation" back>
        <LibraryNotice
          detail={
            query.error
              ? null
              : !authority.connected
                ? "This conversation is not cached on this device. Reconnect the selected library to load its saved history."
                : "Loading central conversation history…"
          }
          error={query.error}
          onRetry={query.refresh}
        />
      </LibraryPage>
    );
  const target = authority.environmentId;
  return (
    <LibraryPage title={archive.summary.title} back scroll={false}>
      <LegendList
        className="flex-1"
        data={rows}
        keyExtractor={(row) => row.id}
        recycleItems={false}
        renderItem={({ item }) => (
          <LibraryArchiveFeedRow row={item} archive={archive} authorityEnvironmentId={target} />
        )}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: 16, paddingBottom: Math.max(insets.bottom, 24) + 24 }}
        ListFooterComponent={
          historyOffset > 0 || archive.window?.hasMore ? (
            <View className="flex-row flex-wrap gap-2 pt-4">
              {archive.window?.hasMore ? (
                <Button
                  label="Earlier history"
                  tone="secondary"
                  onPress={() => {
                    setPreviousOffsets((offsets) => [...offsets, historyOffset]);
                    setHistoryOffset(archive.window?.nextOffset ?? historyOffset + 100);
                  }}
                />
              ) : null}
              {historyOffset > 0 ? (
                <Button
                  label="Newer history"
                  tone="secondary"
                  onPress={() => {
                    setHistoryOffset(previousOffsets.at(-1) ?? 0);
                    setPreviousOffsets((offsets) => offsets.slice(0, -1));
                  }}
                />
              ) : null}
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <Text className="text-sm text-foreground-muted">
              Saved history from{" "}
              {host?.label ??
                authority.computers.find(
                  (entry) => entry.environmentId === archive.summary.environmentId,
                )?.label ??
                "the original computer"}
              . Last uploaded {new Date(archive.summary.syncedAt).toLocaleString()}.
            </Text>
            <LibraryReplicationNotice
              summary={archive.summary}
              sourceConnected={connected}
              authorityEnvironmentId={target}
              onRefresh={query.refresh}
            />
            {!authority.connected ? (
              <LibraryNotice detail="Viewing cached library history. Reconnect the library to reload history or open saved attachments." />
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={`Continue on ${host?.label ?? "original computer"}`}
                disabled={!connected || !canContinue}
                onPress={() =>
                  navigation.navigate("Thread", {
                    environmentId: archive.summary.environmentId,
                    threadId: archive.summary.threadId,
                  })
                }
              />
              <Button
                label="Linked continuation"
                tone="text"
                disabled={!authority.ready}
                onPress={() =>
                  navigation.navigate("LibraryStart", {
                    projectId: route.params.projectId,
                    sourceArchiveId: route.params.archiveId,
                  })
                }
              />
            </View>
            <LibrarySuggestBriefUpdates
              summary={archive.summary}
              authorityId={target}
              hostLabel={host?.label ?? "the original computer"}
              hostConnected={connected}
            />
            <LibraryBriefSuggestionOffer
              environmentId={archive.summary.environmentId}
              threadId={archive.summary.threadId}
              connected={connected}
            />
            {query.error ? <LibraryNotice error={query.error} onRetry={query.refresh} /> : null}
          </View>
        }
        ListEmptyComponent={
          <Text className="text-sm text-foreground-muted">
            No messages or work detail were recorded in this saved conversation.
          </Text>
        }
      />
    </LibraryPage>
  );
}
