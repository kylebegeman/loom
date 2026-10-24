import { useSiteCheckClock } from "./use-site-check-clock";
import { useMemo, useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  SITE_CHECK_STATES,
  SITE_HEALTH_STATES,
  siteCheckState,
  siteHealth,
  siteTrafficDays,
  supportsLoomFeature,
  type LibraryWorkflowTone,
} from "@t3tools/client-runtime/fork";
import {
  SITES_FEATURE,
  SITES_MANAGEMENT_FEATURE,
  type LibraryProject,
  type SitesSnapshot,
} from "@t3tools/contracts/fork";
import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CloudOffIcon,
  GlobeIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { SiteEditor, type SiteEditTarget } from "./SiteEditor";
import { sites } from "./state";
import { useEnvironmentQuery } from "~/state/query";
import {
  useLibraryAuthority,
  useLibraryProjects,
  useLibraryPermission,
} from "../project-library/state";
import {
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryStateBadge,
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
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { SiteDetail } from "./SiteDetail";
import {
  CertificateLabel,
  CheckTicks,
  EndpointsTable,
  SITES_COLOR,
  SiteTile,
  checkVitals,
  formatDuration,
  siteChecks,
  siteColor,
  siteHost,
} from "./SiteHealth";
import { formatCount } from "./SiteTraffic";

export type SitesView = "sites" | "services";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function SitesPage() {
  const authority = useLibraryAuthority();
  return <SitesContent key={authority.authorityId} authority={authority} />;
}

// Drafts and pending action state belong to one Library, even when both use the same site IDs.
function SitesContent({ authority }: { authority: ReturnType<typeof useLibraryAuthority> }) {
  const search = useSearch({ from: "/sites" });
  const navigate = useNavigate();
  const capabilities = authority.environment?.serverConfig?.environment.capabilities;
  const supported = supportsLoomFeature(capabilities, SITES_FEATURE);
  const manages = supportsLoomFeature(capabilities, SITES_MANAGEMENT_FEATURE);
  const projects = useLibraryProjects(true);
  const allowed = useLibraryPermission(sites.saveSite, authority.authorityId);
  const [editing, setEditing] = useState<SiteEditTarget | null>(null);
  const [running, setRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const runChecks = useAtomCommand(sites.runChecks, { reportFailure: false });
  const query = useEnvironmentQuery(
    authority.authorityId && supported
      ? sites.snapshot({ environmentId: authority.authorityId, input: {} })
      : null,
  );
  const snapshot = query.data?.snapshot;
  const now = useSiteCheckClock(snapshot);
  // A link to a site that has since been removed lands on the index rather than an empty page.
  const opened = search.siteId ? snapshot?.sites.find((site) => site.id === search.siteId) : null;
  const analytics = useEnvironmentQuery(
    authority.authorityId && supported && opened
      ? sites.analytics({ environmentId: authority.authorityId, input: { siteId: opened.id } })
      : null,
  );
  const canManage = Boolean(
    manages && query.data?.managementConfigured && allowed && authority.connected,
  );
  const projectsById = useMemo(
    () => new Map((projects.query.data ?? []).map((project) => [project.id, project])),
    [projects.query.data],
  );
  const view: SitesView = search.view ?? "sites";
  const openSite = (siteId: string) => void navigate({ to: "/sites", search: { siteId } });
  const showView = (next: SitesView) =>
    void navigate({
      to: "/sites",
      search: { view: next === "services" ? "services" : undefined },
      replace: true,
    });
  const refresh = () => {
    query.refresh();
    analytics.refresh();
  };
  const run = async () => {
    if (!authority.authorityId || !canManage || running) return;
    setRunning(true);
    setActionError(null);
    try {
      const result = await runChecks({ environmentId: authority.authorityId, input: {} });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not run checks.");
    } finally {
      setRunning(false);
    }
  };
  const notices = (
    <>
      {actionError ? <LibraryErrorNotice error={actionError} /> : null}
      {authority.authorityId &&
      supported &&
      query.data?.configured &&
      !query.data.managementConfigured ? (
        <LibraryNotice icon={WrenchIcon}>
          {manages
            ? "Viewing only. Site management needs a manager connection on your Library server."
            : "Viewing only. Update your Library server to manage sites here."}
        </LibraryNotice>
      ) : null}
      <LibraryErrorNotice error={query.error} onRetry={query.refresh} />
    </>
  );
  const editor =
    snapshot && authority.authorityId && editing ? (
      <SiteEditor
        key={`${editing.kind}:${editing.row?.id ?? "new"}`}
        target={editing}
        snapshot={snapshot}
        environmentId={authority.authorityId}
        connected={canManage}
        onClose={() => setEditing(null)}
        onSaved={(id) => {
          if (editing.kind === "site" && !editing.row) openSite(id);
          setEditing(null);
          refresh();
        }}
      />
    ) : null;

  if (opened && snapshot) {
    return (
      <LibraryPageFrame
        title={opened.name}
        section={{ label: "Sites", to: "/sites" }}
        offlineNotice="Saved check results and traffic below may be out of date."
        style={projectColorStyle(siteColor(opened, projectsById))}
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
          onEdit={setEditing}
        />
        {editor}
      </LibraryPageFrame>
    );
  }

  return (
    <LibraryPageFrame
      section={{ label: "Sites", to: "/sites" }}
      offlineNotice="Saved check results and traffic below may be out of date."
      style={projectColorStyle(SITES_COLOR)}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h1 className="text-xl font-semibold tracking-tight">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Your websites, whether they are up, and the visits they receive.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            shape="pill"
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh sites"
            onClick={refresh}
            disabled={!authority.connected || !supported || query.isPending}
          >
            <RefreshCwIcon />
          </Button>
          <Button
            shape="pill"
            size="sm"
            variant="outline"
            disabled={!canManage || !snapshot || running}
            onClick={() => void run()}
          >
            <PlayIcon />
            {running ? "Running checks…" : "Run checks now"}
          </Button>
          <Button
            shape="pill"
            size="sm"
            disabled={!canManage || !snapshot}
            onClick={() => setEditing({ kind: "site" })}
          >
            <PlusIcon />
            Register site
          </Button>
        </div>
      </header>

      {notices}

      {!authority.authorityId ? (
        <LibraryEmpty
          icon={GlobeIcon}
          title="Choose your Library first"
          action={
            <Button shape="pill" render={<Link to="/projects" />}>
              Open Projects
            </Button>
          }
        >
          Sites live on your Library server. Pick it in Projects, then come back to watch your
          sites.
        </LibraryEmpty>
      ) : !supported ? (
        <LibraryEmpty icon={CloudOffIcon} title="Sites need a newer Library server">
          Update {authority.environment?.label ?? "your Library server"} to watch your sites here.
        </LibraryEmpty>
      ) : query.data?.configured === false ? (
        <LibraryEmpty icon={CloudOffIcon} title="Connect the personal API">
          Connect the personal API to {authority.environment?.label ?? "your Library server"} to see
          your sites, their checks and their traffic.
        </LibraryEmpty>
      ) : !snapshot ? (
        query.isPending ? (
          <SitesSkeleton />
        ) : null
      ) : (
        <>
          <SitesStatus snapshot={snapshot} now={now} onOpenSite={openSite} />
          <LibraryTabs
            label="Sites views"
            variant="underline"
            selected={view}
            onSelect={showView}
            tabs={[
              { value: "sites", label: "Sites", icon: GlobeIcon, count: snapshot.sites.length },
              {
                value: "services",
                label: "Services",
                icon: ServerIcon,
                count: snapshot.services.length,
              },
            ]}
            actions={
              view === "services" && snapshot.services.length ? (
                <Button
                  shape="pill"
                  size="xs"
                  variant="outline"
                  disabled={!canManage}
                  onClick={() => setEditing({ kind: "service" })}
                >
                  <PlusIcon />
                  Register service
                </Button>
              ) : null
            }
          >
            {view === "services" ? (
              <ServicesRegistry
                snapshot={snapshot}
                now={now}
                canManage={canManage}
                onEdit={setEditing}
                onOpenSite={openSite}
              />
            ) : snapshot.sites.length ? (
              <SitesTable
                environmentId={authority.authorityId}
                snapshot={snapshot}
                now={now}
                projects={projectsById}
                onOpenSite={openSite}
              />
            ) : (
              <LibraryEmpty
                icon={GlobeIcon}
                title="Register your first site"
                action={
                  <Button
                    shape="pill"
                    disabled={!canManage}
                    onClick={() => setEditing({ kind: "site" })}
                  >
                    <PlusIcon />
                    Register a site
                  </Button>
                }
              >
                Link a site to the projects it serves. Loom watches its endpoints and counts its
                visits, so you know it is up without opening it.
              </LibraryEmpty>
            )}
          </LibraryTabs>
        </>
      )}

      {editor}
      <p className="text-xs text-muted-foreground">
        Building something new?{" "}
        <a
          className="inline-flex items-center gap-0.5 font-medium text-foreground/80 underline-offset-4 hover:underline"
          href="https://api.begam.in/v1/public/catalog"
          target="_blank"
          rel="noreferrer"
        >
          Explore the personal API catalog
          <ArrowUpRightIcon aria-hidden className="size-3" />
        </a>
      </p>
    </LibraryPageFrame>
  );
}

const STATUS_TONES: Record<
  LibraryWorkflowTone,
  { readonly surface: string; readonly icon: string; readonly glyph: typeof CircleCheckIcon }
> = {
  success: { surface: "bg-success/8", icon: "text-success", glyph: CircleCheckIcon },
  danger: {
    surface: "bg-destructive/8 dark:bg-destructive/12",
    icon: "text-destructive",
    glyph: CircleAlertIcon,
  },
  warning: { surface: "bg-warning/10", icon: "text-warning", glyph: TriangleAlertIcon },
  neutral: {
    surface: "bg-muted/50 dark:bg-accent/40",
    icon: "text-muted-foreground",
    glyph: CircleDashedIcon,
  },
  active: { surface: "bg-(--project-color)/8", icon: "text-(--project-color)", glyph: GlobeIcon },
};

/**
 * The status-page answer first: is everything up? One tinted line says so, names what is not,
 * and shows every check as a tick, so a failure is visible before any row is read.
 */
function SitesStatus({
  snapshot,
  now,
  onOpenSite,
}: {
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly onOpenSite: (siteId: string) => void;
}) {
  const states = snapshot.checks.map((check) => ({
    check,
    state: siteCheckState(check, snapshot.staleAfterSeconds, now),
  }));
  const watched = states.filter(({ state }) => state !== "disabled");
  const failing = watched.filter(({ state }) => state === "failing").length;
  const stale = watched.filter(({ state }) => state === "stale").length;
  const tone: LibraryWorkflowTone = failing
    ? "danger"
    : stale
      ? "warning"
      : watched.length
        ? "success"
        : "neutral";
  const headline = failing
    ? `${plural(failing, "check")} failing`
    : stale
      ? `${plural(stale, "check")} out of date`
      : watched.length
        ? "All systems normal"
        : "Nothing is watched yet";
  const troubled = snapshot.sites.filter((site) => {
    const state = siteHealth(site, snapshot, now).state;
    return state === "failing" || state === "stale";
  });
  const presentation = STATUS_TONES[tone];
  return (
    <section
      aria-label="Status"
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3",
        presentation.surface,
      )}
    >
      <presentation.glyph aria-hidden className={cn("size-5 shrink-0", presentation.icon)} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-semibold">{headline}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {troubled.length ? (
            <>
              Affects
              {troubled.map((site, index) => (
                <span key={site.id}>
                  <button
                    type="button"
                    onClick={() => onOpenSite(site.id)}
                    className="rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    {site.name}
                  </button>
                  {index < troubled.length - 1 ? "," : null}
                </span>
              ))}
            </>
          ) : (
            <span className="tabular-nums">
              {plural(watched.length, "check")} across {plural(snapshot.services.length, "service")}
            </span>
          )}
          {snapshot.observedAt ? (
            <span>· Updated {formatRelativeTimeLabel(snapshot.observedAt)}</span>
          ) : null}
        </p>
      </div>
      {states.length ? (
        <TickStrip
          size="lg"
          label={`${watched.length - failing - stale} of ${watched.length} checks passing`}
          ticks={states.map(({ check, state }) => ({
            key: check.id,
            tone: SITE_CHECK_STATES[state].tone,
          }))}
        />
      ) : null}
    </section>
  );
}

const SITE_COLUMNS = [
  { key: "site", label: "Site" },
  { key: "state", label: "State", className: "w-32" },
  { key: "checks", label: "Checks", className: "hidden w-36 sm:table-cell" },
  { key: "response", label: "Slowest", className: "hidden w-24 lg:table-cell" },
  { key: "certificate", label: "Certificate", className: "hidden w-28 lg:table-cell" },
  { key: "traffic", label: "Page views", className: "hidden w-44 md:table-cell", align: "end" },
] as const;

function SitesTable({
  environmentId,
  snapshot,
  now,
  projects,
  onOpenSite,
}: {
  readonly environmentId: EnvironmentId;
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly onOpenSite: (siteId: string) => void;
}) {
  return (
    <LibraryTable label="Registered sites" columns={SITE_COLUMNS}>
      {snapshot.sites.map((site) => {
        const state = SITE_HEALTH_STATES[siteHealth(site, snapshot, now).state];
        const checks = siteChecks(site, snapshot);
        const vitals = checkVitals(checks, now);
        return (
          <tr
            key={site.id}
            style={projectColorStyle(siteColor(site, projects))}
            className={LIBRARY_TABLE_ROW}
          >
            <td className={LIBRARY_CELL}>
              <div className="flex min-w-0 items-center gap-3">
                <SiteTile />
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenSite(site.id)}
                    className={cn(LIBRARY_ROW_TARGET, "block max-w-full truncate font-medium")}
                  >
                    {site.name}
                  </button>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {siteHost(site.url)}
                  </p>
                </div>
              </div>
            </td>
            <td className={LIBRARY_CELL}>
              <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
            </td>
            <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
              <CheckTicks
                checks={checks}
                staleAfterSeconds={snapshot.staleAfterSeconds}
                now={now}
              />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden text-xs tabular-nums lg:table-cell")}>
              {vitals.slowest === null ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                formatDuration(vitals.slowest)
              )}
            </td>
            <td className={cn(LIBRARY_CELL, "hidden text-xs lg:table-cell")}>
              <CertificateLabel days={vitals.certificate} />
            </td>
            <td className={cn(LIBRARY_CELL, "hidden md:table-cell")}>
              <SiteTrafficCell environmentId={environmentId} siteId={site.id} />
            </td>
          </tr>
        );
      })}
    </LibraryTable>
  );
}

/** Each row reads its own site's traffic; the query is shared with the site's page. */
function SiteTrafficCell({
  environmentId,
  siteId,
}: {
  readonly environmentId: EnvironmentId;
  readonly siteId: string;
}) {
  const analytics = useEnvironmentQuery(sites.analytics({ environmentId, input: { siteId } }));
  const data = analytics.data;
  if (!data) {
    return analytics.isPending ? (
      <Skeleton className="ms-auto h-6 w-36" />
    ) : (
      <p className="text-end text-xs text-muted-foreground">Unavailable</p>
    );
  }
  const days = siteTrafficDays(data);
  return (
    <div className="flex items-center justify-end gap-3">
      <Sparkline
        values={days.map((day) => day.pageviews)}
        label={`Daily page views over the last ${data.days} days`}
      />
      <span className="w-10 text-end text-sm font-medium tabular-nums">
        {formatCount(data.pageviews)}
      </span>
    </div>
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
      <LibraryEmpty
        icon={ServerIcon}
        title="No services yet"
        action={
          <Button shape="pill" disabled={!canManage} onClick={() => onEdit({ kind: "service" })}>
            <PlusIcon />
            Register service
          </Button>
        }
      >
        A service is an origin your sites depend on, like the site itself or the API behind it. Add
        checks to a service to know when it stops answering.
      </LibraryEmpty>
    );
  }
  return (
    <EndpointsTable
      label="Services and their checks"
      services={snapshot.services}
      snapshot={snapshot}
      now={now}
      canManage={canManage}
      usedBy={{ sites: snapshot.sites, onOpenSite }}
      onEditService={(service) => onEdit({ kind: "service", row: service })}
      onAddCheck={(service) => onEdit({ kind: "check", serviceId: service.id })}
      onEditCheck={(check) => onEdit({ kind: "check", row: check })}
    />
  );
}

const SKELETON_ROWS = ["first", "second", "third", "fourth"];

/** The page's own shape while the first snapshot loads, so the layout holds when it arrives. */
function SitesSkeleton() {
  return (
    <div role="status" aria-label="Loading sites" className="flex flex-col gap-5">
      <Skeleton shape="card" className="h-15 w-full" />
      <div className="flex h-10 items-end gap-5 border-b border-border pb-3">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3.5 w-18" />
      </div>
      <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="flex items-center gap-3 px-3 py-2.5">
            <Skeleton shape="card" className="size-7" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-40 max-w-full" />
              <Skeleton className="h-2.5 w-28 max-w-full" />
            </div>
            <Skeleton shape="pill" className="h-5 w-16" />
            <Skeleton className="hidden h-6 w-36 md:block" />
          </div>
        ))}
      </div>
    </div>
  );
}
