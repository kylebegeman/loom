import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useFocusEffect, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useSelectWorkspaceDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  libraryHistoryOffsetForItem,
  shouldRefreshLibraryArchive,
} from "@t3tools/client-runtime/fork";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { LibraryArchiveFeedRow } from "./LibraryArchiveFeed";
import { libraryArchiveRowItemId, libraryArchiveRows } from "./libraryArchive";
import { LibraryReplicationNotice } from "./LibraryReplicationNotice";
import { LibraryBriefSuggestionOffer, LibrarySuggestBriefUpdates } from "./LibraryBriefSuggestions";
import { LibraryNotice, LibraryPage } from "./LibraryPage";
import { library, useLibraryAuthority } from "./libraryState";

type LibraryHistoryParams = {
  readonly projectId: string;
  readonly archiveId: string;
  /** A history search hit to open at: its item id and its position, oldest first. */
  readonly item?: string;
  readonly position?: string;
};

export function LibraryHistoryRouteScreen({ route }: StaticScreenProps<LibraryHistoryParams>) {
  // Opening another hit, or another conversation, starts reading and seeking over.
  return (
    <LibraryHistoryContent
      key={`${route.params.archiveId}:${route.params.item ?? ""}`}
      params={route.params}
    />
  );
}

function LibraryHistoryContent({ params }: { readonly params: LibraryHistoryParams }) {
  const authority = useLibraryAuthority(),
    navigation = useNavigation<NativeStackNavigationProp<ReactNavigation.RootParamList>>(),
    { environments } = useEnvironments();
  const selectDetail = useSelectWorkspaceDetail();
  const targetItem = params.item;
  const targetPosition =
    targetItem && params.position !== undefined ? Number(params.position) : undefined;
  const [historyOffset, setHistoryOffset] = useState(0);
  const [previousOffsets, setPreviousOffsets] = useState<readonly number[]>([]);
  // Reads toward a search hit's page until it shows, or until reading further cannot find it.
  const [seeking, setSeeking] = useState(targetPosition !== undefined);
  const query = useEnvironmentQuery(
    authority.environmentId
      ? library.history({
          environmentId: authority.environmentId,
          input: { id: params.archiveId, offset: historyOffset, limit: 100 },
        })
      : null,
  );
  const archive = query.data;
  const historyWindow = archive?.window;
  if (seeking && targetPosition !== undefined && historyWindow?.offset === historyOffset) {
    const offset = libraryHistoryOffsetForItem(targetPosition, historyWindow);
    if (offset === null) setSeeking(false);
    else if (offset !== historyOffset) setHistoryOffset(offset);
  }
  const threads = useEnvironmentQuery(
    authority.environmentId
      ? library.threads({
          environmentId: authority.environmentId,
          input: { projectId: archive?.summary.projectId ?? params.projectId },
        })
      : null,
  );
  const listed = threads.data?.find((thread) => thread.id === params.archiveId);
  const refreshSequence = shouldRefreshLibraryArchive(archive?.summary ?? null, listed)
    ? `${authority.environmentId}:${params.archiveId}:${archive?.summary.sequence}:${listed?.sequence}`
    : null;
  const rows = useMemo(() => (archive ? libraryArchiveRows(archive.projection) : []), [archive]);
  const matchedIndex = targetItem
    ? rows.findIndex((row) => libraryArchiveRowItemId(row) === targetItem)
    : -1;
  const matchedRowId = matchedIndex >= 0 ? rows[matchedIndex]?.id : undefined;
  const list = useRef<LegendListRef>(null);
  const scrolledTo = useRef<{ readonly row: string; readonly measured: boolean } | null>(null);
  const matchedActivity = rows[matchedIndex]?.type === "activity";
  const [laidOut, setLaidOut] = useState<string | null>(null);
  // Brings the matched item into view without moving the page again as history refreshes. The
  // first scroll lands on estimated row heights, often a screen short, so it scrolls once more
  // when the hit is laid out and the rows before it have been measured.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls the native list to the matched row once it is laid out and measured
  useEffect(() => {
    if (!matchedRowId) return;
    const measured = laidOut === matchedRowId;
    const done = scrolledTo.current;
    if (done?.row === matchedRowId && (done.measured || !measured)) return;
    scrolledTo.current = { row: matchedRowId, measured };
    // An opened plan can be taller than the screen, so its start leads rather than its middle.
    void list.current?.scrollToIndex({
      index: matchedIndex,
      viewPosition: matchedActivity ? 0 : 0.5,
      animated: false,
    });
  }, [matchedRowId, matchedIndex, matchedActivity, laidOut]);
  // Scrolling does not move a screen reader, so its focus moves to the hit once the row is laid
  // out and the push has finished; the screen change that ends a push would take it back earlier.
  const [appeared, setAppeared] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to the navigation transitionEnd event and unsubscribes on unmount
  useEffect(
    () =>
      navigation.addListener("transitionEnd", (event) => {
        if (!event.data.closing) setAppeared(true);
      }),
    [navigation],
  );
  const matchLabel = useRef<ComponentRef<typeof View>>(null);
  const focusedOn = useRef<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves screen reader focus to the matched row once it is laid out and the push transition ends
  useEffect(() => {
    if (!appeared || !matchedRowId || laidOut !== matchedRowId) return;
    if (focusedOn.current === matchedRowId || !matchLabel.current) return;
    focusedOn.current = matchedRowId;
    AccessibilityInfo.sendAccessibilityEvent(matchLabel.current, "focus");
  }, [appeared, matchedRowId, laidOut]);
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the saved conversation from the server when the library's refresh sequence changes
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
  const hostLabel =
    host?.label ??
    authority.computers.find((entry) => entry.environmentId === archive.summary.environmentId)
      ?.label ??
    "the original computer";
  return (
    <LibraryPage title={archive.summary.title} back scroll={false}>
      <LegendList
        ref={list}
        className="flex-1"
        renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
        data={rows}
        keyExtractor={(row) => row.id}
        recycleItems={false}
        // A short first scroll can leave the hit outside the drawn rows, so it never lays out.
        alwaysRender={matchedRowId ? { keys: [matchedRowId] } : undefined}
        renderItem={({ item }) =>
          item.id === matchedRowId ? (
            <View className="-mx-2 gap-1 rounded-xl bg-subtle px-2 pt-2 pb-1">
              <View ref={matchLabel} accessible onLayout={() => setLaidOut(item.id)}>
                <Text className="text-xs text-foreground-muted">Found by your search</Text>
              </View>
              <LibraryArchiveFeedRow
                row={item}
                archive={archive}
                authorityEnvironmentId={target}
                initiallyExpanded
              />
            </View>
          ) : (
            <LibraryArchiveFeedRow row={item} archive={archive} authorityEnvironmentId={target} />
          )
        }
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
                    setSeeking(false);
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
                    setSeeking(false);
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
              Saved history from {hostLabel}. Last uploaded{" "}
              {new Date(archive.summary.syncedAt).toLocaleString()}.
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
                  selectDetail({
                    name: "Thread",
                    params: {
                      environmentId: archive.summary.environmentId,
                      threadId: archive.summary.threadId,
                    },
                  })
                }
              />
              <Button
                label="Continue on another computer"
                tone="text"
                disabled={!authority.ready}
                onPress={() =>
                  navigation.navigate("LibraryStart", {
                    projectId: params.projectId,
                    sourceArchiveId: params.archiveId,
                  })
                }
              />
            </View>
            <LibrarySuggestBriefUpdates
              summary={archive.summary}
              authorityId={target}
              hostLabel={hostLabel}
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
