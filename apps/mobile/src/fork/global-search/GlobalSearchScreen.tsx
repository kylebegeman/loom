import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import {
  LIBRARY_SEARCH_DEBOUNCE_MS,
  librarySearchRequest,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope } from "@t3tools/contracts";
import { BOTS_FEATURE, PREVIEW_LINKS_FEATURE } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { use, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Keyboard, Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";
import { openSettings } from "../../features/settings/settings-navigation";
import { useAtomValueWhileVisible } from "../../features/home/home-route-visibility";
import { requestThreadMessageJump } from "../../features/threads/threadMessageJump";
import { useSearchScrollRestoration } from "../../features/layout/workspace/useSearchScrollRestoration";
import { useSelectWorkspaceTab } from "../../features/layout/workspace/useSelectWorkspaceTab";
import { startOpeningDetail } from "../../features/layout/workspace/useSelectWorkspaceDetail";
import { selectWorkspaceDetail } from "../../features/layout/workspace/workspace-detail-selection";
import { useWorkspaceTabs } from "../../features/layout/workspace/WorkspaceTabsContext";
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
  globalSearchLibrarySources,
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

const RECENT_THREAD_LIMIT = 3;

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
  const librarySources = globalSearchLibrarySources(
    authority,
    libraryConfig?.environment.capabilities,
  );
  const canSearchHistory = librarySources.history !== null;
  const targets: GlobalSearchSourceTargets =
    active && debouncedQuery.length >= 2
      ? {
          library: librarySources.projects,
          sites: librarySources.sites,
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
    active && query.length >= 2 && librarySources.history && historyRequest
      ? { environmentId: librarySources.history, input: historyRequest }
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
        description: labels.get(match.environmentId) ?? "Computer",
        snippet: match.snippet,
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
        description: labels.get(hit.environmentId) ?? "Saved computer",
        snippet: hit.snippet,
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
        ).slice(0, RECENT_THREAD_LIMIT)
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
      scrollToOverflowEnabled
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
          <View className="gap-2 pb-1 pt-1">
            <Text accessibilityRole="header" textRole="largeTitle" className="font-t3-bold">
              Find your work
            </Text>
            <Text textRole="body" className="text-foreground-muted">
              Search a message, a project, or a website.
            </Text>
          </View>
          <View>
            <SearchDestinationRow
              icon="briefcase"
              label="Projects"
              description="Projects and saved conversation history"
              onPress={() => navigation.navigate("Library")}
            />
            <SearchDestinationRow
              icon="globe"
              label="Sites"
              description="Monitored websites and live previews"
              onPress={() => selectTab("sites")}
            />
            <View className="flex-row flex-wrap gap-x-5 pt-2">
              <SearchUtilityButton
                icon="bolt.circle"
                label="Bots"
                onPress={() => navigation.navigate("Bots")}
              />
              <SearchUtilityButton
                icon="gearshape"
                label="Settings"
                onPress={() => navigation.navigate("Settings")}
              />
            </View>
          </View>
          {recents.length ? (
            <View>
              <View className="flex-row flex-wrap items-center justify-between gap-x-3">
                <Text accessibilityRole="header" textRole="headline" className="font-t3-bold">
                  Continue a thread
                </Text>
                <Button
                  tone="text"
                  size="compact"
                  label="All threads"
                  onPress={() => selectTab("threads")}
                />
              </View>
              {recents.map((item) => {
                const thread =
                  item.destination.kind === "thread"
                    ? localThreads.get(
                        scopedThreadKey(item.destination.environmentId, item.destination.threadId),
                      )
                    : undefined;
                const project = thread
                  ? localProjects.get(`${thread.environmentId}:${thread.projectId}`)
                  : undefined;
                return (
                  <SearchRecentThread
                    key={item.key}
                    item={item}
                    pending={pending}
                    onOpen={open}
                    identity={
                      project ? (
                        <ProjectFavicon
                          environmentId={project.environmentId}
                          projectTitle={project.title}
                          workspaceRoot={project.workspaceRoot}
                          faviconPath={project.faviconPath}
                          projectIcon={project.projectIcon}
                          size={24}
                        />
                      ) : (
                        <SymbolView name="text.bubble" size={20} tintColorClassName="accent-icon" />
                      )
                    }
                  />
                );
              })}
            </View>
          ) : (
            <View className="gap-2 py-4">
              <Text textRole="headline" className="font-t3-bold">
                {isReady ? "No recent threads" : "Loading your threads…"}
              </Text>
              <Text textRole="body" className="text-foreground-muted">
                {isReady
                  ? "Open a project or use Search to find something to continue."
                  : "Your connected work will appear here."}
              </Text>
            </View>
          )}
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
            <SearchBrowseRow
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

function SearchDestinationRow(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly description: string;
  readonly onPress: () => void;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="min-h-20 flex-row items-center gap-3 border-b border-border-subtle py-3"
    >
      <View className="size-11 items-center justify-center rounded-full bg-secondary">
        <SymbolView name={props.icon} size={23} tintColorClassName="accent-primary-text" />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text textRole="headline" className="font-t3-bold">
          {props.label}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted">
          {props.description}
        </Text>
      </View>
      <SymbolView name="chevron.right" size={14} tintColorClassName="accent-chevron" />
    </RowPressable>
  );
}

function SearchUtilityButton(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly onPress: () => void;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="min-h-11 flex-row items-center gap-2 py-2"
    >
      <SymbolView name={props.icon} size={18} tintColorClassName="accent-primary-text" />
      <Text textRole="footnote" className="font-t3-medium text-primary-text">
        {props.label}
      </Text>
    </RowPressable>
  );
}

function SearchRecentThread(props: {
  readonly item: GlobalSearchItem;
  readonly pending: string | null;
  readonly identity: ReactNode;
  readonly onOpen: (item: GlobalSearchItem) => Promise<void>;
}) {
  const { item } = props;
  const opening = props.pending === item.key;
  return (
    <RowPressable
      accessibilityRole="button"
      accessibilityLabel={[item.title, item.description].filter(Boolean).join(". ")}
      accessibilityState={{ disabled: props.pending !== null || item.disabled, busy: opening }}
      disabled={props.pending !== null || item.disabled}
      onPress={() => void props.onOpen(item)}
      className="min-h-20 flex-row items-start gap-3 border-b border-border-subtle py-3.5"
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="size-9 items-center justify-center"
      >
        {props.identity}
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text textRole="body" className="font-t3-bold" numberOfLines={2}>
          {item.title}
        </Text>
        <Text textRole="footnote" className="text-foreground-muted" numberOfLines={2}>
          {opening ? "Opening…" : item.description}
        </Text>
      </View>
      <View className="min-h-9 justify-center">
        <SymbolView name="chevron.right" size={13} tintColorClassName="accent-chevron" />
      </View>
    </RowPressable>
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
    <View>
      <View className="flex-row items-center gap-2 pb-2 pt-2">
        <SymbolView name={props.icon} size={17} tintColorClassName="accent-icon" />
        <Text accessibilityRole="header" textRole="headline" className="flex-1 font-t3-bold">
          {props.title}
        </Text>
        <Text textRole="footnote" className="tabular-nums text-foreground-muted">
          {props.items.length}
        </Text>
      </View>
      {props.items.slice(0, count).map((item) => (
        <RowPressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={[item.title, item.snippet, item.description]
            .filter(Boolean)
            .join(". ")}
          accessibilityState={{
            disabled: props.pending !== null || item.disabled,
            busy: props.pending === item.key,
          }}
          disabled={props.pending !== null || item.disabled}
          onPress={() => void props.onOpen(item)}
          className="min-h-16 flex-row items-center gap-3 border-b border-border-subtle py-3.5"
        >
          <View className="min-w-0 flex-1 gap-1">
            <Text textRole="body" className="font-t3-bold" numberOfLines={2}>
              {item.title}
            </Text>
            {item.snippet ? (
              <Text textRole="body" className="text-foreground" numberOfLines={2}>
                {item.snippet}
              </Text>
            ) : null}
            {item.description || props.pending === item.key ? (
              <Text textRole="footnote" className="text-foreground-muted" numberOfLines={2}>
                {props.pending === item.key ? "Opening…" : item.description}
              </Text>
            ) : null}
          </View>
          <SymbolView name="chevron.right" size={13} tintColorClassName="accent-chevron" />
        </RowPressable>
      ))}
      {props.items.length > count ? (
        <Button
          tone="text"
          label={`Show more (${props.items.length - count})`}
          onPress={() => setCount((value) => value + GLOBAL_SEARCH_PAGE_SIZE)}
        />
      ) : null}
    </View>
  );
}

function SearchBrowseRow(props: {
  readonly icon: AppSymbolName;
  readonly label: string;
  readonly description?: string;
  readonly onPress: () => void;
}) {
  return (
    <RowPressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="min-h-14 flex-row items-center gap-3 border-b border-border-subtle py-3"
    >
      <SymbolView name={props.icon} size={21} tintColorClassName="accent-icon" />
      <View className="min-w-0 flex-1 gap-1">
        <Text textRole="body" className="font-t3-medium">
          {props.label}
        </Text>
        {props.description ? (
          <Text textRole="footnote" className="text-foreground-muted">
            {props.description}
          </Text>
        ) : null}
      </View>
      <SymbolView name="chevron.right" size={13} tintColorClassName="accent-chevron" />
    </RowPressable>
  );
}
