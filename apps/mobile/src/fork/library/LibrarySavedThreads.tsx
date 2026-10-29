import { useNavigation } from "@react-navigation/native";
import { libraryOutsideArchivedProjects, librarySearchRequest } from "@t3tools/client-runtime/fork";
import { LIBRARY_DELETED_FEATURE } from "@t3tools/contracts/fork";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Button } from "../../components/ui/Button";
import { useEnvironmentQuery } from "../../state/query";
import { useLibrarySearchSupported } from "./LibraryHistorySearch";
import { library, useLibraryAuthority, useLoomFeature } from "./libraryState";

export function LibrarySavedThreads({
  localThreads,
  projectKeys,
  environmentId,
  search,
}: {
  readonly localThreads: readonly {
    readonly id: ThreadId;
    readonly environmentId: EnvironmentId;
  }[];
  readonly projectKeys: ReadonlySet<string> | null;
  readonly environmentId: EnvironmentId | null;
  readonly search: string;
}) {
  const authority = useLibraryAuthority();
  const navigation = useNavigation();
  const supportsDeleted = useLoomFeature(authority.environmentId, LIBRARY_DELETED_FEATURE);
  const [deletedFilter, setDeleted] = useState(false);
  const deleted = supportsDeleted && deletedFilter;
  const [page, setPage] = useState({ environmentId: authority.environmentId, offset: 0 });
  const offset = page.environmentId === authority.environmentId ? page.offset : 0;
  const setOffset = (offset: number) => setPage({ environmentId: authority.environmentId, offset });
  const index = useEnvironmentQuery(
    authority.environmentId
      ? library.threadIndex({
          environmentId: authority.environmentId,
          input: supportsDeleted ? { deleted, limit: 25, offset } : { limit: 100 },
        })
      : null,
  );
  const catalog = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
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
  // Titles alone miss what was said, so a typed search can carry on into saved history.
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
  if (!threads.length && !searchHistory && !supportsDeleted) return null;
  return (
    <View className="gap-1 px-4 py-4">
      {supportsDeleted ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Saved conversations"
            tone={deleted ? "text" : "secondary"}
            onPress={() => {
              setDeleted(false);
              setOffset(0);
            }}
          />
          <Button
            label="Recently deleted"
            tone={deleted ? "secondary" : "text"}
            onPress={() => {
              setDeleted(true);
              setOffset(0);
            }}
          />
        </View>
      ) : null}
      {index.isPending ? (
        <Text className="text-sm text-foreground-muted">Loading saved conversations…</Text>
      ) : null}
      {index.error ? (
        <Text accessibilityRole="alert" className="text-sm text-foreground-muted">
          {index.error}
        </Text>
      ) : null}
      {deleted && !threads.length && !index.isPending && !index.error ? (
        <Text className="text-sm text-foreground-muted">
          No recently deleted conversations match these filters.
        </Text>
      ) : null}
      {threads.length ? (
        <Text className="mb-1 text-xs font-t3-medium text-foreground-muted">
          Saved conversations
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
            disabled={!offset || index.isPending}
            onPress={() => setOffset(Math.max(0, offset - 25))}
          />
          <Button
            label="Next"
            disabled={index.data?.nextOffset == null || index.isPending || !authority.connected}
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
  );
}
