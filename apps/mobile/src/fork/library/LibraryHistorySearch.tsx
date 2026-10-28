import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  EMPTY_LIBRARY_SEARCH_FEED,
  LIBRARY_SEARCH_DEBOUNCE_MS,
  LIBRARY_SEARCH_ROLE_LABELS,
  librarySearchHitKey,
  librarySearchKey,
  librarySearchRequest,
  librarySnippetParts,
  mergeLibrarySearchPage,
} from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  LIBRARY_SEARCH_FEATURE,
  type LibrarySearchHit,
  type LibrarySearchRequest,
} from "@t3tools/contracts/fork";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useDebouncedValue } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { LibraryNotice, LibraryPage } from "./LibraryPage";
import { library } from "./libraryState";
import { useLibraryActivity } from "./useLibraryActivity";

/** Shared by the route and its results, so an offline Library reads the same wherever it shows. */
const searchOfflineDetail = (label: string) =>
  `Library offline. Reconnect ${label} to search saved history.`;

/** Whether the Library can search saved history, for entry points outside this file. */
export function useLibrarySearchSupported() {
  return useLibraryActivity().featureState(LIBRARY_SEARCH_FEATURE) === "supported";
}

/** Opens history search, scoped to one project when `projectId` is set. */
export function LibraryHistorySearchEntry({ projectId }: { readonly projectId?: string }) {
  const navigation = useNavigation();
  if (!useLibrarySearchSupported()) return null;
  return (
    <SettingsSection>
      <SettingsActionRow
        icon="magnifyingglass"
        label={projectId ? "Search this project's history" : "Search conversation history"}
        description={
          projectId
            ? "Find what was said in this project's saved conversations"
            : "Find what was said in any project's saved conversations"
        }
        onPress={() => navigation.navigate("LibrarySearch", projectId ? { projectId } : {})}
      />
    </SettingsSection>
  );
}

export function LibrarySearchRouteScreen({
  route,
}: StaticScreenProps<{ readonly projectId?: string; readonly query?: string } | undefined>) {
  // Navigating to an open search reuses its route with new params, so new words or a new scope
  // start the field and results over.
  return (
    <LibrarySearchContent
      key={`${route.params?.projectId ?? ""}:${route.params?.query ?? ""}`}
      projectId={route.params?.projectId}
      query={route.params?.query}
    />
  );
}

function LibrarySearchContent({
  projectId,
  query,
}: {
  readonly projectId: string | undefined;
  readonly query: string | undefined;
}) {
  const { authority, featureState, hostLabel } = useLibraryActivity();
  const [text, setText] = useState(query ?? "");
  const sent = useDebouncedValue(text, LIBRARY_SEARCH_DEBOUNCE_MS);
  const authorityId = authority.environmentId;
  const state = featureState(LIBRARY_SEARCH_FEATURE);
  const supported = state === "supported";
  // Library-wide hits name their project; a project's own search leaves that out.
  const projects = useEnvironmentQuery(
    supported && authorityId && !projectId
      ? library.projects({ environmentId: authorityId, input: { includeArchived: true } })
      : null,
  );
  const titles = new Map(projects.data?.map((project) => [project.id, project.title]));
  const title = projectId ? "Search this project" : "Search history";
  if (!authorityId || !supported)
    return (
      <LibraryPage title={title} back>
        <LibraryNotice
          detail={
            state === "loading"
              ? "Loading..."
              : state === "offline"
                ? searchOfflineDetail(authority.label)
                : state === "unsupported"
                  ? "Your Library cannot search saved history yet. Update it to search what was said."
                  : "Connect your Library to search saved history."
          }
        />
      </LibraryPage>
    );
  const scope = projectId ? { projectId } : {};
  // Clearing the field hides results at once; new words wait for typing to pause.
  const typed = librarySearchRequest(text, scope);
  const request = typed ? librarySearchRequest(sent, scope) : null;
  return (
    <LibraryPage title={title} back>
      <View className="gap-4">
        <TextInput
          accessibilityLabel={
            projectId ? "Search this project's history" : "Search project history"
          }
          placeholder={
            projectId
              ? "Search what was said in this project"
              : "Search what was said in every project"
          }
          value={text}
          onChangeText={setText}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          className="min-h-[44px] rounded-xl bg-field px-4 text-base text-foreground"
        />
        {request ? (
          // A cursor belongs to one search, so each new search starts its results over.
          <SearchResults
            key={librarySearchKey(request)}
            request={request}
            authorityId={authorityId}
            offlineLabel={authority.connected ? null : authority.label}
            hostLabel={hostLabel}
            projectTitle={projectId ? undefined : (id) => titles.get(id) ?? "Library project"}
          />
        ) : typed ? (
          <Status text="Searching saved history..." />
        ) : null}
      </View>
    </LibraryPage>
  );
}

function Status({ text }: { readonly text: string }) {
  return (
    <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
      {text}
    </Text>
  );
}

function SearchResults({
  request,
  authorityId,
  offlineLabel,
  hostLabel,
  projectTitle,
}: {
  readonly request: LibrarySearchRequest;
  readonly authorityId: EnvironmentId;
  /** The Library's name while it is offline, null while connected. */
  readonly offlineLabel: string | null;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly projectTitle: ((id: string) => string) | undefined;
}) {
  const [feed, setFeed] = useState(EMPTY_LIBRARY_SEARCH_FEED);
  // The cursor of the page being read after the first, if any. One page at a time.
  const [reading, setReading] = useState<string | null>(null);
  const first = useEnvironmentQuery(library.search({ environmentId: authorityId, input: request }));
  const more = useEnvironmentQuery(
    reading === null
      ? null
      : library.search({ environmentId: authorityId, input: { ...request, cursor: reading } }),
  );
  // Each page merges once, while rendering, as it arrives.
  const firstPage = first.data;
  const [mergedFirst, setMergedFirst] = useState<typeof firstPage>(null);
  if (firstPage !== mergedFirst) {
    setMergedFirst(firstPage);
    if (firstPage) setFeed((current) => mergeLibrarySearchPage(current, firstPage));
  }
  const morePage = more.data;
  const [mergedMore, setMergedMore] = useState<{
    page: typeof morePage;
    reading: typeof reading;
  }>({ page: null, reading: null });
  if (morePage !== mergedMore.page || reading !== mergedMore.reading) {
    setMergedMore({ page: morePage, reading });
    if (morePage && reading !== null)
      setFeed((current) => mergeLibrarySearchPage(current, morePage, reading));
  }

  const cursor = feed.nextCursor;
  if (cursor === undefined)
    return first.error ? (
      <LibraryNotice error={first.error} onRetry={first.refresh} />
    ) : (
      <Status
        text={
          offlineLabel === null ? "Searching saved history..." : searchOfflineDetail(offlineLabel)
        }
      />
    );
  if (!feed.hits.length)
    return (
      <Status
        text={
          request.projectId
            ? `Nothing saved in this project matches "${request.query}".`
            : `Nothing saved matches "${request.query}".`
        }
      />
    );
  const loadingMore = reading !== null && reading === cursor && more.isPending;
  return (
    <View className="gap-3">
      <SettingsSection>
        {feed.hits.map((hit, index) => (
          <SearchHit
            key={librarySearchHitKey(hit)}
            hit={hit}
            first={index === 0}
            hostLabel={hostLabel}
            projectTitle={projectTitle}
          />
        ))}
      </SettingsSection>
      {cursor === null ? null : more.error && reading === cursor ? (
        <LibraryNotice error={more.error} onRetry={more.refresh} />
      ) : (
        <Button
          label={loadingMore ? "Loading..." : "Show more results"}
          tone="secondary"
          loading={loadingMore}
          onPress={() => setReading(cursor)}
        />
      )}
    </View>
  );
}

function SearchHit({
  hit,
  first,
  hostLabel,
  projectTitle,
}: {
  readonly hit: LibrarySearchHit;
  readonly first: boolean;
  readonly hostLabel: (id: EnvironmentId) => string;
  readonly projectTitle: ((id: string) => string) | undefined;
}) {
  const navigation = useNavigation();
  const title = hit.title.trim() || "Untitled conversation";
  const meta = [
    projectTitle?.(hit.projectId),
    hostLabel(hit.environmentId),
    LIBRARY_SEARCH_ROLE_LABELS[hit.role],
    `${relativeTime(hit.occurredAt)} ago`,
    hit.archived ? "Archived" : null,
    // Only a Library with semantic search sets `match`; these hits have no marked words.
    hit.match === "semantic" ? "Similar meaning" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hit.snippet}. ${meta}`}
      accessibilityHint="Opens the saved conversation at this message"
      onPress={() =>
        navigation.navigate("LibraryHistory", {
          projectId: hit.projectId,
          archiveId: hit.id,
          item: hit.itemId,
          position: String(hit.position),
        })
      }
      className={cn(
        "gap-1 bg-grouped-card px-4 py-3 active:opacity-70",
        !first && "border-t border-border-subtle",
      )}
    >
      <Text numberOfLines={1} className="text-sm font-t3-medium text-foreground">
        {title}
      </Text>
      {/* Snippets come from other computers' history: text only, with matches in bold. */}
      <Text numberOfLines={3} className="text-xs leading-5 text-foreground-muted">
        {snippetRuns(hit).map(({ at, text, match }) =>
          match ? (
            <Text key={at} className="text-xs font-t3-medium text-foreground">
              {text}
            </Text>
          ) : (
            text
          ),
        )}
      </Text>
      <Text numberOfLines={2} className="text-xs text-foreground-muted">
        {meta}
      </Text>
    </Pressable>
  );
}

/** Snippet parts keyed by where each starts, which is unique within one snippet. */
function snippetRuns(hit: LibrarySearchHit) {
  let at = 0;
  return librarySnippetParts(hit.snippet, hit.highlights).map((part) => {
    const run = { ...part, at };
    at += part.text.length;
    return run;
  });
}
