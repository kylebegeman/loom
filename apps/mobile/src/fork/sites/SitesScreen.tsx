import { useSiteCheckClock } from "./use-site-check-clock";
import { useMemo, useState } from "react";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { Linking, Pressable, ScrollView, View } from "react-native";
import {
  SITE_HEALTH_STATES,
  libraryProjectColor,
  siteCheckState,
  siteHealth,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import {
  SITES_FEATURE,
  SITES_MANAGEMENT_FEATURE,
  type LibraryProject,
  type LibraryProjectColor,
  type SitesSnapshot,
} from "@t3tools/contracts/fork";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { SettingsSection } from "../../features/settings/components/SettingsSection";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { cn } from "../../lib/cn";
import { useAtomCommand } from "../../state/use-atom-command";
import { sites } from "./state";
import { SiteEditor, type SiteEditTarget } from "./SiteEditor";
import { SiteDetail } from "./SiteDetail";
import { SiteServiceGroup, SiteStateDot, ago } from "./SiteHealth";
import { SiteTrafficSkeleton } from "./SiteTraffic";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentServerConfig } from "../../state/entities";
import { LibraryNotice, LibraryPage } from "../library/LibraryPage";
import { useLibraryProjectColorValue } from "../library/libraryProjectColors";
import { LibraryStateBadge } from "../library/LibraryStateBadge";
import { library, useLibraryAuthority } from "../library/libraryState";

type SitesView = "sites" | "services";

const VIEW_OPTIONS = [
  { value: "sites", label: "Sites" },
  { value: "services", label: "Services" },
] as const satisfies readonly { value: SitesView; label: string }[];

/** Sites are about the web, not one project, until a site names the project it serves. */
const SITES_COLOR: LibraryProjectColor = "blue";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function SitesRouteScreen({ route }: StaticScreenProps<{ siteId?: string } | undefined>) {
  const authority = useLibraryAuthority();
  return <SitesScreen key={authority.environmentId} authority={authority} route={route} />;
}

// Keep drafts and pending actions bound to the Library where they started.
function SitesScreen({
  route,
  authority,
}: StaticScreenProps<{ siteId?: string } | undefined> & {
  authority: ReturnType<typeof useLibraryAuthority>;
}) {
  const navigation = useNavigation();
  const config = useEnvironmentServerConfig(authority.environmentId);
  const supported = supportsLoomFeature(config?.environment.capabilities, SITES_FEATURE);
  const selection = route.params?.siteId;
  const select = (siteId: string) => navigation.navigate("Sites", { siteId });
  const [view, setView] = useState<SitesView>("sites");
  const [linkError, setLinkError] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    authority.environmentId && supported
      ? sites.snapshot({ environmentId: authority.environmentId, input: {} })
      : null,
  );
  const snapshot = query.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  const selected = snapshot?.sites.find((site) => site.id === selection) ?? snapshot?.sites[0];
  const analytics = useEnvironmentQuery(
    authority.environmentId && supported && selected
      ? sites.analytics({ environmentId: authority.environmentId, input: { siteId: selected.id } })
      : null,
  );
  const manages = supportsLoomFeature(config?.environment.capabilities, SITES_MANAGEMENT_FEATURE);
  const allowed = useAtomValue(sites.saveSite.permissionAtom(authority.environmentId));
  const canManage = Boolean(
    manages && query.data?.managementConfigured && allowed && authority.connected,
  );
  const projects = useEnvironmentQuery(
    authority.environmentId
      ? library.projects({
          environmentId: authority.environmentId,
          input: { includeArchived: true },
        })
      : null,
  );
  const projectsById = useMemo(
    () => new Map((projects.data ?? []).map((project) => [project.id, project])),
    [projects.data],
  );
  const resolveColor = useLibraryProjectColorValue();
  const [editing, setEditing] = useState<SiteEditTarget | null>(null);
  const [running, setRunning] = useState(false),
    [actionError, setActionError] = useState<string | null>(null);
  const runChecks = useAtomCommand(sites.runChecks, { reportFailure: false });
  const refresh = () => {
    query.refresh();
    analytics.refresh();
  };
  const run = async () => {
    if (!authority.environmentId || !canManage || running) return;
    setRunning(true);
    setActionError(null);
    try {
      const result = await runChecks({ environmentId: authority.environmentId, input: {} });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not run checks.");
    } finally {
      setRunning(false);
    }
  };
  const open = (url: string) => {
    setLinkError(null);
    void Linking.openURL(url).catch(() => setLinkError("Could not open your browser. Try again."));
  };
  const openSite = (siteId: string) => {
    setView("sites");
    select(siteId);
  };
  const libraryLabel = authority.label;
  return (
    <LibraryPage
      title="Sites"
      actions={[
        {
          icon: "arrow.clockwise",
          accessibilityLabel: "Refresh sites",
          disabled: !authority.connected || !supported || query.isPending,
          onPress: refresh,
        },
        {
          icon: "plus",
          accessibilityLabel: "Register site",
          disabled: !canManage || !snapshot,
          onPress: () => setEditing({ kind: "site" }),
        },
      ]}
    >
      {!authority.environmentId ? (
        <EmptyState
          variant="plain"
          title="Choose your Library first"
          detail="Sites live on your Library server. Choose it, then come back to watch your sites."
          actionLabel="Choose Library server"
          onAction={() => navigation.navigate("LibrarySettings")}
        />
      ) : authority.connected && !supported ? (
        <EmptyState
          variant="plain"
          title="Sites need a newer Library server"
          detail={`Update ${libraryLabel} to watch your sites here.`}
        />
      ) : query.data?.configured === false ? (
        <EmptyState
          variant="plain"
          title="Connect the personal API"
          detail={`Connect the personal API to ${libraryLabel} to see your sites, their checks and their traffic.`}
        />
      ) : (
        <>
          {!authority.connected && snapshot ? (
            <LibraryNotice
              detail={`Library offline. Reconnect ${libraryLabel} to refresh. Saved check results and traffic below may be out of date.`}
            />
          ) : null}
          {query.data?.configured && !query.data.managementConfigured ? (
            <LibraryNotice
              detail={
                manages
                  ? "Viewing only. Site management needs a manager connection on your Library server."
                  : "Viewing only. Update your Library server to manage sites here."
              }
            />
          ) : null}
          {actionError ? <LibraryNotice error={actionError} /> : null}
          {linkError ? <LibraryNotice error={linkError} /> : null}
          {query.error ? (
            <View className="gap-1">
              <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
                {query.error}
              </Text>
              <Button label="Try again" tone="text" onPress={query.refresh} />
            </View>
          ) : null}
          {snapshot ? (
            <>
              <View className="gap-3">
                <SitesSummaryLine snapshot={snapshot} now={now} />
                <Button
                  label={running ? "Running checks…" : "Run all checks"}
                  icon="play"
                  disabled={!canManage || running}
                  onPress={() => void run()}
                />
              </View>
              <SegmentedControl
                options={VIEW_OPTIONS}
                selected={view}
                onSelect={setView}
                role="tab"
              />
              {view === "services" ? (
                <ServicesRegistry
                  snapshot={snapshot}
                  now={now}
                  canManage={canManage}
                  onEdit={setEditing}
                  onOpenSite={openSite}
                />
              ) : selected ? (
                <>
                  {snapshot.sites.length > 1 ? (
                    <SiteSwitcher
                      snapshot={snapshot}
                      now={now}
                      selectedId={selected.id}
                      onSelect={select}
                    />
                  ) : null}
                  <SiteDetail
                    key={selected.id}
                    site={selected}
                    snapshot={snapshot}
                    now={now}
                    color={resolveColor(siteColor(selected, projectsById))}
                    projects={projectsById}
                    analytics={analytics}
                    canManage={canManage}
                    onEdit={setEditing}
                    onVisit={open}
                    onOpenProject={(projectId) =>
                      navigation.navigate("LibraryProject", { projectId })
                    }
                  />
                </>
              ) : (
                <EmptyState
                  variant="plain"
                  title="Register your first site"
                  detail="Link a site to the projects it serves. Loom watches its endpoints and counts its visits, so you know it is up without opening it."
                  action={
                    <Button
                      label="Register a site"
                      tone="primary"
                      disabled={!canManage}
                      onPress={() => setEditing({ kind: "site" })}
                    />
                  }
                />
              )}
            </>
          ) : !authority.connected ? (
            <EmptyState
              variant="plain"
              title="Library offline"
              detail={`Reconnect ${libraryLabel} to load your sites.`}
            />
          ) : query.isPending ? (
            <SitesSkeleton />
          ) : null}
        </>
      )}
      {snapshot && authority.environmentId && editing ? (
        <SiteEditor
          key={`${editing.kind}:${editing.row?.id ?? "new"}`}
          target={editing}
          snapshot={snapshot}
          environmentId={authority.environmentId}
          connected={canManage}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            if (editing.kind === "site") openSite(id);
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
      <Button
        label="Explore the personal API catalog"
        tone="text"
        icon="arrow.up.right"
        onPress={() => open("https://api.begam.in/v1/public/catalog")}
      />
    </LibraryPage>
  );
}

/** A site takes the color of the first project it serves, so it reads as part of that project. */
function siteColor(
  site: SitesSnapshot["sites"][number],
  projects: ReadonlyMap<string, LibraryProject>,
): LibraryProjectColor {
  const project = site.projectIds?.map((id) => projects.get(id)).find(Boolean);
  return project ? libraryProjectColor(project) : SITES_COLOR;
}

function SitesSummaryLine({ snapshot, now }: { snapshot: SitesSnapshot; now: number }) {
  let failing = 0;
  let stale = 0;
  let watched = 0;
  for (const check of snapshot.checks) {
    const state = siteCheckState(check, snapshot.staleAfterSeconds, now);
    if (state === "disabled") continue;
    watched += 1;
    if (state === "failing") failing += 1;
    else if (state === "stale") stale += 1;
  }
  return (
    <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1.5">
      <Text className="text-xs tabular-nums text-foreground-muted">
        {[
          plural(snapshot.sites.length, "site"),
          plural(snapshot.services.length, "service"),
          plural(watched, "check"),
        ].join(" · ")}
      </Text>
      {failing ? (
        <LibraryStateBadge tone="danger" label={`${failing} failing`} />
      ) : stale ? (
        <LibraryStateBadge tone="warning" label={`${stale} out of date`} />
      ) : watched ? (
        <LibraryStateBadge tone="success" label="All passing" />
      ) : null}
      {snapshot.observedAt ? (
        <Text className="text-xs text-foreground-muted">Updated {ago(snapshot.observedAt)}</Text>
      ) : null}
    </View>
  );
}

/** Every site as a chip with its health, scrolled sideways so the selected one stays a tap away. */
function SiteSwitcher({
  snapshot,
  now,
  selectedId,
  onSelect,
}: {
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly selectedId: string;
  readonly onSelect: (siteId: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Registered sites"
      className="grow-0"
      style={{ marginHorizontal: -20 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
    >
      {snapshot.sites.map((site) => {
        const health = SITE_HEALTH_STATES[siteHealth(site, snapshot, now).state];
        const current = site.id === selectedId;
        return (
          <Pressable
            key={site.id}
            accessibilityRole="button"
            accessibilityLabel={`${site.name}, ${health.label}`}
            accessibilityState={{ selected: current }}
            onPress={() => onSelect(site.id)}
            className={cn(
              "min-h-10 flex-row items-center gap-2 rounded-full border px-3.5 active:opacity-70",
              current ? "border-foreground bg-foreground" : "border-border",
            )}
          >
            <SiteStateDot tone={health.tone} />
            <Text
              numberOfLines={1}
              className={cn(
                "max-w-[180px] text-sm font-t3-medium",
                current ? "text-screen" : "text-foreground",
              )}
            >
              {site.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Every service, read apart from the sites that use it, since one service can back several. */
function ServicesRegistry({
  snapshot,
  now,
  canManage,
  onEdit,
  onOpenSite,
}: {
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly canManage: boolean;
  readonly onEdit: (target: SiteEditTarget) => void;
  readonly onOpenSite: (siteId: string) => void;
}) {
  if (!snapshot.services.length) {
    return (
      <EmptyState
        variant="plain"
        title="No services yet"
        detail="A service is an origin your sites depend on, like the site itself or the API behind it. Add checks to a service to know when it stops answering."
        action={
          <Button
            label="Register service"
            tone="primary"
            disabled={!canManage}
            onPress={() => onEdit({ kind: "service" })}
          />
        }
      />
    );
  }
  return (
    <View className="gap-6">
      <View className="gap-3">
        <Text className="text-sm text-foreground-muted">
          Services can back several sites. Register one here, then link it from each site that uses
          it.
        </Text>
        <Button
          label="Register service"
          icon="plus"
          disabled={!canManage}
          onPress={() => onEdit({ kind: "service" })}
        />
      </View>
      <SettingsSection title="Services">
        {snapshot.services.map((service, index) => {
          const users = snapshot.sites.filter((site) => site.serviceIds.includes(service.id));
          return (
            <SiteServiceGroup
              key={service.id}
              service={service}
              separated={index > 0}
              checks={snapshot.checks.filter((check) => check.service_id === service.id)}
              staleAfterSeconds={snapshot.staleAfterSeconds}
              now={now}
              canManage={canManage}
              usedBy={
                users.length ? (
                  <View className="flex-row flex-wrap items-center gap-1.5">
                    <Text className="text-xs text-foreground-muted">Used by</Text>
                    {users.map((site) => (
                      <Pressable
                        key={site.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Open site ${site.name}`}
                        onPress={() => onOpenSite(site.id)}
                        className="min-h-8 flex-row items-center gap-1.5 rounded-full border border-border-subtle px-2.5 active:opacity-70"
                      >
                        <SiteStateDot
                          tone={SITE_HEALTH_STATES[siteHealth(site, snapshot, now).state].tone}
                        />
                        <Text
                          numberOfLines={1}
                          className="max-w-[160px] text-xs font-t3-medium text-foreground"
                        >
                          {site.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text className="text-xs text-foreground-muted">Not used by any site yet.</Text>
                )
              }
              onEditService={() => onEdit({ kind: "service", row: service })}
              onAddCheck={() => onEdit({ kind: "check", serviceId: service.id })}
              onEditCheck={(check) => onEdit({ kind: "check", row: check })}
            />
          );
        })}
      </SettingsSection>
    </View>
  );
}

/** The page's own shape while the first snapshot loads, so the layout holds when it arrives. */
function SitesSkeleton() {
  return (
    <View accessible accessibilityLabel="Loading sites" className="gap-6">
      <View className="gap-3">
        <View className="h-3.5 w-56 rounded-md bg-row-hover" />
        <View className="h-12 w-40 rounded-full bg-row-hover" />
      </View>
      <View className="h-9 w-full rounded-full bg-row-hover" />
      <SettingsSection>
        <View className="gap-4 p-4">
          <View className="flex-row items-center gap-4">
            <View className="size-14 rounded-2xl bg-row-hover" />
            <View className="flex-1 gap-2">
              <View className="h-6 w-40 rounded-md bg-row-hover" />
              <View className="h-3 w-32 rounded-md bg-row-hover" />
            </View>
          </View>
          <View className="h-5 w-48 rounded-full bg-row-hover" />
        </View>
      </SettingsSection>
      <SettingsSection>
        {["first", "second", "third"].map((row, index) => (
          <View
            key={row}
            className={cn(
              "flex-row items-center gap-3 px-4 py-3.5",
              index > 0 && "border-t border-border-subtle",
            )}
          >
            <View className="h-3.5 flex-1 rounded-md bg-row-hover" />
            <View className="h-5 w-16 rounded-full bg-row-hover" />
          </View>
        ))}
      </SettingsSection>
      <SettingsSection>
        <SiteTrafficSkeleton />
      </SettingsSection>
    </View>
  );
}
