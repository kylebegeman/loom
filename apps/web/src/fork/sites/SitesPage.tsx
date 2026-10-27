import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { EnvironmentId, type ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import {
  SITE_CHECK_STATES,
  SITE_HEALTH_STATES,
  SITE_TLS_WARNING_DAYS,
  libraryProjectColor,
  siteCheckState,
  siteChecksHealth,
  siteHealth,
  siteTrafficDays,
  supportsLoomFeature,
  type LibraryWorkflowTone,
  type SiteHealthState,
} from "@t3tools/client-runtime/fork";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  SITES_FEATURE,
  SITES_MANAGEMENT_FEATURE,
  type LibraryProject,
  type SitesSnapshot,
} from "@t3tools/contracts/fork";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";
import {
  AppWindowIcon,
  ArrowUpRightIcon,
  CircleAlertIcon,
  CloudOffIcon,
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ListFilterIcon,
  LockIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlugZapIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  WrenchIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useRelativeTimeState } from "~/hooks/useRelativeTimeState";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  LibraryCardTarget,
  LibraryLayoutToggle,
  LIBRARY_CARD,
  LIBRARY_CARD_GRID,
} from "../project-library/LibraryCollection";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryFilterChip,
  LibraryNotice,
  LibrarySearch,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import {
  LIBRARY_CELL,
  LIBRARY_ROW_TARGET,
  LIBRARY_TABLE_ROW,
  LibraryTable,
  Sparkline,
  TickStrip,
} from "../project-library/LibraryData";
import { LibraryPageFrame } from "../project-library/LibraryPageFrame";
import { LibraryTabs } from "../project-library/LibraryTabs";
import { ProjectWash } from "../project-library/ProjectCollection";
import { ProjectColorDot, projectColorStyle } from "../project-library/ProjectIdentity";
import {
  useLibraryAccessBlock,
  useLibraryAuthority,
  useLibraryPermission,
  useLibraryProjects,
} from "../project-library/state";
import { SiteDetail, SiteDetailSkeleton } from "./SiteDetail";
import { SiteEditor, useSiteActiveToggle, type SiteEditTarget } from "./SiteEditor";
import {
  ActionHint,
  CheckTicks,
  EndpointsTable,
  MenuBlockedNote,
  SITES_COLOR,
  SiteMark,
  checkVitals,
  orderChecksForAttention,
  siteChecks,
  siteColor,
  siteHost,
  type ActiveToggle,
} from "./SiteHealth";
import { SiteThumbnail, useSeen } from "./SiteThumbnail";
import { formatCount } from "./SiteTraffic";
import { sites } from "./state";
import { useSiteCheckClock } from "./use-site-check-clock";

type Site = SitesSnapshot["sites"][number];
type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];

export type SitesView = "sites" | "services";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
const byName = (a: { readonly name: string }, b: { readonly name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Below this many sites everything fits in one look, so a search field would only be noise. */
const SEARCH_THRESHOLD = 6;
const MAX_ATTENTION_ITEMS = 3;
/** Past this many checks the header strip would outgrow its line; worst checks lead, so none hide. */
const MAX_HEADER_TICKS = 60;
const MAX_CARD_PROJECTS = 1;
const MAX_ROW_PROJECTS = 2;
const CATALOG_URL = "https://api.begam.in/v1/public/catalog";
/** The project filter's entry for sites that serve no project yet. */
export const UNLINKED_PROJECT = "unlinked";
const OFFLINE_NOTICE = "Saved check results and traffic below may be out of date.";
/**
 * A site's page runs wider than the index so the Preview shrinks a desktop layout less. Every tab
 * shares it, so switching to Preview never resizes the hero above it.
 */
const SITE_PAGE_WIDTH = "expanded";

const SITE_SORTS = ["attention", "name", "visits"] as const;
export type SiteSort = (typeof SITE_SORTS)[number];
const SORT_LABELS: Record<SiteSort, string> = {
  attention: "Needs attention first",
  name: "Name",
  visits: "Most visited",
};

const PREFERENCES_KEY = "loom:sites:index-view:v1";
const SitesPreferences = Schema.Struct({
  view: Schema.Literals(["cards", "list"]),
  sort: Schema.Literals(SITE_SORTS),
  previews: Schema.Boolean,
});
type SitesPreferences = typeof SitesPreferences.Type;
const DEFAULT_PREFERENCES: SitesPreferences = { view: "cards", sort: "attention", previews: false };

const SERVICE_FILTERS = ["all", "failing", "paused"] as const;
export type ServiceFilter = (typeof SERVICE_FILTERS)[number];
const SERVICE_FILTER_LABELS: Record<ServiceFilter, string> = {
  all: "All",
  failing: "Failing",
  paused: "Paused",
};

// Worst news first, and paused sites last, since they say nothing about whether anything is up.
const HEALTH_ATTENTION: Record<SiteHealthState, number> = {
  failing: 0,
  stale: 1,
  unchecked: 2,
  unmonitored: 3,
  healthy: 4,
  paused: 5,
};
const HEALTH_ORDER = Object.keys(HEALTH_ATTENTION) as readonly SiteHealthState[];

export type SiteFilters = {
  readonly query: string;
  readonly states: ReadonlySet<SiteHealthState>;
  /** Project IDs, plus `UNLINKED_PROJECT` for sites that serve none. */
  readonly projects: ReadonlySet<string>;
};

const NO_FILTERS: SiteFilters = { query: "", states: new Set(), projects: new Set() };

/** The sites matching every active filter. Search reads names, addresses, IDs and project titles. */
export function filterSites(
  snapshot: SitesSnapshot,
  now: number,
  filters: SiteFilters,
  projects: ReadonlyMap<string, Pick<LibraryProject, "title">>,
): readonly Site[] {
  const needle = filters.query.trim().toLowerCase();
  return snapshot.sites.filter((site) => {
    if (filters.states.size && !filters.states.has(siteHealth(site, snapshot, now).state)) {
      return false;
    }
    const served = site.projectIds ?? [];
    if (
      filters.projects.size &&
      !(served.length
        ? served.some((projectId) => filters.projects.has(projectId))
        : filters.projects.has(UNLINKED_PROJECT))
    ) {
      return false;
    }
    if (!needle) return true;
    return [
      site.name,
      site.id,
      siteHost(site.url),
      ...served.map((projectId) => projects.get(projectId)?.title ?? ""),
    ].some((text) => text.toLowerCase().includes(needle));
  });
}

/**
 * Sites in the chosen order. Needs attention puts failing and stale sites first, then certificates
 * running out. Name keeps the primary site first, as the API names it the lead. Most visited
 * sorts by page views, with sites whose traffic has not loaded yet after the rest.
 */
export function sortSites(
  list: readonly Site[],
  snapshot: SitesSnapshot,
  now: number,
  sort: SiteSort,
  visits: ReadonlyMap<string, number> | null,
): readonly Site[] {
  const primary = (site: Site) => (site.id === snapshot.primarySiteId ? 0 : 1);
  if (sort === "name") {
    return list.toSorted((a, b) => primary(a) - primary(b) || byName(a, b));
  }
  if (sort === "visits") {
    return list.toSorted((a, b) => {
      const left = visits?.get(a.id);
      const right = visits?.get(b.id);
      if (left === undefined || right === undefined) {
        return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0) || byName(a, b);
      }
      return right - left || byName(a, b);
    });
  }
  return list
    .map((site) => {
      const certificate = checkVitals(siteChecks(site, snapshot), now).certificate;
      return {
        site,
        rank: HEALTH_ATTENTION[siteHealth(site, snapshot, now).state],
        certificate:
          site.active && certificate !== null && certificate <= SITE_TLS_WARNING_DAYS ? 0 : 1,
      };
    })
    .toSorted((a, b) => a.rank - b.rank || a.certificate - b.certificate || byName(a.site, b.site))
    .map(({ site }) => site);
}

export type SitesAttentionItem = {
  readonly key: string;
  readonly tone: "danger" | "warning";
  readonly title: string;
  readonly detail: string;
  /** Where the item opens: its site's Checks tab, or Services for a service no site uses. */
  readonly search:
    | { readonly siteId: string; readonly tab: "checks" }
    | { readonly view: "services" };
};

/** What a failing check did, short enough to sit after the site's name. */
function failureReading(check: Check) {
  const host = siteHost(check.url);
  const last = check.last;
  if (!last) return `${host} is failing`;
  if (last.status === null) return `${host} did not answer`;
  if (last.status !== (check.expected_status ?? 200)) return `${host} answered ${last.status}`;
  return check.content ? `${host} is missing “${check.content}”` : `${host} is failing`;
}

function certificateReading(days: number) {
  if (days < 0) return "certificate expired";
  if (days === 0) return "certificate expires today";
  return days === 1 ? "certificate expires tomorrow" : `certificate expires in ${days} days`;
}

/**
 * What needs someone now, one item per site with its worst problem: a failing check, an expired
 * certificate, results gone stale, then a certificate inside the warning window. A failing service
 * no site uses gets its own item, so nothing that is down hides behind the Services tab.
 */
export function sitesAttention(
  snapshot: SitesSnapshot,
  now: number,
): readonly SitesAttentionItem[] {
  const items: (SitesAttentionItem & { readonly rank: number })[] = [];
  for (const site of snapshot.sites) {
    if (!site.active) continue;
    const checks = siteChecks(site, snapshot);
    const health = siteHealth(site, snapshot, now);
    const certificate = checkVitals(checks, now).certificate;
    const search = { siteId: site.id, tab: "checks" } as const;
    const base = { key: `site:${site.id}`, title: site.name, search };
    if (health.state === "failing") {
      const failing = checks.filter(
        (check) => siteCheckState(check, snapshot.staleAfterSeconds, now) === "failing",
      );
      const [only] = failing;
      items.push({
        ...base,
        tone: "danger",
        rank: 0,
        detail:
          failing.length === 1 && only ? failureReading(only) : `${failing.length} checks failing`,
      });
    } else if (certificate !== null && certificate < 0) {
      items.push({ ...base, tone: "danger", rank: 1, detail: certificateReading(certificate) });
    } else if (health.state === "stale") {
      items.push({ ...base, tone: "warning", rank: 2, detail: "check results are out of date" });
    } else if (certificate !== null && certificate <= SITE_TLS_WARNING_DAYS) {
      items.push({ ...base, tone: "warning", rank: 3, detail: certificateReading(certificate) });
    }
  }
  const used = new Set(snapshot.sites.flatMap((site) => site.serviceIds));
  for (const service of snapshot.services) {
    if (!service.active || used.has(service.id)) continue;
    const health = serviceHealth(service, snapshot, now);
    if (health.state !== "failing") continue;
    items.push({
      key: `service:${service.id}`,
      title: service.name,
      tone: "danger",
      rank: 0,
      detail: `${plural(health.failing, "check")} failing`,
      search: { view: "services" },
    });
  }
  return items
    .toSorted((a, b) => a.rank - b.rank || a.title.localeCompare(b.title))
    .map(({ rank: _rank, ...item }) => item);
}

/**
 * The one-word answer to "is everything up?" that leads the header. Only a passing result counts
 * as normal: a check that has not run yet says nothing, as `siteChecksHealth` reads it on a card.
 */
export function sitesStatus(snapshot: SitesSnapshot, now: number) {
  let watched = 0;
  let passing = 0;
  let failing = 0;
  let stale = 0;
  let unchecked = 0;
  for (const check of snapshot.checks) {
    const state = siteCheckState(check, snapshot.staleAfterSeconds, now);
    if (state === "disabled") continue;
    watched += 1;
    if (state === "healthy") passing += 1;
    else if (state === "failing") failing += 1;
    else if (state === "stale") stale += 1;
    else unchecked += 1;
  }
  const tone: LibraryWorkflowTone = failing
    ? "danger"
    : stale
      ? "warning"
      : unchecked || !watched
        ? "neutral"
        : "success";
  const label = failing
    ? `${failing} failing`
    : stale
      ? `${stale} out of date`
      : unchecked
        ? `${unchecked} not checked yet`
        : watched
          ? "All normal"
          : "Nothing watched";
  return { tone, label, watched, passing, failing, stale, unchecked };
}

export type SitesGate = "choose-library" | "connecting" | "offline" | "unsupported" | null;

/**
 * What stands between the page and asking for a snapshot. Support is only known once the Library
 * has sent its config, so until then the page waits or says it is offline, never "update".
 */
export function sitesGate(library: {
  readonly chosen: boolean;
  readonly connected: boolean;
  readonly capabilities: ExecutionEnvironmentCapabilities | null | undefined;
}): SitesGate {
  if (!library.chosen) return "choose-library";
  if (!library.capabilities) return library.connected ? "connecting" : "offline";
  return supportsLoomFeature(library.capabilities, SITES_FEATURE) ? null : "unsupported";
}

function serviceHealth(
  service: Service,
  snapshot: Pick<SitesSnapshot, "checks" | "staleAfterSeconds">,
  now: number,
) {
  return siteChecksHealth(
    snapshot.checks.filter((check) => check.service_id === service.id),
    snapshot.staleAfterSeconds,
    now,
    !service.active,
  );
}

/** The services the Services tab shows under its filter, with each filter's count. */
export function filterServices(snapshot: SitesSnapshot, now: number, filter: ServiceFilter) {
  const failing = snapshot.services.filter(
    (service) => serviceHealth(service, snapshot, now).state === "failing",
  );
  const paused = snapshot.services.filter((service) => !service.active);
  return {
    services: filter === "failing" ? failing : filter === "paused" ? paused : snapshot.services,
    counts: { all: snapshot.services.length, failing: failing.length, paused: paused.length },
  };
}

/**
 * Page views for every listed site, read only while sorting by them. One derived atom per site
 * list joins the per-site queries the cards already share, so nothing is requested twice.
 */
const siteVisitsAtom = Atom.family((key: string) => {
  const [environment = "", ...siteIds] = key.split("\n");
  const environmentId = EnvironmentId.make(environment);
  return Atom.make((get): AsyncResult.AsyncResult<ReadonlyMap<string, number>> => {
    const visits = new Map<string, number>();
    for (const siteId of siteIds) {
      const analytics = Option.getOrNull(
        AsyncResult.value(get(sites.analytics({ environmentId, input: { siteId } }))),
      );
      if (analytics) visits.set(siteId, analytics.pageviews);
    }
    return AsyncResult.success(visits);
  });
});

export function SitesPage() {
  const authority = useLibraryAuthority();
  return <SitesContent key={authority.authorityId} authority={authority} />;
}

// Drafts and pending action state belong to one Library, even when both use the same site IDs.
function SitesContent({ authority }: { authority: ReturnType<typeof useLibraryAuthority> }) {
  const search = useSearch({ from: "/sites" });
  const navigate = useNavigate();
  const environmentId = authority.authorityId;
  const capabilities = authority.environment?.serverConfig?.environment.capabilities;
  const gate = sitesGate({
    chosen: Boolean(environmentId),
    connected: authority.connected,
    capabilities,
  });
  const supported = gate === null;
  const manages = supportsLoomFeature(capabilities, SITES_MANAGEMENT_FEATURE);
  const projects = useLibraryProjects(true);
  const allowed = useLibraryPermission(sites.saveSite, environmentId);
  // An expired or unchecked session also turns saving off, and the page frame already says how to
  // repair it, so owner advice would contradict it.
  const access = useLibraryAccessBlock(environmentId, []);
  // A local editor remembers the page it opened on, so going Back from there leaves it behind.
  const [editing, setEditing] = useState<{
    readonly target: SiteEditTarget;
    readonly at: string | undefined;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filters, setFilters] = useState<SiteFilters>(NO_FILTERS);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  const [preferences, setPreferences] = useLocalStorage(
    PREFERENCES_KEY,
    DEFAULT_PREFERENCES,
    SitesPreferences,
  );
  const runChecks = useAtomCommand(sites.runChecks, { reportFailure: false });
  const query = useEnvironmentQuery(
    environmentId && supported ? sites.snapshot({ environmentId, input: {} }) : null,
  );
  const snapshot = query.data?.snapshot ?? null;
  const now = useSiteCheckClock(snapshot);
  const opened = search.siteId
    ? (snapshot?.sites.find((site) => site.id === search.siteId) ?? null)
    : null;
  const analytics = useEnvironmentQuery(
    environmentId && opened
      ? sites.analytics({ environmentId, input: { siteId: opened.id } })
      : null,
  );
  const managementConfigured = query.data?.managementConfigured === true;
  const canManage = Boolean(manages && managementConfigured && allowed && authority.connected);
  const libraryLabel = authority.environment?.label ?? "your Library server";
  const manageReason = !snapshot
    ? null
    : !authority.connected
      ? `Reconnect ${libraryLabel} to make changes.`
      : !manages
        ? `Update ${libraryLabel} to manage sites here.`
        : !managementConfigured
          ? "Site management needs a manager connection on your Library server."
          : !allowed
            ? (access?.message ??
              `Ask an owner of ${libraryLabel} for settings access to change sites.`)
            : null;
  const projectsById = new Map(
    (projects.query.data ?? []).map((project) => [project.id, project] as const),
  );
  // On a site's page the read covers its traffic too, so one control brings the whole page current.
  const refresh = () => {
    query.refresh();
    if (opened) analytics.refresh();
  };
  const updated = snapshot ? (
    <UpdatedButton
      subject={opened?.name ?? "sites"}
      observedAt={snapshot.observedAt || null}
      updating={query.isPending || (opened !== null && analytics.isPending)}
      disabled={!authority.connected || query.isPending}
      onRefresh={refresh}
    />
  ) : null;
  const toggleActive = useSiteActiveToggle({
    environmentId,
    connected: canManage,
    onChanged: query.refresh,
  });

  const routeTarget: SiteEditTarget | null =
    search.edit === "new"
      ? { kind: "site" }
      : search.edit === "site" && opened
        ? { kind: "site", row: opened }
        : null;
  const target = (editing && editing.at === search.siteId ? editing.target : null) ?? routeTarget;
  const openEditor = (next: SiteEditTarget) => setEditing({ target: next, at: search.siteId });
  const clearEditParam = () =>
    void navigate({ to: "/sites", search: { ...search, edit: undefined }, replace: true });
  const closeEditor = () => {
    setEditing(null);
    if (search.edit) clearEditParam();
  };
  const saved = (id: string) => {
    const registered = target?.kind === "site" && !target.row;
    setEditing(null);
    query.refresh();
    if (registered) {
      void navigate({ to: "/sites", search: { siteId: id }, replace: Boolean(search.edit) });
    } else if (search.edit) {
      clearEditParam();
    }
  };
  const editor =
    snapshot && environmentId && target ? (
      <SiteEditor
        key={`${target.kind}:${target.row?.id ?? "new"}:${target.kind === "site" ? (target.step ?? "") : ""}`}
        target={target}
        snapshot={snapshot}
        environmentId={environmentId}
        connected={canManage}
        blockedReason={manageReason}
        onClose={closeEditor}
        onSaved={saved}
      />
    ) : null;

  const run = async () => {
    if (!environmentId || !canManage || running) return;
    setRunning(true);
    setActionError(null);
    await runChecks({ environmentId, input: {} })
      .then((result) => {
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        query.refresh();
      })
      .catch((cause) => {
        setActionError(cause instanceof Error ? cause.message : "Could not run checks.");
      })
      .finally(() => setRunning(false));
  };

  const notices = (
    <>
      {actionError ? <LibraryErrorNotice error={actionError} /> : null}
      {query.data?.configured && !managementConfigured ? (
        <LibraryNotice icon={WrenchIcon}>
          {manages
            ? "Viewing only. Site management needs a manager connection on your Library server."
            : `Viewing only. Update ${libraryLabel} to manage sites here.`}
        </LibraryNotice>
      ) : query.data?.configured && manages && !allowed && !access ? (
        <LibraryNotice icon={LockIcon}>
          You can view sites. Ask an owner of {libraryLabel} for settings access to change them.
        </LibraryNotice>
      ) : null}
      {snapshot ? <LibraryErrorNotice error={query.error} onRetry={query.refresh} /> : null}
    </>
  );

  // Whatever stands between the page and a snapshot, said where the content belongs. A Library
  // still connecting has no blocker, so the page waits in its loading shape.
  const blocker =
    gate === "choose-library" ? (
      <LibraryEmpty
        icon={GlobeIcon}
        title="Choose your Library first"
        action={
          <Button shape="pill" render={<Link to="/projects" />}>
            Open Projects
          </Button>
        }
      >
        Sites live on your Library server. Pick it in Projects, then come back to watch your sites.
      </LibraryEmpty>
    ) : gate === "offline" ? (
      <LibraryEmpty
        icon={CloudOffIcon}
        title={
          authority.environment
            ? `${authority.environment.label} is offline`
            : "Your Library server is not connected"
        }
      >
        Sites load when it reconnects.
      </LibraryEmpty>
    ) : gate === "unsupported" ? (
      <LibraryEmpty icon={CloudOffIcon} title="Sites need a newer Library server">
        Update {libraryLabel} to watch your sites here.
      </LibraryEmpty>
    ) : query.data?.configured === false ? (
      <NotConfigured label={libraryLabel} pending={query.isPending} onCheck={query.refresh} />
    ) : !snapshot && query.error ? (
      <LibraryEmpty
        icon={CircleAlertIcon}
        title="Sites could not load"
        action={
          <Button shape="pill" variant="outline" disabled={query.isPending} onClick={query.refresh}>
            <RefreshCwIcon />
            Try again
          </Button>
        }
      >
        {query.error}
      </LibraryEmpty>
    ) : null;

  if (search.siteId) {
    if (opened && snapshot) {
      return (
        <LibraryPageFrame
          title={opened.name}
          section={{ label: "Sites", to: "/sites" }}
          offlineNotice={OFFLINE_NOTICE}
          style={projectColorStyle(siteColor(opened, projectsById))}
          width={SITE_PAGE_WIDTH}
        >
          {notices}
          <SiteDetail
            key={opened.id}
            site={opened}
            snapshot={snapshot}
            now={now}
            projects={projectsById}
            analytics={analytics}
            canManage={canManage}
            running={running}
            onRunChecks={() => void run()}
            onEdit={openEditor}
            manageHint={manageReason}
            activeToggle={toggleActive}
            refresh={updated}
          />
          {editor}
        </LibraryPageFrame>
      );
    }
    // A link to one site waits in that site's shape and never flashes the index on the way. A
    // site just registered is missing until the refresh after its save lands, so a read still in
    // flight waits too rather than calling it gone.
    const missing = snapshot !== null && !query.isPending;
    return (
      <LibraryPageFrame
        title={missing ? "Not found" : "Site"}
        section={{ label: "Sites", to: "/sites" }}
        offlineNotice={OFFLINE_NOTICE}
        style={projectColorStyle(SITES_COLOR)}
        width={SITE_PAGE_WIDTH}
      >
        {blocker ??
          (missing ? (
            <LibraryEmpty
              icon={GlobeIcon}
              title="This site is no longer registered"
              action={
                <Button shape="pill" variant="outline" render={<Link to="/sites" />}>
                  Back to Sites
                </Button>
              }
            >
              It may have been removed or renamed in another session. Every registered site is on
              the Sites page.
            </LibraryEmpty>
          ) : (
            <SiteDetailSkeleton />
          ))}
      </LibraryPageFrame>
    );
  }

  const view: SitesView = search.view ?? "sites";
  const showView = (next: SitesView) =>
    void navigate({
      to: "/sites",
      search: { view: next === "services" ? "services" : undefined },
      replace: true,
    });
  const attention = snapshot ? sitesAttention(snapshot, now) : [];
  const status = snapshot ? sitesStatus(snapshot, now) : null;
  const services = snapshot ? filterServices(snapshot, now, serviceFilter) : null;
  const servicesFailing = services?.counts.failing ?? 0;
  const registerSite = () => openEditor({ kind: "site" });
  const registerService = () => openEditor({ kind: "service" });

  return (
    <LibraryPageFrame
      section={{ label: "Sites", to: "/sites" }}
      offlineNotice={OFFLINE_NOTICE}
      style={projectColorStyle(SITES_COLOR)}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-3 gap-y-4">
        <div className="min-w-0 space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          <div className="flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
            {snapshot && status ? (
              <>
                <LibraryStateBadge tone={status.tone}>{status.label}</LibraryStateBadge>
                <span>
                  {plural(snapshot.sites.length, "site")} · {plural(status.watched, "check")} on{" "}
                  {plural(snapshot.services.length, "service")}
                </span>
                {snapshot.checks.length ? (
                  <TickStrip
                    label={`${status.passing} of ${status.watched} checks passing`}
                    ticks={orderChecksForAttention(snapshot.checks, snapshot.staleAfterSeconds, now)
                      .slice(0, MAX_HEADER_TICKS)
                      .map((check) => ({
                        key: check.id,
                        tone: SITE_CHECK_STATES[
                          siteCheckState(check, snapshot.staleAfterSeconds, now)
                        ].tone,
                      }))}
                  />
                ) : null}
                {updated}
              </>
            ) : (
              "Your websites, whether they are up, and the visits they receive."
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionHint hint={manageReason}>
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={!canManage || !snapshot || running}
              onClick={() => void run()}
            >
              <PlayIcon />
              {running ? "Running checks…" : "Run all checks"}
            </Button>
          </ActionHint>
          <ActionHint hint={manageReason}>
            <Button
              shape="pill"
              size="sm"
              disabled={!canManage || !snapshot}
              onClick={registerSite}
            >
              <PlusIcon />
              Register site
            </Button>
          </ActionHint>
        </div>
      </header>

      {notices}

      {blocker ??
        (!snapshot || !environmentId ? (
          <SitesSkeleton view={preferences.view} />
        ) : (
          <>
            <AttentionStrip items={attention} />
            <LibraryTabs
              label="Sites views"
              selected={view}
              onSelect={showView}
              tabs={[
                { value: "sites", label: "Sites", icon: GlobeIcon, count: snapshot.sites.length },
                {
                  value: "services",
                  label: "Services",
                  icon: ServerIcon,
                  count: servicesFailing || snapshot.services.length,
                  urgent: servicesFailing > 0,
                },
              ]}
              actions={
                view === "services" ? (
                  snapshot.services.length ? (
                    <>
                      <ToggleGroup
                        shape="pill"
                        variant="segmented"
                        aria-label="Which services"
                        value={[serviceFilter]}
                        onValueChange={(value) => {
                          const next = SERVICE_FILTERS.find((entry) => entry === value[0]);
                          if (next) setServiceFilter(next);
                        }}
                      >
                        {SERVICE_FILTERS.map((entry) => (
                          <ToggleGroupItem key={entry} value={entry}>
                            {SERVICE_FILTER_LABELS[entry]}
                            <span className="tabular-nums opacity-60">
                              {services?.counts[entry] ?? 0}
                            </span>
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <ActionHint hint={manageReason}>
                        <Button
                          shape="pill"
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={registerService}
                        >
                          <PlusIcon />
                          Register service
                        </Button>
                      </ActionHint>
                    </>
                  ) : null
                ) : snapshot.sites.length ? (
                  <SitesControls
                    snapshot={snapshot}
                    now={now}
                    projects={projectsById}
                    filters={filters}
                    preferences={preferences}
                    onFilters={setFilters}
                    onPreferences={setPreferences}
                  />
                ) : null
              }
            >
              {view === "services" ? (
                <ServicesView
                  snapshot={snapshot}
                  services={services?.services ?? []}
                  filter={serviceFilter}
                  now={now}
                  canManage={canManage}
                  manageReason={manageReason}
                  activeToggle={toggleActive}
                  onFilter={setServiceFilter}
                  onEdit={openEditor}
                  onRegister={registerService}
                />
              ) : (
                <SitesCollection
                  environmentId={environmentId}
                  snapshot={snapshot}
                  now={now}
                  projects={projectsById}
                  filters={filters}
                  preferences={preferences}
                  canManage={canManage}
                  manageReason={manageReason}
                  pending={toggleActive.pending}
                  onClearFilters={() => setFilters(NO_FILTERS)}
                  onEdit={openEditor}
                  onToggleActive={(site) => toggleActive.toggle({ kind: "site", row: site })}
                  onRegister={registerSite}
                />
              )}
            </LibraryTabs>
          </>
        ))}
      {editor}
    </LibraryPageFrame>
  );
}

/** The last read's age as the way to read again, so the page carries one refresh control. */
function UpdatedButton({
  subject,
  observedAt,
  updating,
  disabled,
  onRefresh,
}: {
  /** What a refresh reads again, for its accessible name. */
  readonly subject: string;
  readonly observedAt: string | null;
  readonly updating: boolean;
  readonly disabled: boolean;
  readonly onRefresh: () => void;
}) {
  const relative = useRelativeTimeState(observedAt);
  const age =
    relative.status === "relative"
      ? relative.suffix
        ? `${relative.value} ${relative.suffix}`
        : relative.value
      : null;
  return (
    <Button
      shape="pill"
      size="xs"
      variant="ghost"
      disabled={disabled}
      onClick={onRefresh}
      aria-label={age ? `Refresh ${subject}, updated ${age}` : `Refresh ${subject}`}
    >
      <RefreshCwIcon />
      {updating ? "Updating…" : age ? `Updated ${age}` : "Refresh"}
    </Button>
  );
}

function NotConfigured({
  label,
  pending,
  onCheck,
}: {
  readonly label: string;
  readonly pending: boolean;
  readonly onCheck: () => void;
}) {
  return (
    <LibraryEmpty
      icon={PlugZapIcon}
      title="Connect the personal API"
      action={
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button shape="pill" variant="outline" disabled={pending} onClick={onCheck}>
            <RefreshCwIcon />
            Check again
          </Button>
          <Button
            shape="pill"
            variant="ghost"
            render={<a href={CATALOG_URL} target="_blank" rel="noreferrer" />}
          >
            Explore the personal API catalog
            <ArrowUpRightIcon />
          </Button>
        </div>
      }
    >
      Sites reads your sites, checks and traffic through the personal API. Whoever runs {label}{" "}
      connects it on the server; once that is done, check again here.
    </LibraryEmpty>
  );
}

function AttentionStrip({ items }: { readonly items: readonly SitesAttentionItem[] }) {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_ATTENTION_ITEMS);
  const rest = items.slice(MAX_ATTENTION_ITEMS);
  return (
    <LibraryNotice
      icon={CircleAlertIcon}
      tone={items.some((item) => item.tone === "danger") ? "danger" : "warning"}
      action={
        rest.length ? (
          <Menu>
            <MenuTrigger render={<Button shape="pill" size="xs" variant="ghost" />}>
              +{rest.length} more
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              {rest.map((item) => (
                <MenuItem key={item.key} render={<Link to="/sites" search={item.search} />}>
                  <LibraryStateDot tone={item.tone} />
                  <span className="font-medium">{item.title}</span>
                  <span className="text-muted-foreground">{item.detail}</span>
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null
      }
    >
      <ul aria-label="Needs attention" className="flex min-w-0 flex-wrap gap-x-5 gap-y-1">
        {shown.map((item) => (
          <li key={item.key} className="min-w-0 max-w-full">
            <Link
              to="/sites"
              search={item.search}
              className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <LibraryStateDot tone={item.tone} />
              <span className="shrink-0 font-medium text-foreground">{item.title}</span>
              <span className="min-w-0 truncate text-muted-foreground">{item.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </LibraryNotice>
  );
}

function SitesControls({
  snapshot,
  now,
  projects,
  filters,
  preferences,
  onFilters,
  onPreferences,
}: {
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly filters: SiteFilters;
  readonly preferences: SitesPreferences;
  readonly onFilters: (filters: SiteFilters) => void;
  readonly onPreferences: (preferences: SitesPreferences) => void;
}) {
  const toggleIn = <T,>(values: ReadonlySet<T>, value: T) => {
    const next = new Set(values);
    if (!next.delete(value)) next.add(value);
    return next;
  };
  const toggleState = (state: SiteHealthState) =>
    onFilters({ ...filters, states: toggleIn(filters.states, state) });
  const toggleProject = (projectId: string) =>
    onFilters({ ...filters, projects: toggleIn(filters.projects, projectId) });
  const projectLabel = (projectId: string) =>
    projectId === UNLINKED_PROJECT
      ? "Not linked"
      : (projects.get(projectId)?.title ?? "Unavailable project");
  return (
    <>
      {snapshot.sites.length > SEARCH_THRESHOLD || filters.query ? (
        <LibrarySearch
          value={filters.query}
          onChange={(query) => onFilters({ ...filters, query })}
          placeholder="Search names, addresses, projects"
          label="Search sites"
        />
      ) : null}
      <FilterMenu
        snapshot={snapshot}
        now={now}
        projects={projects}
        filters={filters}
        onToggleState={toggleState}
        onToggleProject={toggleProject}
      />
      {[...filters.states].map((state) => (
        <LibraryFilterChip
          key={state}
          label={SITE_HEALTH_STATES[state].label}
          removeLabel={`Stop showing only ${SITE_HEALTH_STATES[state].label.toLowerCase()} sites`}
          marker={<LibraryStateDot tone={SITE_HEALTH_STATES[state].tone} />}
          onRemove={() => toggleState(state)}
        />
      ))}
      {[...filters.projects].map((projectId) => {
        const project = projects.get(projectId);
        return (
          <LibraryFilterChip
            key={projectId}
            label={projectLabel(projectId)}
            removeLabel={`Stop showing only sites for ${projectLabel(projectId)}`}
            marker={project ? <ProjectColorDot color={libraryProjectColor(project)} /> : undefined}
            onRemove={() => toggleProject(projectId)}
          />
        );
      })}
      <DisplayMenu preferences={preferences} onChange={onPreferences} />
      <LibraryLayoutToggle
        value={preferences.view}
        onChange={(view) => onPreferences({ ...preferences, view })}
      />
    </>
  );
}

function FilterMenu({
  snapshot,
  now,
  projects,
  filters,
  onToggleState,
  onToggleProject,
}: {
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly filters: SiteFilters;
  readonly onToggleState: (state: SiteHealthState) => void;
  readonly onToggleProject: (projectId: string) => void;
}) {
  const stateCounts = new Map<SiteHealthState, number>();
  const projectCounts = new Map<string, number>();
  for (const site of snapshot.sites) {
    const state = siteHealth(site, snapshot, now).state;
    stateCounts.set(state, (stateCounts.get(state) ?? 0) + 1);
    const served = site.projectIds ?? [];
    for (const projectId of served.length ? served : [UNLINKED_PROJECT]) {
      projectCounts.set(projectId, (projectCounts.get(projectId) ?? 0) + 1);
    }
  }
  const states = HEALTH_ORDER.filter(
    (state) => stateCounts.has(state) || filters.states.has(state),
  );
  const projectIds = [...projectCounts.keys()]
    .filter((projectId) => projectId === UNLINKED_PROJECT || projects.has(projectId))
    .toSorted((a, b) =>
      a === UNLINKED_PROJECT
        ? 1
        : b === UNLINKED_PROJECT
          ? -1
          : (projects.get(a)?.title ?? "").localeCompare(projects.get(b)?.title ?? ""),
    );
  const active = filters.states.size + filters.projects.size;
  if (states.length < 2 && projectIds.length < 2 && !active) return null;
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="outline" />}>
        <ListFilterIcon />
        Filters
        {active ? (
          <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
            {active}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup side="bottom" align="start">
        <MenuGroup>
          <MenuGroupLabel>State</MenuGroupLabel>
          {states.map((state) => (
            <MenuCheckboxItem
              key={state}
              checked={filters.states.has(state)}
              onCheckedChange={() => onToggleState(state)}
            >
              <span className="flex w-full items-center gap-2">
                <LibraryStateDot tone={SITE_HEALTH_STATES[state].tone} />
                <span className="flex-1">{SITE_HEALTH_STATES[state].label}</span>
                <span className="ps-4 text-xs tabular-nums text-muted-foreground">
                  {stateCounts.get(state) ?? 0}
                </span>
              </span>
            </MenuCheckboxItem>
          ))}
        </MenuGroup>
        {projectIds.length > 1 || filters.projects.size ? (
          <>
            <MenuSeparator />
            <MenuGroup>
              <MenuGroupLabel>Serves</MenuGroupLabel>
              {projectIds.map((projectId) => {
                const project = projects.get(projectId);
                return (
                  <MenuCheckboxItem
                    key={projectId}
                    checked={filters.projects.has(projectId)}
                    onCheckedChange={() => onToggleProject(projectId)}
                  >
                    <span className="flex w-full items-center gap-2">
                      {project ? (
                        <ProjectColorDot color={libraryProjectColor(project)} />
                      ) : (
                        <LibraryStateDot tone="neutral" />
                      )}
                      <span className="flex-1 truncate">
                        {project?.title ?? "Not linked to a project"}
                      </span>
                      <span className="ps-4 text-xs tabular-nums text-muted-foreground">
                        {projectCounts.get(projectId) ?? 0}
                      </span>
                    </span>
                  </MenuCheckboxItem>
                );
              })}
            </MenuGroup>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function DisplayMenu({
  preferences,
  onChange,
}: {
  readonly preferences: SitesPreferences;
  readonly onChange: (preferences: SitesPreferences) => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button shape="pill" size="sm" variant="ghost" />}>
        <SlidersHorizontalIcon />
        Display
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuGroup>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioGroup
            value={preferences.sort}
            onValueChange={(value) => {
              const sort = SITE_SORTS.find((entry) => entry === value);
              if (sort) onChange({ ...preferences, sort });
            }}
          >
            {SITE_SORTS.map((sort) => (
              <MenuRadioItem key={sort} value={sort}>
                {SORT_LABELS[sort]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuSeparator />
        <MenuCheckboxItem
          checked={preferences.previews}
          onCheckedChange={(previews) => onChange({ ...preferences, previews })}
        >
          <span className="flex max-w-60 flex-col gap-0.5">
            <span>Live previews</span>
            <span className="text-xs text-muted-foreground">
              Cards load each site&apos;s front page, a few at a time. Each load counts as a visit.
            </span>
          </span>
        </MenuCheckboxItem>
      </MenuPopup>
    </Menu>
  );
}

type CollectionProps = {
  readonly environmentId: EnvironmentId;
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly canManage: boolean;
  readonly manageReason: string | null;
  /** The `kind:id` of each entry being paused or resumed. */
  readonly pending: ReadonlySet<string>;
  readonly onEdit: (target: SiteEditTarget) => void;
  readonly onToggleActive: (site: Site) => void;
};

function SitesCollection({
  filters,
  preferences,
  onClearFilters,
  onRegister,
  ...props
}: CollectionProps & {
  readonly filters: SiteFilters;
  readonly preferences: SitesPreferences;
  readonly onClearFilters: () => void;
  readonly onRegister: () => void;
}) {
  const { environmentId, snapshot, now, projects } = props;
  const visits = useEnvironmentQuery(
    preferences.sort === "visits" && snapshot.sites.length
      ? siteVisitsAtom([environmentId, ...snapshot.sites.map((site) => site.id)].join("\n"))
      : null,
  ).data;
  if (!snapshot.sites.length) {
    return (
      <LibraryEmpty
        icon={GlobeIcon}
        title="Register your first site"
        action={
          <ActionHint hint={props.manageReason}>
            <Button shape="pill" disabled={!props.canManage} onClick={onRegister}>
              <PlusIcon />
              Register a site
            </Button>
          </ActionHint>
        }
      >
        Link a site to the projects it serves. Loom watches its endpoints and counts its visits, so
        you know it is up without opening it.
      </LibraryEmpty>
    );
  }
  const shown = sortSites(
    filterSites(snapshot, now, filters, projects),
    snapshot,
    now,
    preferences.sort,
    visits,
  );
  if (!shown.length) {
    return (
      <div className="rounded-xl border border-dashed border-border">
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>No sites match</EmptyTitle>
            <EmptyDescription>
              Search looks at names, addresses, IDs and the projects each site serves.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button shape="pill" size="sm" variant="outline" onClick={onClearFilters}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return preferences.view === "list" ? (
    <SiteRows sites={shown} {...props} />
  ) : (
    <ul aria-label="Sites" className={LIBRARY_CARD_GRID}>
      {shown.map((site) => (
        <SiteCard key={site.id} site={site} previews={preferences.previews} {...props} />
      ))}
    </ul>
  );
}

function SiteCard({
  site,
  previews,
  ...props
}: CollectionProps & { readonly site: Site; readonly previews: boolean }) {
  const { environmentId, snapshot, now, projects } = props;
  const health = siteHealth(site, snapshot, now);
  const checks = siteChecks(site, snapshot);
  const certificate = checkVitals(checks, now).certificate;
  return (
    <li
      style={projectColorStyle(siteColor(site, projects))}
      className={cn(LIBRARY_CARD, "gap-0 overflow-hidden p-0")}
    >
      <ProjectWash />
      <LibraryCardTarget label={`Open ${site.name}`} to="/sites" search={{ siteId: site.id }} />
      <SiteThumbnail site={site} live={previews} />
      {/* Content lets clicks fall through to the card's own target; only the menu takes them. */}
      <div className="pointer-events-none flex min-w-0 flex-1 flex-col gap-2.5 p-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <h3 className="flex min-w-0 items-baseline gap-1.5 text-sm leading-5 font-semibold tracking-tight">
              <span className="truncate">{site.name}</span>
              {site.id === snapshot.primarySiteId ? (
                <span className="shrink-0 text-2xs font-normal text-muted-foreground">Primary</span>
              ) : null}
            </h3>
            <p className="truncate font-mono text-2xs text-muted-foreground">
              {siteHost(site.url)}
            </p>
          </div>
          <div className="pointer-events-auto relative">
            <SiteMenu site={site} {...props} />
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <SiteState state={health.state} />
          <ServedProjects site={site} projects={projects} max={MAX_CARD_PROJECTS} inline />
        </div>
        {/* Wraps instead of shrinking: on a narrow card the traffic drops to its own line rather
            than painting over the checks. */}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/70 pt-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CheckTicks checks={checks} staleAfterSeconds={snapshot.staleAfterSeconds} now={now} />
            <CertificateWarning days={site.active ? certificate : null} />
          </div>
          <SiteVisits environmentId={environmentId} siteId={site.id} />
        </div>
      </div>
    </li>
  );
}

/** Color only for news: a failing or stale site gets the filled pill, everything else stays quiet. */
function SiteState({ state }: { readonly state: SiteHealthState }) {
  const presentation = SITE_HEALTH_STATES[state];
  if (state === "failing" || state === "stale" || state === "paused") {
    return <LibraryStateBadge tone={presentation.tone}>{presentation.label}</LibraryStateBadge>;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <LibraryStateDot tone={presentation.tone} />
      {presentation.label}
    </span>
  );
}

function CertificateWarning({ days }: { readonly days: number | null }) {
  if (days === null || days > SITE_TLS_WARNING_DAYS) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
      <LibraryStateDot tone={days < 0 ? "danger" : "warning"} />
      {days < 0 ? "Certificate expired" : `Certificate ${days}d`}
    </span>
  );
}

function ServedProjects({
  site,
  projects,
  max,
  inline = false,
}: {
  readonly site: Site;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly max: number;
  /** Set where the projects follow other text on a line, rather than under a Serves heading. */
  readonly inline?: boolean;
}) {
  const served = site.projectIds ?? [];
  const lead = inline ? <span aria-hidden>·</span> : null;
  if (!served.length) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground/75">
        {lead}
        Not linked
      </span>
    );
  }
  const known = served.flatMap((projectId) => {
    const project = projects.get(projectId);
    return project ? [project] : [];
  });
  const shown = known.slice(0, max);
  const more = served.length - shown.length;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {lead}
      {inline ? <span className="shrink-0">Serves</span> : null}
      {shown.map((project) => (
        <span key={project.id} className="inline-flex min-w-0 items-center gap-1">
          <ProjectColorDot color={libraryProjectColor(project)} />
          <span className="truncate text-foreground/80">{project.title}</span>
        </span>
      ))}
      {more ? (
        <span className="shrink-0 tabular-nums">
          {shown.length ? `+${more}` : plural(more, "project")}
        </span>
      ) : null}
    </span>
  );
}

/**
 * A site's page views over the analytics window. The read waits until the card or row is on
 * screen, so a long list does not ask for every site's traffic at once.
 */
function SiteVisits({
  environmentId,
  siteId,
}: {
  readonly environmentId: EnvironmentId;
  readonly siteId: string;
}) {
  const [ref, seen] = useSeen();
  const analytics = useEnvironmentQuery(
    seen ? sites.analytics({ environmentId, input: { siteId } }) : null,
  );
  const data = analytics.data;
  return (
    <span ref={ref} className="ms-auto flex shrink-0 items-center justify-end gap-2">
      {data ? (
        <>
          <Sparkline
            values={siteTrafficDays(data).map((day) => day.pageviews)}
            label={`${formatCount(data.pageviews)} page views over the last ${data.days} days`}
          />
          <span className="text-xs font-medium tabular-nums">{formatCount(data.pageviews)}</span>
          <span className="text-2xs tabular-nums text-muted-foreground">{data.days}d</span>
        </>
      ) : analytics.error ? (
        <span className="text-xs text-muted-foreground">No traffic data</span>
      ) : (
        <Skeleton className="h-5 w-28" />
      )}
    </span>
  );
}

function SiteMenu({
  site,
  canManage,
  manageReason,
  pending,
  onEdit,
  onToggleActive,
}: CollectionProps & { readonly site: Site }) {
  const pausing = pending.has(`site:${site.id}`);
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Actions for ${site.name}`}
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup side="bottom" align="end">
        <MenuItem render={<Link to="/sites" search={{ siteId: site.id }} />}>
          <GlobeIcon />
          Open
        </MenuItem>
        <MenuItem render={<Link to="/sites" search={{ siteId: site.id, tab: "preview" }} />}>
          <AppWindowIcon />
          Preview
        </MenuItem>
        <MenuItem render={<a href={site.url} target="_blank" rel="noreferrer" />}>
          <ExternalLinkIcon />
          Visit site
        </MenuItem>
        <MenuItem onClick={() => void copyAddress(site.url)}>
          <CopyIcon />
          Copy address
        </MenuItem>
        <MenuSeparator />
        <MenuItem disabled={!canManage} onClick={() => onEdit({ kind: "site", row: site })}>
          <PencilIcon />
          Edit site
        </MenuItem>
        <MenuItem disabled={!canManage || pausing} onClick={() => onToggleActive(site)}>
          {site.active ? <PauseIcon /> : <PlayIcon />}
          {pausing ? "Saving…" : site.active ? "Pause monitoring" : "Resume monitoring"}
        </MenuItem>
        <MenuBlockedNote hint={canManage ? null : manageReason} />
      </MenuPopup>
    </Menu>
  );
}

async function copyAddress(url: string) {
  try {
    await writeTextToClipboard(url, "address");
    toastManager.add({ type: "success", title: "Address copied" });
  } catch {
    toastManager.add({
      type: "warning",
      title: "This host blocks copying",
      description: `Copy it by hand: ${url}`,
    });
  }
}

const SITE_COLUMNS = [
  { key: "site", label: "Site" },
  { key: "state", label: "State", className: "w-32" },
  { key: "checks", label: "Checks", className: "hidden w-32 sm:table-cell" },
  { key: "serves", label: "Serves", className: "hidden w-44 lg:table-cell" },
  { key: "traffic", label: "Page views", className: "hidden w-48 md:table-cell", align: "end" },
  { key: "actions", label: "Actions", hideLabel: true, className: "w-10" },
] as const;

function SiteRows({
  sites: list,
  ...props
}: CollectionProps & { readonly sites: readonly Site[] }) {
  const { environmentId, snapshot, now, projects } = props;
  return (
    <LibraryTable label="Registered sites" columns={SITE_COLUMNS}>
      {list.map((site) => {
        const checks = siteChecks(site, snapshot);
        const certificate = checkVitals(checks, now).certificate;
        return (
          <tr
            key={site.id}
            style={projectColorStyle(siteColor(site, projects))}
            className={LIBRARY_TABLE_ROW}
          >
            <td className={LIBRARY_CELL}>
              <div className="flex min-w-0 items-center gap-3">
                <SiteMark url={site.url} />
                <div className="min-w-0">
                  <Link
                    to="/sites"
                    search={{ siteId: site.id }}
                    className={cn(LIBRARY_ROW_TARGET, "block max-w-full truncate font-medium")}
                  >
                    {site.name}
                  </Link>
                  <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate font-mono">{siteHost(site.url)}</span>
                    <CertificateWarning days={site.active ? certificate : null} />
                  </p>
                </div>
              </div>
            </td>
            <td className={cn(LIBRARY_CELL, "text-xs text-muted-foreground")}>
              <SiteState state={siteHealth(site, snapshot, now).state} />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
              <CheckTicks
                checks={checks}
                staleAfterSeconds={snapshot.staleAfterSeconds}
                now={now}
              />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden text-xs text-muted-foreground lg:table-cell")}>
              <ServedProjects site={site} projects={projects} max={MAX_ROW_PROJECTS} />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden md:table-cell")}>
              <SiteVisits environmentId={environmentId} siteId={site.id} />
            </td>
            <td className={cn(LIBRARY_CELL, "relative py-1.5 text-end")}>
              <SiteMenu site={site} {...props} />
            </td>
          </tr>
        );
      })}
    </LibraryTable>
  );
}

/** Every service, read apart from the sites that use it, since one service can back several. */
function ServicesView({
  snapshot,
  services,
  filter,
  now,
  canManage,
  manageReason,
  activeToggle,
  onFilter,
  onEdit,
  onRegister,
}: {
  readonly snapshot: SitesSnapshot;
  readonly services: readonly Service[];
  readonly filter: ServiceFilter;
  readonly now: number;
  readonly canManage: boolean;
  readonly manageReason: string | null;
  readonly activeToggle: ActiveToggle;
  readonly onFilter: (filter: ServiceFilter) => void;
  readonly onEdit: (target: SiteEditTarget) => void;
  readonly onRegister: () => void;
}) {
  const navigate = useNavigate();
  if (!snapshot.services.length) {
    return (
      <LibraryEmpty
        icon={ServerIcon}
        title="No services yet"
        action={
          <ActionHint hint={manageReason}>
            <Button shape="pill" disabled={!canManage} onClick={onRegister}>
              <PlusIcon />
              Register service
            </Button>
          </ActionHint>
        }
      >
        A service is an address your sites depend on, like the site itself or the API behind it. Add
        checks to a service to know when it stops answering.
      </LibraryEmpty>
    );
  }
  if (!services.length) {
    return (
      <div className="rounded-xl border border-dashed border-border">
        <Empty size="compact">
          <EmptyHeader>
            <EmptyTitle>
              {filter === "failing" ? "Nothing is failing" : "No paused services"}
            </EmptyTitle>
            <EmptyDescription>
              {filter === "failing"
                ? "Every watched service answered as expected on its last check."
                : "Every service is watched. Pause one from its menu to stop its checks."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button shape="pill" size="sm" variant="outline" onClick={() => onFilter("all")}>
              Show all services
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return (
    <EndpointsTable
      label="Services and their checks"
      services={services}
      snapshot={snapshot}
      now={now}
      canManage={canManage}
      manageHint={manageReason}
      activeToggle={activeToggle}
      usedBy={{
        sites: snapshot.sites,
        onOpenSite: (siteId) => void navigate({ to: "/sites", search: { siteId } }),
      }}
      onEditService={(service) => onEdit({ kind: "service", row: service })}
      onAddCheck={(service) => onEdit({ kind: "check", serviceId: service.id })}
      onEditCheck={(check) => onEdit({ kind: "check", row: check })}
    />
  );
}

const SKELETON_KEYS = ["first", "second", "third", "fourth", "fifth", "sixth"] as const;

/** The index's own shape while the first snapshot loads, in the layout last chosen. */
function SitesSkeleton({ view }: { readonly view: "cards" | "list" }) {
  return (
    <div role="status" aria-label="Loading sites" className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <Skeleton shape="pill" className="h-10 w-52" />
        <Skeleton shape="pill" className="h-8 w-40" />
      </div>
      {view === "cards" ? (
        <div className={LIBRARY_CARD_GRID}>
          {SKELETON_KEYS.map((key) => (
            <div key={key} className="overflow-hidden rounded-xl border border-border">
              <Skeleton className="aspect-16/10 w-full" />
              <div className="flex flex-col gap-2.5 p-3.5">
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-2.5 w-1/3" />
                </div>
                <Skeleton className="h-3 w-1/2" />
                <div className="flex items-center justify-between border-t border-border/70 pt-2.5">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-5 w-28" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {SKELETON_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton shape="card" className="size-7" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-40 max-w-full" />
                <Skeleton className="h-2.5 w-28 max-w-full" />
              </div>
              <Skeleton shape="pill" className="h-5 w-16" />
              <Skeleton className="hidden h-5 w-36 md:block" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
