import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { SITE_HEALTH_STATES, siteHealth, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { AuthOrchestrationReadScope, type EnvironmentId } from "@t3tools/contracts";
import { SITES_FEATURE, type SitesSnapshot, type SitesState } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { Image } from "expo-image";
import { use, useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Platform, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ListSection } from "../../components/ui/ListSection";
import { Menu } from "../../components/ui/Menu";
import { RowPressable } from "../../components/ui/RowPressable";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { Toolbar } from "../../components/ui/Toolbar";
import { useWorkspaceTabs } from "../../features/workspace/WorkspaceTabsContext";
import { useAppActive } from "../../lib/appState";
import { cn } from "../../lib/cn";
import { useNativeColumnLayoutMetrics } from "../../native/native-layout-metrics";
import {
  NativePrimaryColumnContext,
  NativeWorkspaceTabActivityContext,
} from "../../native/v5-workspace-context";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useEnvironmentQuery, type EnvironmentQueryView } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useLibraryAuthority } from "../library/libraryState";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { previewLinks } from "../preview-links/state";
import { previewLinkSummary, visiblePreviewLinks } from "../preview-links/previewLinksLogic";
import { sites } from "../sites/state";
import { siteHost } from "../sites/SiteHealth";
import {
  SITE_PREVIEW_LIMIT,
  previewUnavailableReason,
  selectedPreviewComputer,
  siteFaviconUrl,
  siteListSections,
  sitePreviewComputers,
  togglePinnedSite,
  type SitePreviewComputer,
} from "./site-browser-model";

const BROWSE_REFRESH_MS = 60_000;
const SITE_LIST_LIMIT = 8;

function useBrowseClock(active: boolean) {
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- visible site health and preview expiry age without running timers in hidden tabs or the background
  useEffect(() => {
    if (!active) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, BROWSE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function useVisibleSiteRefresh(active: boolean, refresh: () => void) {
  const seen = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refreshes monitoring observations on return and periodically only while the website list is visible
  useEffect(() => {
    if (!active) return;
    if (seen.current) refresh();
    seen.current = true;
    const timer = setInterval(refresh, BROWSE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);
}

function BrowseNotice(props: {
  readonly children: ReactNode;
  readonly error?: boolean;
  readonly onRetry?: () => void;
  readonly action?: ReactNode;
}) {
  return (
    <View className="gap-3 rounded-3xl bg-grouped-card p-5">
      <Text
        textRole="body"
        accessibilityRole={props.error ? "alert" : undefined}
        className={props.error ? "text-danger-foreground" : "text-foreground-muted"}
      >
        {props.children}
      </Text>
      {props.onRetry ? <Button label="Try again" tone="text" onPress={props.onRetry} /> : null}
      {props.action}
    </View>
  );
}

function SiteIdentity(props: {
  readonly name: string;
  readonly url: string;
  readonly featured: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const uri = siteFaviconUrl(props.url);
  return (
    <View
      className={cn(
        "items-center justify-center rounded-full bg-secondary",
        props.featured ? "size-14" : "size-11",
      )}
    >
      <Text
        textRole={props.featured ? "title" : "headline"}
        className="font-t3-semibold text-secondary-foreground"
        style={{ opacity: loaded && !failed ? 0 : 1 }}
      >
        {props.name.trim().slice(0, 1).toLocaleUpperCase() || "W"}
      </Text>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={{ position: "absolute", width: 28, height: 28, borderRadius: 6 }}
          contentFit="contain"
          cachePolicy="memory"
          accessibilityElementsHidden
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

function SiteCard(props: {
  readonly site: SitesSnapshot["sites"][number];
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly pinned: boolean;
  readonly pinDisabled: boolean;
  readonly onPin: () => void;
  readonly onDetails: () => void;
}) {
  const state = SITE_HEALTH_STATES[siteHealth(props.site, props.snapshot, props.now).state];
  return (
    <Menu
      title={props.site.name}
      shouldOpenOnLongPress
      actions={[
        {
          id: "pin",
          title: props.pinned ? "Unpin website" : "Pin website",
          image: props.pinned ? "pin.slash" : "pin",
          attributes: { disabled: props.pinDisabled },
        },
      ]}
      onPressAction={props.onPin}
    >
      <RowPressable
        accessibilityRole="button"
        accessibilityLabel={`${props.site.name}, ${state.label}${props.pinned ? ", pinned" : ""}`}
        accessibilityHint="View website details"
        onPress={props.onDetails}
        className="min-w-0 flex-row items-center gap-4 rounded-3xl bg-grouped-card p-5"
      >
        <SiteIdentity key={props.site.url} name={props.site.name} url={props.site.url} featured />
        <View className="min-w-0 flex-1 gap-1.5">
          <Text textRole="headline" className="font-t3-semibold" numberOfLines={2}>
            {props.site.name}
          </Text>
          <Text textRole="footnote" className="text-foreground-muted" numberOfLines={1}>
            {siteHost(props.site.url)}
          </Text>
          <LibraryStateBadge tone={state.tone} label={state.label} />
        </View>
        {props.pinned ? (
          <SymbolView name="pin" size={13} tintColorClassName="accent-icon-muted" />
        ) : null}
        <SymbolView name="chevron.right" size={13} tintColorClassName="accent-chevron" />
      </RowPressable>
    </Menu>
  );
}

function MonitoredSites(props: {
  readonly authority: ReturnType<typeof useLibraryAuthority>;
  readonly query: EnvironmentQueryView<typeof SitesState.Type>;
  readonly supported: boolean;
  readonly capabilitiesPending: boolean;
  readonly now: number;
}) {
  const navigation = useNavigation();
  const { authority, query } = props;
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom, { mode: "promise" });
  const [pinPending, setPinPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SITE_LIST_LIMIT);
  const snapshot = query.data?.snapshot;
  const pins = AsyncResult.isSuccess(preferences)
    ? (preferences.value.loomPinnedSites?.[authority.environmentId ?? ""] ?? [])
    : [];
  const sections = siteListSections(snapshot?.sites ?? [], pins);
  const togglePin = async (siteId: string) => {
    if (!authority.environmentId || pinPending) return;
    setPinPending(true);
    setError(null);
    const environmentId = authority.environmentId;
    await save({
      transform: (current) => ({
        loomPinnedSites: togglePinnedSite(current.loomPinnedSites, environmentId, siteId),
      }),
    }).catch(() => setError("Could not save pinned websites. Try again."));
    setPinPending(false);
  };
  const card = (site: SitesSnapshot["sites"][number], pinned: boolean) =>
    snapshot ? (
      <SiteCard
        key={site.id}
        site={site}
        snapshot={snapshot}
        now={props.now}
        pinned={pinned}
        pinDisabled={pinPending || !AsyncResult.isSuccess(preferences)}
        onPin={() => void togglePin(site.id)}
        onDetails={() => navigation.navigate("Sites", { siteId: site.id })}
      />
    ) : null;
  return (
    <View className="gap-4">
      {snapshot?.sites.length ? (
        <Text textRole="footnote" className="px-1 text-foreground-muted">
          {snapshot.sites.length} {snapshot.sites.length === 1 ? "website" : "websites"}
        </Text>
      ) : null}
      {error ? <BrowseNotice error>{error}</BrowseNotice> : null}
      {!authority.loaded ? (
        <BrowseNotice>Loading your Library…</BrowseNotice>
      ) : !authority.environmentId ? (
        <BrowseNotice
          action={
            <Button
              label="Connect Library"
              tone="text"
              onPress={() => navigation.navigate("LibrarySettings")}
            />
          }
        >
          Connect your Library to see linked websites.
        </BrowseNotice>
      ) : !authority.connected && !snapshot ? (
        <BrowseNotice>Reconnect {authority.label} to load your websites.</BrowseNotice>
      ) : props.capabilitiesPending ? (
        <BrowseNotice>Loading Library capabilities…</BrowseNotice>
      ) : !props.supported ? (
        <BrowseNotice>Update {authority.label} to browse websites.</BrowseNotice>
      ) : !authority.canRead ? (
        <BrowseNotice>
          This connection cannot read websites. Sign in with access to your Library.
        </BrowseNotice>
      ) : (
        <>
          {!authority.connected ? (
            <BrowseNotice>
              Library offline. Monitoring observations may be out of date; websites can still open.
            </BrowseNotice>
          ) : null}
          {query.error ? (
            <BrowseNotice error onRetry={query.refresh}>
              {query.error}
            </BrowseNotice>
          ) : null}
          {!query.data && !query.error ? (
            <BrowseNotice>Loading websites…</BrowseNotice>
          ) : !query.data ? null : !query.data.configured ? (
            <BrowseNotice>
              Connect website monitoring in Loom on your computer to see your websites here.
            </BrowseNotice>
          ) : !snapshot ? (
            <BrowseNotice onRetry={query.refresh}>
              Monitoring data is not available yet.
            </BrowseNotice>
          ) : snapshot.sites.length === 0 ? (
            <BrowseNotice>
              No websites linked yet. Add a website in Sites to keep it close at hand.
            </BrowseNotice>
          ) : (
            <>
              {sections.pinned.length ? (
                <View className="gap-3">
                  <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
                    Pinned
                  </Text>
                  {sections.pinned.map((site) => card(site, true))}
                </View>
              ) : null}
              {sections.other.length ? (
                <View className="gap-3">
                  {sections.pinned.length ? (
                    <Text textRole="footnote" className="px-1 font-t3-medium text-foreground-muted">
                      All websites
                    </Text>
                  ) : null}
                  {sections.other.slice(0, visibleCount).map((site) => card(site, false))}
                  {sections.other.length > visibleCount ? (
                    <Button
                      label={`Show more (${sections.other.length - visibleCount})`}
                      tone="text"
                      onPress={() => setVisibleCount((count) => count + SITE_LIST_LIMIT)}
                    />
                  ) : null}
                </View>
              ) : null}
            </>
          )}
        </>
      )}
    </View>
  );
}

function LivePreviews(props: {
  readonly computer: SitePreviewComputer | null;
  readonly now: number;
  readonly unavailableReason: string;
}) {
  const { computer } = props;
  const canRead = useEnvironmentScope(computer?.environmentId ?? null, AuthOrchestrationReadScope);
  const query = useEnvironmentQuery(
    computer && canRead
      ? previewLinks.snapshot({ environmentId: computer.environmentId, input: {} })
      : null,
  );
  const canOpen = useAtomValue(previewLinks.open.permissionAtom(computer?.environmentId ?? null));
  const openLink = useAtomCommand(previewLinks.open, { reportFailure: false });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(SITE_PREVIEW_LIMIT);
  const pendingRef = useRef(false);
  const snapshot = query.data;
  const links = snapshot
    ? visiblePreviewLinks(snapshot.links, snapshot.setup.settings, props.now).filter(
        (link) => link.state === "open" && Date.parse(link.expiresAt) > props.now,
      )
    : [];
  const open = async (linkId: string) => {
    if (!computer || !canOpen || !computer.connected || pendingRef.current) return;
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
    <View className="gap-3">
      {error ? <BrowseNotice error>{error}</BrowseNotice> : null}
      {query.error ? (
        <BrowseNotice error onRetry={query.refresh}>
          {query.error}
        </BrowseNotice>
      ) : null}
      {!computer ? (
        <Text textRole="footnote" className="text-foreground-muted">
          {props.unavailableReason}
        </Text>
      ) : !computer.connected ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Reconnect {computer.label} to open its live previews.
        </Text>
      ) : !canRead ? (
        <Text textRole="footnote" className="text-foreground-muted">
          This connection cannot read previews.
        </Text>
      ) : !snapshot && !query.error ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Loading live previews…
        </Text>
      ) : !snapshot ? null : links.length === 0 ? (
        <Text textRole="footnote" className="text-foreground-muted">
          Live previews shared from your threads will appear here.
        </Text>
      ) : (
        <>
          {!canOpen ? (
            <BrowseNotice>
              This connection can view preview information but cannot open private links.
            </BrowseNotice>
          ) : null}
          <ListSection>
            {links.slice(0, visibleCount).map((link) => (
              <ListRow
                key={link.id}
                icon="safari"
                label={link.host}
                description={previewLinkSummary(link, props.now)}
                detail={pending === link.id ? "Opening…" : undefined}
                disabled={!canOpen || pending !== null}
                onPress={() => void open(link.id)}
              />
            ))}
            {links.length > visibleCount ? (
              <ListRow
                icon="chevron.down"
                label={`Show more (${links.length - visibleCount})`}
                onPress={() => setVisibleCount((count) => count + SITE_PREVIEW_LIMIT)}
              />
            ) : null}
          </ListSection>
        </>
      )}
    </View>
  );
}

export function SiteBrowserScreen() {
  const navigation = useNavigation();
  const registry = use(RegistryContext);
  const workspace = useWorkspaceTabs();
  const authority = useLibraryAuthority();
  const focused = useIsFocused();
  const primary = use(NativePrimaryColumnContext);
  const tabActive = use(NativeWorkspaceTabActivityContext)?.active ?? true;
  const foreground = useAppActive();
  const active = tabActive && (focused || primary?.presented === true) && foreground;
  const now = useBrowseClock(active);
  const config = useEnvironmentServerConfig(authority.environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  // Native pull indicators change the scroll offset; background refreshes must stay silent.
  const [refreshing, setRefreshing] = useState(false);
  const refreshRequest = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a pull refresh belongs to the visible Library connection and must release its query subscription when that connection changes
  useEffect(() => {
    if (
      !active ||
      !authority.environmentId ||
      !authority.connected ||
      !authority.canRead ||
      !supported
    )
      return;
    return () => {
      refreshRequest.current?.abort();
      refreshRequest.current = null;
      setRefreshing(false);
    };
  }, [active, authority.environmentId, authority.connected, authority.canRead, supported]);
  const query = useEnvironmentQuery(
    authority.environmentId && supported && authority.canRead
      ? sites.snapshot({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  useVisibleSiteRefresh(
    active && authority.connected && supported && authority.canRead,
    query.refresh,
  );
  const { environments, isReady } = useEnvironments();
  const [selectedComputer, setSelectedComputer] = useState<EnvironmentId | null>(null);
  const computers = sitePreviewComputers(environments);
  const computer = selectedPreviewComputer(computers, selectedComputer);
  const insets = useSafeAreaInsets();
  const bottomSafeArea = useNativeColumnLayoutMetrics()?.safeArea.bottom ?? insets.bottom;
  const pullToRefresh = async () => {
    if (
      !active ||
      !authority.environmentId ||
      !authority.connected ||
      !supported ||
      !authority.canRead ||
      refreshRequest.current
    )
      return;
    const request = new AbortController();
    refreshRequest.current = request;
    setRefreshing(true);
    await executeAtomQuery(
      registry,
      sites.snapshot({ environmentId: authority.environmentId, input: {} }),
      {
        refresh: true,
        signal: request.signal,
        reportFailure: false,
        reportDefect: false,
      },
    ).finally(() => {
      if (refreshRequest.current === request) {
        refreshRequest.current = null;
        setRefreshing(false);
      }
    });
  };
  return (
    <>
      <Toolbar placement="right">
        <Toolbar.Menu accessibilityLabel="Website options" icon="ellipsis" separateBackground>
          <Toolbar.MenuAction icon="globe" onPress={() => navigation.navigate("Sites")}>
            Manage websites
          </Toolbar.MenuAction>
          <Toolbar.MenuAction
            icon="safari"
            onPress={() => navigation.navigate("SettingsPreviewLinks")}
          >
            Manage previews
          </Toolbar.MenuAction>
        </Toolbar.Menu>
      </Toolbar>
      <ScreenScrollView
        className="flex-1 bg-screen"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-8 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom:
            Math.max(bottomSafeArea + 24, workspace?.bottomClearance ?? 0) -
            (Platform.OS === "ios" ? bottomSafeArea : 0),
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} />
        }
      >
        <MonitoredSites
          key={authority.environmentId ?? "none"}
          authority={authority}
          query={query}
          supported={supported}
          capabilitiesPending={config === null}
          now={now}
        />
        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text textRole="headline" className="font-t3-semibold">
              Live previews
            </Text>
            {computers.length > 1 ? (
              <Menu
                title="Preview computer"
                actions={computers.map((entry) => ({
                  id: entry.environmentId,
                  title: entry.label,
                  subtitle: entry.connected ? undefined : "Offline",
                  state: entry.environmentId === computer?.environmentId ? "on" : "off",
                }))}
                onPressAction={({ nativeEvent }) => {
                  const selected = computers.find(
                    (entry) => entry.environmentId === nativeEvent.event,
                  );
                  if (selected) setSelectedComputer(selected.environmentId);
                }}
              >
                <RowPressable
                  accessibilityRole="button"
                  accessibilityLabel={`Preview computer: ${computer?.label ?? "Choose computer"}`}
                  className="min-h-11 flex-row items-center gap-2 px-2"
                >
                  <Text textRole="footnote" className="text-foreground-muted">
                    {computer?.label ?? "Choose computer"}
                  </Text>
                  <SymbolView name="chevron.down" size={12} tintColorClassName="accent-chevron" />
                </RowPressable>
              </Menu>
            ) : null}
          </View>
          <LivePreviews
            key={computer?.environmentId ?? "none"}
            computer={computer}
            now={now}
            unavailableReason={previewUnavailableReason(environments, isReady)}
          />
        </View>
      </ScreenScrollView>
    </>
  );
}
