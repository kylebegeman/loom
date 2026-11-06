import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import {
  LIBRARY_SEARCH_DEBOUNCE_MS,
  librarySearchRequest,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import {
  BOTS_FEATURE,
  LIBRARY_SEARCH_FEATURE,
  PREVIEW_LINKS_FEATURE,
  SITES_FEATURE,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { use, useEffect, useRef, useState, type ComponentRef } from "react";
import { Keyboard, Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import type { AppSymbolName } from "../../components/ui/AppSymbol";
import { openSettings } from "../../features/settings/settings-navigation";
import { useAtomValueWhileVisible } from "../../features/home/home-route-visibility";
import { requestThreadMessageJump } from "../../features/threads/threadMessageJump";
import { useSearchScrollRestoration } from "../../features/workspace/useSearchScrollRestoration";
import { useSelectWorkspaceTab } from "../../features/workspace/useSelectWorkspaceTab";
import { startOpeningDetail } from "../../features/workspace/useSelectWorkspaceDetail";
import { selectWorkspaceDetail } from "../../features/workspace/workspace-detail-selection";
import { useWorkspaceTabs } from "../../features/workspace/WorkspaceTabsContext";
import { useAppForeground } from "../../lib/appState";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useDebouncedValue, useThreadSearch } from "../../state/queries";
import { useEnvironmentsWithScope } from "../../state/session";
import { useEnvironmentQuery } from "../../state/query";
import { environmentThreadShells } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { library, useLibraryAuthority } from "../library/libraryState";
import { previewLinks } from "../preview-links/state";
import { visiblePreviewLinks } from "../preview-links/previewLinksLogic";
import { siteHost } from "../sites/SiteHealth";
import {
  GLOBAL_SEARCH_PAGE_SIZE,
  GLOBAL_SEARCH_SETTINGS,
  globalSearchQueryComputers,
  searchSourceIsLoading,
  rankGlobalSearchItems,
  serverResultsMatchQuery,
  unavailableSearchComputerLabels,
  type GlobalSearchCategory,
  type GlobalSearchItem,
} from "./global-search-model";
import {
  EMPTY_SEARCH_SOURCES,
  globalSearchSources,
  refreshGlobalSearchSources,
  type GlobalSearchSourceTargets,
} from "./search-sources";

const CATEGORIES: readonly {
  readonly id: GlobalSearchCategory;
  readonly title: string;
  readonly icon: AppSymbolName;
}[] = [
  { id: "threads", title: "Threads", icon: "text.bubble" },
  { id: "projects", title: "Projects", icon: "briefcase" },
  { id: "sites", title: "Sites", icon: "globe" },
  { id: "previews", title: "Live previews", icon: "safari" },
  { id: "bots", title: "Bots", icon: "bolt.circle" },
  { id: "settings", title: "Settings", icon: "gearshape" },
];

function searchSourceData<A, E>(result: AsyncResult.AsyncResult<A, E> | null): A | null {
  return result === null ? null : AsyncResult.getOrElse(result, () => null);
}

function searchSourceError(
  result: AsyncResult.AsyncResult<unknown, unknown> | null,
  label: string,
) {
  if (result === null || !AsyncResult.isFailure(result)) return null;
  const cause = Cause.squash(result.cause);
  return `${label}: ${cause instanceof Error ? cause.message : "Could not search this source."}`;
}

export function GlobalSearchScreen() {
  const registry = use(RegistryContext);
  const navigation = useNavigation();
  const selectTab = useSelectWorkspaceTab();
  const workspace = useWorkspaceTabs();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const tabActive = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const active = focused && foreground && tabActive;
  const query = workspace?.state.tabs.search.query.trim().slice(0, 200) ?? "";
  const debouncedQuery = useDebouncedValue(query, 180);
  const historyQuery = useDebouncedValue(query, LIBRARY_SEARCH_DEBOUNCE_MS);
  const { environments, isReady } = useEnvironments();
  const enabled = environments.filter((environment) => environment.entry.enabled);
  const readable = useEnvironmentsWithScope(enabled, AuthOrchestrationReadScope);
  const queryComputers = globalSearchQueryComputers(enabled, readable);
  const searchIds = queryComputers.map((environment) => environment.environmentId);
  const labels = new Map(
    enabled.map((environment) => [environment.environmentId, environment.label]),
  );
  const connected = new Set(
    enabled
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => environment.environmentId),
  );
  const threads = useAtomValueWhileVisible(
    environmentThreadShells.navigationThreadShellsAtom,
    active,
  );
  const projects = useProjects();
  const authority = useLibraryAuthority();
  const libraryConfig = useEnvironmentServerConfig(authority.environmentId);
  const historyRequest = librarySearchRequest(historyQuery);
  const canReadLibrary = authority.connected && authority.canRead;
  const canSearchHistory =
    canReadLibrary &&
    supportsLoomFeature(libraryConfig?.environment.capabilities, LIBRARY_SEARCH_FEATURE);
  const targets: GlobalSearchSourceTargets =
    active && debouncedQuery.length >= 2
      ? {
          library: authority.supported && canReadLibrary ? authority.environmentId : null,
          sites:
            canReadLibrary &&
            supportsLoomFeature(libraryConfig?.environment.capabilities, SITES_FEATURE)
              ? authority.environmentId
              : null,
          computers: queryComputers
            .map((environment) => ({
              environmentId: environment.environmentId,
              previews: supportsLoomFeature(
                environment.serverConfig?.environment.capabilities,
                PREVIEW_LINKS_FEATURE,
              ),
              bots: supportsLoomFeature(
                environment.serverConfig?.environment.capabilities,
                BOTS_FEATURE,
              ),
            }))
            .filter((environment) => environment.previews || environment.bots),
        }
      : EMPTY_SEARCH_SOURCES;
  const sourceResults = useAtomValue(globalSearchSources(JSON.stringify(targets)));
  const historyTarget =
    active && query.length >= 2 && canSearchHistory && authority.environmentId && historyRequest
      ? { environmentId: authority.environmentId, input: historyRequest }
      : null;
  const historyEnabled = historyTarget !== null;
  const historyResult = useEnvironmentQuery(historyTarget ? library.search(historyTarget) : null);
  const threadSearch = useThreadSearch(searchIds, active ? query : "", {
    environmentLabels: Object.fromEntries(labels),
  });
  const [pending, setPending] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const openPreview = useAtomCommand(previewLinks.open, { reportFailure: false });
  const localProjects = new Map(
    projects.map((project) => [`${project.environmentId}:${project.id}`, project]),
  );
  const localThreads = new Map(
    threads
      .filter((thread) => labels.has(thread.environmentId))
      .map((thread) => [scopedThreadKey(thread.environmentId, thread.id), thread]),
  );
  const items: GlobalSearchItem[] = [];
  for (const thread of localThreads.values()) {
    const project = localProjects.get(`${thread.environmentId}:${thread.projectId}`);
    items.push({
      key: `thread:${scopedThreadKey(thread.environmentId, thread.id)}`,
      category: "threads",
      title: thread.title,
      description: [project?.title, labels.get(thread.environmentId)].filter(Boolean).join(" · "),
      terms: [thread.branch ?? "", project?.title ?? "", labels.get(thread.environmentId) ?? ""],
      updatedAt: thread.updatedAt,
      destination: { kind: "thread", environmentId: thread.environmentId, threadId: thread.id },
      liveAvailable: connected.has(thread.environmentId) && readable.has(thread.environmentId),
    });
  }
  if (serverResultsMatchQuery(query, threadSearch.query)) {
    for (const match of threadSearch.matches) {
      const key = scopedThreadKey(match.environmentId, match.threadId);
      const thread = localThreads.get(key);
      items.push({
        key: `thread:${key}`,
        category: "threads",
        title: thread?.title ?? "Conversation",
        description: `${labels.get(match.environmentId) ?? "Computer"}: ${match.snippet}`,
        serverQuality: 0.7,
        liveAvailable: connected.has(match.environmentId) && readable.has(match.environmentId),
        updatedAt: thread?.updatedAt ?? match.messageCreatedAt ?? undefined,
        destination: {
          kind: "thread",
          environmentId: match.environmentId,
          threadId: match.threadId,
          ...(match.messageId ? { messageId: match.messageId } : {}),
        },
      });
    }
  }
  for (const project of projects) {
    if (project.isScratch || project.archivedAt || !labels.has(project.environmentId)) continue;
    items.push({
      key: `project:${project.environmentId}:${project.id}`,
      category: "projects",
      title: project.title,
      description: labels.get(project.environmentId),
      terms: [project.workspaceRoot],
      updatedAt: project.updatedAt,
      destination: { kind: "project", environmentId: project.environmentId, projectId: project.id },
    });
  }
  const errors = [
    searchSourceError(sourceResults.projects, "Projects"),
    searchSourceError(sourceResults.sites, "Sites"),
    historyResult.error ? `Saved history: ${historyResult.error}` : null,
    ...sourceResults.computers.flatMap((source) => [
      searchSourceError(
        source.previews,
        `Previews on ${labels.get(source.environmentId) ?? "Computer"}`,
      ),
      searchSourceError(source.bots, `Bots on ${labels.get(source.environmentId) ?? "Computer"}`),
    ]),
  ].filter((error): error is string => error !== null);
  const catalogsPending =
    (historyResult.isPending && historyResult.data === null) ||
    [
      sourceResults.projects,
      sourceResults.sites,
      ...sourceResults.computers.flatMap((source) => [source.previews, source.bots]),
    ].some(searchSourceIsLoading);
  const libraryProjects = searchSourceData(sourceResults.projects);
  for (const project of libraryProjects ?? []) {
    items.push({
      key: `library:${authority.environmentId}:${project.id}`,
      category: "projects",
      title: project.title,
      description: "Shared project",
      terms: [project.brief, ...project.resources.map((resource) => resource.title)],
      updatedAt: project.updatedAt,
      destination: { kind: "library-project", projectId: project.id },
    });
  }
  const siteResults = searchSourceData(sourceResults.sites);
  for (const site of siteResults?.snapshot?.sites ?? []) {
    items.push({
      key: `site:${authority.environmentId}:${site.id}`,
      category: "sites",
      title: site.name,
      description: siteHost(site.url),
      terms: [site.url],
      destination: { kind: "site", siteId: site.id },
    });
  }
  const history = historyResult.data;
  if (historyEnabled && serverResultsMatchQuery(query, historyRequest?.query)) {
    for (const hit of history?.hits ?? []) {
      items.push({
        key: `thread:${scopedThreadKey(hit.environmentId, hit.threadId)}`,
        category: "threads",
        title: hit.title.trim() || "Conversation",
        description: `${labels.get(hit.environmentId) ?? "Saved computer"}: ${hit.snippet}`,
        serverQuality: 0.7,
        updatedAt: hit.occurredAt,
        destination: {
          kind: "library-history",
          projectId: hit.projectId,
          archiveId: hit.id,
          itemId: hit.itemId,
          position: hit.position,
        },
      });
    }
  }
  const [now, setNow] = useState(Date.now);
  const hasPreviews = sourceResults.computers.some(
    (source) =>
      source.previews !== null &&
      AsyncResult.getOrElse(source.previews, () => null)?.links.some(
        (link) => link.state === "open" && Date.parse(link.expiresAt) > now,
      ),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- checks link expiry against the wall clock only while search results are visible
  useEffect(() => {
    if (!active || !hasPreviews) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [active, hasPreviews]);
  for (const source of sourceResults.computers) {
    const label = labels.get(source.environmentId) ?? "Computer";
    const previews = searchSourceData(source.previews);
    for (const link of previews
      ? visiblePreviewLinks(previews.links, previews.setup.settings, now)
      : []) {
      if (link.state !== "open" || Date.parse(link.expiresAt) <= now) continue;
      items.push({
        key: `preview:${source.environmentId}:${link.id}`,
        category: "previews",
        title: link.host,
        description: `${label} · Port ${link.port}`,
        disabled: !connected.has(source.environmentId) || !source.canOpenPreviews,
        terms: ["preview", link.url],
        updatedAt: link.createdAt,
        destination: { kind: "preview", environmentId: source.environmentId, linkId: link.id },
      });
    }
    const bots = searchSourceData(source.bots);
    for (const bot of bots?.bots ?? []) {
      if (bot.archivedAt) continue;
      items.push({
        key: `bot:${source.environmentId}:${bot.id}`,
        category: "bots",
        title: bot.name,
        description: `${label} · ${bot.description}`,
        terms: ["bot"],
        updatedAt: bot.updatedAt,
        destination: { kind: "bot", environmentId: source.environmentId, botId: bot.id },
      });
    }
  }
  items.push(...GLOBAL_SEARCH_SETTINGS);
  const ranked = query === "" ? [] : rankGlobalSearchItems(items, query);
  const recents =
    query === ""
      ? rankGlobalSearchItems(
          items.filter((item) => item.category === "threads"),
          "",
        ).slice(0, GLOBAL_SEARCH_PAGE_SIZE)
      : [];
  const insets = useSafeAreaInsets();
  const bottomSafe = useNativeColumnLayoutMetrics()?.safeArea.bottom ?? insets.bottom;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [initialOffset] = useState(() => workspace?.getScrollOffset("search") ?? 0);
  const searchTab = workspace?.state.tabs.search;
  useSearchScrollRestoration(searchTab?.searchMode, () =>
    scrollRef.current?.scrollTo({
      y: (searchTab?.scrollOffset ?? 0) - (Platform.OS === "ios" ? insets.top : 0),
      animated: false,
    }),
  );

  const open = async (item: GlobalSearchItem) => {
    const destination = item.destination;
    Keyboard.dismiss();
    setOpenError(null);
    switch (destination.kind) {
      case "thread": {
        if (destination.messageId)
          requestThreadMessageJump(
            scopedThreadKey(destination.environmentId, destination.threadId),
            destination.messageId,
          );
        const detail = {
          name: "Thread" as const,
          params: { environmentId: destination.environmentId, threadId: destination.threadId },
        };
        startOpeningDetail(detail);
        navigation.dispatch(selectWorkspaceDetail(detail, undefined, { preserveOrigin: true }));
        return;
      }
      case "project":
        navigation.navigate("ProjectHome", destination);
        return;
      case "library-project":
        navigation.navigate("LibraryProject", { projectId: destination.projectId });
        return;
      case "library-history":
        navigation.navigate("LibraryHistory", {
          projectId: destination.projectId,
          archiveId: destination.archiveId,
          item: destination.itemId,
          position: String(destination.position),
        });
        return;
      case "site":
        navigation.navigate("Sites", { siteId: destination.siteId });
        return;
      case "bot":
        navigation.navigate("BotsDetail", {
          environmentId: destination.environmentId,
          botId: destination.botId,
        });
        return;
      case "settings":
        openSettings(navigation, destination.page);
        return;
      case "preview": {
        if (pendingRef.current) return;
        pendingRef.current = true;
        setPending(item.key);
        await (async () => {
          const result = await openPreview({
            environmentId: destination.environmentId,
            input: { link: destination.linkId },
          });
          if (result._tag === "Failure") throw squashAtomCommandFailure(result);
          await Linking.openURL(result.value.url);
        })().catch((cause: unknown) =>
          setOpenError(cause instanceof Error ? cause.message : "Could not open this preview."),
        );
        pendingRef.current = false;
        setPending(null);
      }
    }
  };

  const partial = enabled.filter((environment) => !connected.has(environment.environmentId));
  const pendingSearch =
    query !== "" &&
    (!isReady ||
      query !== debouncedQuery ||
      (canSearchHistory && query !== historyQuery) ||
      threadSearch.isPending ||
      catalogsPending);
  return (
    <ScreenScrollView
      ref={scrollRef}
      className="flex-1 bg-screen"
      contentInsetAdjustmentBehavior="automatic"
      contentOffset={
        initialOffset > 0
          ? { x: 0, y: initialOffset - (Platform.OS === "ios" ? insets.top : 0) }
          : undefined
      }
      contentContainerClassName="gap-5 px-5 pt-4"
      contentContainerStyle={{
        paddingBottom:
          Math.max(bottomSafe + 24, workspace?.bottomClearance ?? 0) -
          (Platform.OS === "ios" ? bottomSafe : 0),
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={100}
      onScroll={(event) =>
        workspace?.recordScrollOffset(
          "search",
          Math.max(0, event.nativeEvent.contentOffset.y + (Platform.OS === "ios" ? insets.top : 0)),
        )
      }
    >
      {openError ? (
        <Text accessibilityRole="alert" textRole="footnote" className="text-danger-foreground">
          {openError}
        </Text>
      ) : null}
      {query === "" ? (
        <>
          <Text textRole="body" className="px-1 text-foreground-muted">
            Find threads, messages, projects, sites, bots and settings.
          </Text>
          {recents.length ? (
            <SearchSection
              title="Recent threads"
              icon="text.bubble"
              items={recents}
              pending={pending}
              onOpen={open}
            />
          ) : (
            <EmptyState
              variant="plain"
              title="Search Loom"
              detail={
                isReady
                  ? "Search across your connected computers and shared Library."
                  : "Loading your computers…"
              }
            />
          )}
          <ListSection title="Browse">
            <ListRow
              icon="briefcase"
              label="Projects"
              onPress={() => navigation.navigate("Library")}
            />
            <ListRow icon="globe" label="Sites" onPress={() => selectTab("sites")} />
            <ListRow icon="bolt.circle" label="Bots" onPress={() => navigation.navigate("Bots")} />
            <ListRow
              icon="gearshape"
              label="Settings"
              onPress={() => navigation.navigate("Settings")}
            />
          </ListSection>
        </>
      ) : (
        <>
          {pendingSearch ? (
            <Text
              accessibilityLiveRegion="polite"
              textRole="footnote"
              className="px-1 text-foreground-muted"
            >
              Searching…
            </Text>
          ) : null}
          {partial.length || threadSearch.failedEnvironmentIds.length || errors.length ? (
            <View className="gap-2 px-1">
              <Text textRole="footnote" className="text-foreground-muted">
                Some results may be unavailable.
                {partial.length
                  ? ` Reconnect ${unavailableSearchComputerLabels(partial)} to search their messages.`
                  : ""}
              </Text>
              {[...new Set(errors)].slice(0, 3).map((error) => (
                <Text key={error} textRole="footnote" className="text-danger-foreground">
                  {error}
                </Text>
              ))}
              {threadSearch.failedEnvironmentIds.length || errors.length ? (
                <Button
                  tone="text"
                  label="Retry search"
                  onPress={() => {
                    threadSearch.retry();
                    refreshGlobalSearchSources(registry, targets);
                    if (historyEnabled) historyResult.refresh();
                  }}
                />
              ) : null}
            </View>
          ) : null}
          {CATEGORIES.map((category) => (
            <SearchSection
              key={`${category.id}:${query}`}
              title={category.title}
              icon={category.icon}
              items={ranked.filter((item) => item.category === category.id)}
              pending={pending}
              onOpen={open}
            />
          ))}
          {history?.nextCursor &&
          historyEnabled &&
          serverResultsMatchQuery(query, historyRequest?.query) ? (
            <ListRow
              icon="magnifyingglass"
              label="More saved history"
              description="Search all saved conversations"
              onPress={() => navigation.navigate("LibrarySearch", { query })}
            />
          ) : null}
          {!ranked.length && !pendingSearch ? (
            <EmptyState
              variant="plain"
              title="No results"
              detail={`Nothing available matches “${query}”. Try a thread title, project name, website or setting.`}
            />
          ) : null}
          {query.length < 2 ? (
            <Text textRole="footnote" className="px-1 text-foreground-muted">
              Keep typing to search messages and your shared Library.
            </Text>
          ) : null}
        </>
      )}
    </ScreenScrollView>
  );
}

function SearchSection(props: {
  readonly title: string;
  readonly icon: AppSymbolName;
  readonly items: readonly GlobalSearchItem[];
  readonly pending: string | null;
  readonly onOpen: (item: GlobalSearchItem) => Promise<void>;
}) {
  const [count, setCount] = useState(GLOBAL_SEARCH_PAGE_SIZE);
  if (!props.items.length) return null;
  return (
    <ListSection title={props.title}>
      {props.items.slice(0, count).map((item) => (
        <ListRow
          key={item.key}
          icon={props.icon}
          label={item.title}
          description={item.description}
          detail={props.pending === item.key ? "Opening…" : undefined}
          disabled={props.pending !== null || item.disabled}
          onPress={() => void props.onOpen(item)}
        />
      ))}
      {props.items.length > count ? (
        <ListRow
          icon="chevron.down"
          label={`Show more (${props.items.length - count})`}
          onPress={() => setCount((value) => value + GLOBAL_SEARCH_PAGE_SIZE)}
        />
      ) : null}
    </ListSection>
  );
}
