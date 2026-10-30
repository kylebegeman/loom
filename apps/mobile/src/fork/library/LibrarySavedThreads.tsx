import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { libraryOutsideArchivedProjects, librarySearchRequest } from "@t3tools/client-runtime/fork";
import { LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { ThreadListV2Section } from "../../features/threads/thread-list-v2-items";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentQuery } from "../../state/query";
import { useLibrarySearchSupported } from "./LibraryHistorySearch";
import { library, useLibraryAuthority, useLoomFeature } from "./libraryState";

type SavedThreadsProps = {
  readonly localThreads: readonly {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
  }[];
  readonly projectKeys: ReadonlySet<string> | null;
  readonly environmentId: EnvironmentId | null;
  readonly search: string;
  readonly pane?: "screen" | "sidebar";
};

export function LibrarySavedThreads(props: SavedThreadsProps) {
  const authority = useLibraryAuthority();
  const supportsDeleted = useLoomFeature(authority.environmentId, LIBRARY_DELETED_FEATURE);
  if (!authority.environmentId) return null;
  return (
    <View>
      <LibraryThreadSection
        {...props}
        authorityId={authority.environmentId}
        connected={authority.connected}
        supportsDeleted={supportsDeleted}
        deleted={false}
      />
      {supportsDeleted ? (
        <LibraryThreadSection
          {...props}
          authorityId={authority.environmentId}
          connected={authority.connected}
          supportsDeleted
          deleted
        />
      ) : null}
    </View>
  );
}

function LibraryThreadSection({
  localThreads,
  projectKeys,
  environmentId,
  search,
  pane,
  authorityId,
  connected,
  supportsDeleted,
  deleted,
}: SavedThreadsProps & {
  readonly authorityId: EnvironmentId;
  readonly connected: boolean;
  readonly supportsDeleted: boolean;
  readonly deleted: boolean;
}) {
  const navigation = useNavigation();
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preference = deleted ? "loom.library.deletedExpanded" : "loom.library.savedExpanded";
  const loaded = AsyncResult.isSuccess(preferences);
  const expanded = loaded && preferences.value[preference] === true;
  const title = deleted ? "Recently deleted" : "Saved";
  const [page, setPage] = useState({ authorityId, offset: 0 });
  const offset = page.authorityId === authorityId ? page.offset : 0;
  const setOffset = (offset: number) => setPage({ authorityId, offset });
  const index = useEnvironmentQuery(
    expanded
      ? library.threadIndex({
          environmentId: authorityId,
          input: supportsDeleted ? { deleted, limit: 25, offset } : { limit: 100 },
        })
      : null,
  );
  const catalog = useEnvironmentQuery(
    expanded
      ? library.projects({ environmentId: authorityId, input: { includeArchived: true } })
      : null,
  );
  const local = useMemo(
    () => new Set(localThreads.map((t) => `${t.environmentId}:${t.id}`)),
    [localThreads],
  );
  const titles = useMemo(
    () => new Map(catalog.data?.map((p) => [p.id, p.title]) ?? []),
    [catalog.data],
  );
  const searchSupported = useLibrarySearchSupported();
  const searchHistory = !deleted && searchSupported && librarySearchRequest(search) !== null;
  const query = search.trim().toLocaleLowerCase();
  const candidates = deleted
    ? (index.data?.threads ?? [])
    : libraryOutsideArchivedProjects(index.data?.threads ?? [], catalog.data ?? []);
  const threads = candidates.filter(
    (t) =>
      (deleted || !t.archived) &&
      Boolean(t.deleted) === deleted &&
      (deleted || !local.has(`${t.environmentId}:${t.threadId}`)) &&
      (!environmentId || environmentId === t.environmentId) &&
      (!projectKeys || projectKeys.has(`${t.environmentId}:${t.localProjectId}`)) &&
      (!query || `${t.title} ${titles.get(t.projectId) ?? ""}`.toLocaleLowerCase().includes(query)),
  );
  return (
    <View>
      <ThreadListV2Section
        label={title}
        pane={pane}
        disclosure={{
          expanded,
          disabled: !loaded,
          onToggle: () =>
            savePreferences({
              transform: (current) => ({ [preference]: current[preference] !== true }),
            }),
          accessibilityLabel: title,
          accessibilityHint: `${expanded ? "Collapses" : "Expands"} ${title.toLocaleLowerCase()}.`,
        }}
      />
      {expanded ? (
        <View className="gap-1 px-3 pb-2">
          {index.isPending ? (
            <Text className="px-2 py-2 text-sm text-foreground-muted">
              {deleted ? "Loading recently deleted conversations…" : "Loading saved conversations…"}
            </Text>
          ) : null}
          {index.error ? (
            <Text accessibilityRole="alert" className="px-2 py-2 text-sm text-foreground-muted">
              {index.error}
            </Text>
          ) : null}
          {!threads.length && !index.isPending && !index.error ? (
            <Text className="px-2 py-2 text-sm text-foreground-muted">
              {deleted
                ? "No recently deleted conversations match these filters."
                : "No saved conversations match these filters."}
            </Text>
          ) : null}
          {(supportsDeleted ? threads : threads.slice(0, 20)).map((thread) => (
            <Pressable
              key={thread.id}
              accessibilityRole="button"
              accessibilityLabel={`${thread.title || "Untitled conversation"}, ${titles.get(thread.projectId) ?? "Project"}`}
              className="min-h-[44px] gap-1 rounded-lg px-2 py-3 active:opacity-70"
              onPress={() =>
                navigation.navigate("LibraryHistory", {
                  projectId: thread.projectId,
                  archiveId: thread.id,
                })
              }
            >
              <Text numberOfLines={1} className="text-base text-foreground">
                {thread.title || "Untitled conversation"}
              </Text>
              <Text numberOfLines={1} className="text-xs text-foreground-muted">
                {titles.get(thread.projectId) ?? "Project"}
              </Text>
            </Pressable>
          ))}
          {searchHistory ? (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="Searches what was said in every project's saved conversations"
              className="min-h-[44px] flex-row items-center gap-3 rounded-lg px-2 py-3 active:opacity-70"
              onPress={() => navigation.navigate("LibrarySearch", { query: search.trim() })}
            >
              <SymbolView name="magnifyingglass" size={16} tintColorClassName="accent-icon-muted" />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-base text-foreground">
                {`Search saved history for "${search.trim()}"`}
              </Text>
            </Pressable>
          ) : null}
          {supportsDeleted && (offset > 0 || index.data?.nextOffset != null) ? (
            <View className="flex-row gap-2">
              <Button
                label="Previous"
                tone="text"
                disabled={!offset || index.isPending}
                onPress={() => setOffset(Math.max(0, offset - 25))}
              />
              <Button
                label="Next"
                tone="text"
                disabled={index.data?.nextOffset == null || index.isPending || !connected}
                onPress={() => setOffset(index.data?.nextOffset ?? offset)}
              />
            </View>
          ) : null}
          {!supportsDeleted &&
          threads.length &&
          (threads.length > 20 || index.data?.nextOffset !== null) ? (
            <Button
              label="Browse earlier conversations by project"
              tone="text"
              onPress={() => navigation.navigate("Library")}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
