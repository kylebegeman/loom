import { useAtom, useAtomValue } from "@effect/atom-react";
import { useFocusEffect, useIsFocused, useNavigation } from "@react-navigation/native";
import {
  previewPageControls,
  previewPageSummary,
  SITE_HEALTH_STATES,
  siteHealth,
  supportsLoomFeature,
  visiblePreviewPages,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthFilesystemReadScope } from "@t3tools/contracts";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
  type ReactNode,
} from "react";
import { Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ListSection } from "../../components/ui/ListSection";
import { Menu } from "../../components/ui/Menu";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useWorkspaceTabs } from "../../features/workspace/WorkspaceTabsContext";
import { useSearchScrollRestoration } from "../../features/workspace/useSearchScrollRestoration";
import { useAppForeground } from "../../lib/appState";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { useEnvironmentServerConfig, useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentsWithScope } from "../../state/session";
import { useLibraryAuthority } from "../library/libraryState";
import { previewLinks } from "../preview-links/state";
import { previewLinkSummary, visiblePreviewLinks } from "../preview-links/previewLinksLogic";
import { sites } from "../sites/state";
import { siteHost } from "../sites/SiteHealth";
import { resultsComputerAtom } from "./state";
import {
  matchingResults,
  missingResultsComputerReason,
  RESULTS_SECTION_LIMIT,
  resultsComputers,
  selectedResultsComputer,
  type ResultsComputer,
} from "./results-model";

function useResultsClock() {
  const focused = useIsFocused();
  const active = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const foreground = useAppForeground();
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expires preview links while this screen is visible and refreshes their ages after resume
  useEffect(() => {
    if (!active || !focused || !foreground) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [active, focused, foreground]);
  return now;
}

function useResultsRefreshOnRefocus(refresh: () => void) {
  const active = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const lastRefresh = useRef<(() => void) | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      if (lastRefresh.current === refresh) refresh();
      lastRefresh.current = refresh;
    }, [active, refresh]),
  );
}

function ResultNotice(props: {
  readonly children: ReactNode;
  readonly error?: boolean;
  readonly onRetry?: () => void;
}) {
  return (
    <View className="items-start gap-2 px-4 py-3">
      <Text
        textRole="footnote"
        accessibilityRole={props.error ? "alert" : undefined}
        className={props.error ? "text-danger-foreground" : "text-foreground-muted"}
      >
        {props.children}
      </Text>
      {props.onRetry ? <Button label="Try again" tone="text" onPress={props.onRetry} /> : null}
    </View>
  );
}

function MoreResults(props: {
  readonly count: number;
  readonly shown: number;
  readonly onPress: () => void;
}) {
  return props.count > props.shown ? (
    <ListRow
      icon="chevron.down"
      label={`Show more (${props.count - props.shown})`}
      onPress={props.onPress}
    />
  ) : null;
}

function missingComputerMessage(
  reason: ReturnType<typeof missingResultsComputerReason>,
  content: string,
) {
  switch (reason) {
    case "loading":
      return "Loading computer capabilities…";
    case "connect":
      return `Connect a computer to see ${content}.`;
    case "reconnect":
      return `Reconnect a computer to load ${content}.`;
    case "unsupported":
      return `Update Loom on a connected computer to browse ${content}.`;
  }
}

export function ResultsScreen() {
  const workspace = useWorkspaceTabs();
  const { environments, isReady } = useEnvironments();
  const [computerId, setComputerId] = useAtom(resultsComputerAtom);
  const computers = useMemo(() => resultsComputers(environments), [environments]);
  const computer = selectedResultsComputer(computers, computerId);
  const unavailableReason = missingResultsComputerReason(environments, isReady);
  const now = useResultsClock();
  const query = workspace?.state.tabs.results.query.trim() ?? "";
  const insets = useSafeAreaInsets();
  const bottomSafeArea = useNativeColumnLayoutMetrics()?.safeArea.bottom ?? insets.bottom;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [initialOffset] = useState(() => workspace?.getScrollOffset("results") ?? 0);
  const tab = workspace?.state.tabs.results;
  useSearchScrollRestoration(tab?.searchMode, () => {
    scrollRef.current?.scrollTo({
      y: (tab?.scrollOffset ?? 0) - (Platform.OS === "ios" ? insets.top : 0),
      animated: false,
    });
  });

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
      contentContainerClassName="gap-6 px-5 pt-4"
      contentContainerStyle={{
        paddingBottom:
          Math.max(bottomSafeArea + 24, workspace?.bottomClearance ?? 0) -
          (Platform.OS === "ios" ? bottomSafeArea : 0),
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={100}
      onScroll={(event) =>
        workspace?.recordScrollOffset(
          "results",
          Math.max(0, event.nativeEvent.contentOffset.y + (Platform.OS === "ios" ? insets.top : 0)),
        )
      }
    >
      <Text textRole="body" className="px-1 text-foreground-muted">
        Open the pages, sites and files your work produces.
      </Text>
      {computers.length ? (
        <ListSection>
          <Menu
            title="Results from"
            actions={computers.map((entry) => ({
              id: entry.environmentId,
              title: entry.label,
              subtitle: entry.connected ? undefined : "Offline",
              state: entry.environmentId === computer?.environmentId ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) => {
              const selected = computers.find((entry) => entry.environmentId === nativeEvent.event);
              if (selected) setComputerId(selected.environmentId);
            }}
          >
            <RowPressable
              accessibilityRole="button"
              accessibilityLabel={`Results from ${computer?.label}. Choose computer`}
            >
              <ListRowLayout
                icon="desktopcomputer"
                label={computer?.label ?? "Choose computer"}
                description={
                  computer?.connected ? "Pages and live previews" : "Offline. Reconnect to refresh."
                }
                accessory={
                  <SymbolView name="chevron.down" size={14} tintColorClassName="accent-chevron" />
                }
              />
            </RowPressable>
          </Menu>
        </ListSection>
      ) : null}
      <PagesResults
        key={`pages:${computer?.environmentId ?? "none"}`}
        computer={computer}
        unavailable={missingComputerMessage(unavailableReason, "published pages")}
        query={query}
        now={now}
      />
      <SitesResults query={query} now={now} />
      <PreviewResults
        key={`previews:${computer?.environmentId ?? "none"}`}
        computer={computer}
        unavailable={missingComputerMessage(unavailableReason, "live previews")}
        query={query}
        now={now}
      />
      <FileResults query={query} />
    </ScreenScrollView>
  );
}

function PagesResults(props: {
  readonly computer: ResultsComputer | null;
  readonly unavailable: string;
  readonly query: string;
  readonly now: number;
}) {
  const navigation = useNavigation();
  const computer = props.computer;
  const query = useEnvironmentQuery(
    computer?.pages
      ? previewLinks.pages({ environmentId: computer.environmentId, input: {} })
      : null,
  );
  useResultsRefreshOnRefocus(query.refresh);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(RESULTS_SECTION_LIMIT);
  const pages = matchingResults(
    visiblePreviewPages(query.data?.available ? query.data.pages : [], props.now).filter(
      (page) => page.state === "open",
    ),
    props.query,
    (page) => `pages ${page.title} ${page.url} ${computer?.label ?? ""}`,
  );
  const open = async (url: string) => {
    setError(null);
    await Linking.openURL(url).catch(() => setError("Could not open this page. Try again."));
  };
  return (
    <ListSection
      title="Pages"
      footer="Reports and interactive pages published to your Library. Your browser may ask you to sign in."
    >
      {error ? <ResultNotice error>{error}</ResultNotice> : null}
      {query.error ? (
        <ResultNotice error onRetry={query.refresh}>
          {query.error}
        </ResultNotice>
      ) : null}
      {!computer ? (
        <ResultNotice>{props.unavailable}</ResultNotice>
      ) : !computer.pages ? (
        <ResultNotice>Update this computer to browse its published pages.</ResultNotice>
      ) : query.data === null && !query.error ? (
        <ResultNotice>
          {computer.connected ? "Loading pages…" : "Reconnect this computer to load its pages."}
        </ResultNotice>
      ) : query.data === null ? null : !query.data.available ? (
        <ResultNotice>Your Library does not publish pages yet.</ResultNotice>
      ) : pages.length === 0 ? (
        <ResultNotice>
          {props.query
            ? "No pages match your search."
            : "No published pages yet. Pages shared by your agents appear here."}
        </ResultNotice>
      ) : (
        pages
          .slice(0, visibleCount)
          .map((page) => (
            <ListRow
              key={page.id}
              icon="doc.text"
              label={page.title}
              description={previewPageSummary(page, props.now)}
              disabled={
                !previewPageControls(page, false, props.now).some(
                  (control) => control.control === "open" && control.enabled,
                )
              }
              onPress={() => void open(page.url)}
            />
          ))
      )}
      <MoreResults
        count={pages.length}
        shown={visibleCount}
        onPress={() => setVisibleCount((count) => count + RESULTS_SECTION_LIMIT)}
      />
      <ListRow
        icon="doc.on.doc"
        label="Manage pages"
        onPress={() => navigation.navigate("SettingsPreviewLinks")}
      />
    </ListSection>
  );
}

function SitesResults(props: { readonly query: string; readonly now: number }) {
  const navigation = useNavigation();
  const authority = useLibraryAuthority();
  const [visibleCount, setVisibleCount] = useState(RESULTS_SECTION_LIMIT);
  const config = useEnvironmentServerConfig(authority.environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const query = useEnvironmentQuery(
    authority.environmentId && supported
      ? sites.snapshot({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  useResultsRefreshOnRefocus(query.refresh);
  const snapshot = query.data?.snapshot;
  const matches = matchingResults(
    snapshot?.sites ?? [],
    props.query,
    (site) => `sites ${site.name} ${site.url}`,
  );
  return (
    <ListSection
      title="Sites"
      footer={`Published websites and their health checks${authority.environmentId ? ` from ${authority.label}` : ""}, shared across your projects.`}
    >
      {!authority.loaded ? (
        <ResultNotice>Loading your Library…</ResultNotice>
      ) : !authority.environmentId ? (
        <ListRow
          icon="globe"
          label="Connect your Library"
          description="Find your sites and their health checks."
          onPress={() => navigation.navigate("LibrarySettings")}
        />
      ) : config === null && authority.connected ? (
        <ResultNotice>Loading Library capabilities…</ResultNotice>
      ) : !supported ? (
        <ResultNotice>
          {authority.connected
            ? "Update your Library to browse sites."
            : "Reconnect your Library to load sites."}
        </ResultNotice>
      ) : (
        <>
          {!authority.connected ? (
            <ResultNotice>Library offline. Saved check results may be out of date.</ResultNotice>
          ) : null}
          {query.error ? (
            <ResultNotice error onRetry={query.refresh}>
              {query.error}
            </ResultNotice>
          ) : null}
          {!query.data && !query.error ? (
            <ResultNotice>
              {authority.connected ? "Loading sites…" : "Reconnect your Library to load sites."}
            </ResultNotice>
          ) : !query.data ? null : !query.data.configured ? (
            <ResultNotice>Connect the personal API on your Library to see sites here.</ResultNotice>
          ) : matches.length === 0 ? (
            <ResultNotice>
              {props.query
                ? "No sites match your search."
                : "No sites registered yet. Register a website in Sites to keep track of it."}
            </ResultNotice>
          ) : (
            matches
              .slice(0, visibleCount)
              .map((site) => (
                <ListRow
                  key={site.id}
                  icon="globe"
                  label={site.name}
                  description={siteHost(site.url)}
                  detail={
                    snapshot
                      ? SITE_HEALTH_STATES[siteHealth(site, snapshot, props.now).state].label
                      : undefined
                  }
                  onPress={() => navigation.navigate("Sites", { siteId: site.id })}
                />
              ))
          )}
        </>
      )}
      <MoreResults
        count={matches.length}
        shown={visibleCount}
        onPress={() => setVisibleCount((count) => count + RESULTS_SECTION_LIMIT)}
      />
      <ListRow icon="globe" label="All sites" onPress={() => navigation.navigate("Sites")} />
    </ListSection>
  );
}

function PreviewResults(props: {
  readonly computer: ResultsComputer | null;
  readonly unavailable: string;
  readonly query: string;
  readonly now: number;
}) {
  const navigation = useNavigation();
  const computer = props.computer;
  const query = useEnvironmentQuery(
    computer?.previews
      ? previewLinks.snapshot({ environmentId: computer.environmentId, input: {} })
      : null,
  );
  useResultsRefreshOnRefocus(query.refresh);
  const canOpen = useAtomValue(previewLinks.open.permissionAtom(computer?.environmentId ?? null));
  const openLink = useAtomCommand(previewLinks.open, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(RESULTS_SECTION_LIMIT);
  const pendingRef = useRef(false);
  const snapshot = query.data;
  const links = matchingResults(
    snapshot
      ? visiblePreviewLinks(snapshot.links, snapshot.setup.settings, props.now).filter(
          (link) => link.state === "open" && Date.parse(link.expiresAt) > props.now,
        )
      : [],
    props.query,
    (link) => `previews ${link.host} ${link.port} ${computer?.label ?? ""}`,
  );
  const open = async (linkId: string) => {
    if (!computer || pendingRef.current || !computer.connected || !canOpen) return;
    pendingRef.current = true;
    setPending(linkId);
    setError(null);
    await (async () => {
      const result = await openLink({
        environmentId: computer.environmentId,
        input: { link: linkId },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      await Linking.openURL(result.value.url);
    })().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not open this preview."),
    );
    pendingRef.current = false;
    setPending(null);
  };
  return (
    <ListSection
      title="Live previews"
      footer="Temporary private links to apps running on your computer."
    >
      {error ? <ResultNotice error>{error}</ResultNotice> : null}
      {query.error ? (
        <ResultNotice error onRetry={query.refresh}>
          {query.error}
        </ResultNotice>
      ) : null}
      {!computer ? (
        <ResultNotice>{props.unavailable}</ResultNotice>
      ) : !computer.previews ? (
        <ResultNotice>This computer does not support private preview links.</ResultNotice>
      ) : !snapshot && !query.error ? (
        <ResultNotice>
          {computer.connected
            ? "Loading live previews…"
            : "Reconnect this computer to load its live previews."}
        </ResultNotice>
      ) : !snapshot ? null : links.length === 0 ? (
        <ResultNotice>
          {props.query
            ? "No live previews match your search."
            : "No live previews. Share a running app from a chat to open it here."}
        </ResultNotice>
      ) : (
        links
          .slice(0, visibleCount)
          .map((link) => (
            <ListRow
              key={link.id}
              icon="safari"
              label={link.host}
              description={previewLinkSummary(link, props.now)}
              detail={
                pending === link.id ? "Opening…" : !computer.connected ? "Offline" : undefined
              }
              disabled={!canOpen || !computer.connected || pending !== null}
              onPress={() => void open(link.id)}
            />
          ))
      )}
      <MoreResults
        count={links.length}
        shown={visibleCount}
        onPress={() => setVisibleCount((count) => count + RESULTS_SECTION_LIMIT)}
      />
      <ListRow
        icon="safari"
        label="Manage previews"
        onPress={() => navigation.navigate("SettingsPreviewLinks")}
      />
    </ListSection>
  );
}

function FileResults(props: { readonly query: string }) {
  const navigation = useNavigation();
  const projects = useProjects();
  const { environments, isReady } = useEnvironments();
  const readableEnvironments = useEnvironmentsWithScope(environments, AuthFilesystemReadScope);
  const [visibleCount, setVisibleCount] = useState(RESULTS_SECTION_LIMIT);
  const computers = new Map(
    environments
      .filter((entry) => entry.entry.enabled)
      .map((entry) => [entry.environmentId, entry]),
  );
  const matches = matchingResults(
    projects
      .filter(
        (project) =>
          !project.archivedAt && !project.isScratch && computers.has(project.environmentId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    props.query,
    (project) =>
      `files ${project.title} ${project.workspaceRoot} ${computers.get(project.environmentId)?.label ?? ""}`,
  );
  return (
    <ListSection
      title="Project files"
      footer="Browse source, documents, images and other files in your project folders."
    >
      {!matches.length ? (
        <ResultNotice>
          {props.query
            ? "No project folders match your search."
            : isReady
              ? "Project folders appear when a computer shares its workspaces."
              : "Loading project folders…"}
        </ResultNotice>
      ) : (
        matches.slice(0, visibleCount).map((project) => {
          const computer = computers.get(project.environmentId);
          const connected = computer?.connection.phase === "connected";
          const canRead = readableEnvironments.has(project.environmentId);
          return (
            <ListRow
              key={`${project.environmentId}:${project.id}`}
              icon="folder"
              label={project.title}
              description={computer?.label}
              detail={!connected ? "Offline" : !canRead ? "No file access" : undefined}
              disabled={!connected || !canRead}
              onPress={() =>
                navigation.navigate("ThreadFiles", {
                  environmentId: project.environmentId,
                  cwd: project.workspaceRoot,
                  projectName: project.title,
                })
              }
            />
          );
        })
      )}
      <MoreResults
        count={matches.length}
        shown={visibleCount}
        onPress={() => setVisibleCount((count) => count + RESULTS_SECTION_LIMIT)}
      />
      <ListRow
        icon="briefcase"
        label="All projects"
        onPress={() => navigation.navigate("Library")}
      />
    </ListSection>
  );
}
