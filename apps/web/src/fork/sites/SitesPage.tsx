import { useSiteCheckClock } from "./use-site-check-clock";
import { useMemo, useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
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
import {
  ArrowUpRightIcon,
  CloudOffIcon,
  GlobeIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
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
  LIBRARY_OUTLINE,
  LibraryEmpty,
  LibraryErrorNotice,
  LibraryNotice,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import { LibraryPageFrame } from "../project-library/LibraryPageFrame";
import { LibraryTabs } from "../project-library/LibraryTabs";
import { projectColorStyle } from "../project-library/ProjectIdentity";
import { SiteDetail } from "./SiteDetail";
import { SiteServiceCard, siteHost } from "./SiteHealth";
import { SiteTrafficSkeleton } from "./SiteTraffic";

export type SitesView = "sites" | "services";

/** Sites are about the web, not one project, until a site names the project it serves. */
const SITES_COLOR: LibraryProjectColor = "blue";

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
  const selected = snapshot?.sites.find((site) => site.id === search.siteId) ?? snapshot?.sites[0];
  const analytics = useEnvironmentQuery(
    authority.authorityId && supported && selected
      ? sites.analytics({ environmentId: authority.authorityId, input: { siteId: selected.id } })
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
  const go = (next: { siteId?: string | undefined; view?: SitesView | undefined }) =>
    void navigate({
      to: "/sites",
      search: {
        siteId: next.siteId ?? selected?.id,
        view: (next.view ?? view) === "services" ? "services" : undefined,
      },
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
  return (
    <LibraryPageFrame
      section={{ label: "Sites", to: "/sites" }}
      offlineNotice="Saved check results and traffic below may be out of date."
      style={projectColorStyle(SITES_COLOR)}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-3 gap-y-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
          {snapshot ? (
            <SitesSummaryLine snapshot={snapshot} now={now} />
          ) : (
            <p className="max-w-xl text-xs text-muted-foreground">
              Your websites, whether they are up, and the visits they receive.
            </p>
          )}
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
        <LibraryTabs
          label="Sites views"
          selected={view}
          onSelect={(next) => go({ view: next })}
          tabs={[
            { value: "sites", label: "Sites", icon: GlobeIcon, count: snapshot.sites.length },
            {
              value: "services",
              label: "Services",
              icon: ServerIcon,
              count: snapshot.services.length,
            },
          ]}
        >
          {view === "services" ? (
            <ServicesRegistry
              snapshot={snapshot}
              now={now}
              canManage={canManage}
              onEdit={setEditing}
              onOpenSite={(siteId) => go({ siteId, view: "sites" })}
            />
          ) : selected ? (
            <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
              <SiteRail
                snapshot={snapshot}
                now={now}
                selectedId={selected.id}
                projects={projectsById}
                onSelect={(siteId) => go({ siteId })}
              />
              <div style={projectColorStyle(siteColor(selected, projectsById))} className="min-w-0">
                <SiteDetail
                  key={selected.id}
                  site={selected}
                  snapshot={snapshot}
                  now={now}
                  projects={projectsById}
                  analytics={analytics}
                  canManage={canManage}
                  onEdit={setEditing}
                />
              </div>
            </div>
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
      )}

      {snapshot && authority.authorityId && editing ? (
        <SiteEditor
          key={`${editing.kind}:${editing.row?.id ?? "new"}`}
          target={editing}
          snapshot={snapshot}
          environmentId={authority.authorityId}
          connected={canManage}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            if (editing.kind === "site") go({ siteId: id, view: "sites" });
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
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
    <p className="flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 text-xs tabular-nums text-muted-foreground">
      {[
        plural(snapshot.sites.length, "site"),
        plural(snapshot.services.length, "service"),
        plural(watched, "check"),
      ].join(" · ")}
      {failing ? (
        <LibraryStateBadge tone="danger">{failing} failing</LibraryStateBadge>
      ) : stale ? (
        <LibraryStateBadge tone="warning">{stale} out of date</LibraryStateBadge>
      ) : watched ? (
        <LibraryStateBadge tone="success">All passing</LibraryStateBadge>
      ) : null}
      {snapshot.observedAt ? (
        <span>Updated {formatRelativeTimeLabel(snapshot.observedAt)}</span>
      ) : null}
    </p>
  );
}

function SiteRail({
  snapshot,
  now,
  selectedId,
  projects,
  onSelect,
}: {
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly selectedId: string;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly onSelect: (siteId: string) => void;
}) {
  return (
    <nav aria-label="Registered sites" className="lg:sticky lg:top-4">
      <ul className="flex flex-col gap-1">
        {snapshot.sites.map((site) => {
          const health = SITE_HEALTH_STATES[siteHealth(site, snapshot, now).state];
          const current = site.id === selectedId;
          return (
            <li key={site.id} style={projectColorStyle(siteColor(site, projects))}>
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => onSelect(site.id)}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-start outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  current ? "bg-accent/70" : "hover:bg-accent/50",
                )}
              >
                <span
                  aria-hidden
                  className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16"
                >
                  <GlobeIcon className="size-4" />
                  <span className="absolute -end-0.5 -bottom-0.5 inline-flex rounded-full bg-background p-0.5">
                    <LibraryStateDot tone={health.tone} />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{site.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {health.label} · {siteHost(site.url)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Services can back several sites. Register one here, then link it from each site that uses
          it.
        </p>
        <Button
          shape="pill"
          size="sm"
          variant="outline"
          disabled={!canManage}
          onClick={() => onEdit({ kind: "service" })}
        >
          <PlusIcon />
          Register service
        </Button>
      </div>
      {snapshot.services.map((service) => {
        const users = snapshot.sites.filter((site) => site.serviceIds.includes(service.id));
        return (
          <SiteServiceCard
            key={service.id}
            service={service}
            checks={snapshot.checks.filter((check) => check.service_id === service.id)}
            staleAfterSeconds={snapshot.staleAfterSeconds}
            now={now}
            canManage={canManage}
            usedBy={
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {users.length ? (
                  <>
                    Used by
                    {users.map((site) => (
                      <Button
                        key={site.id}
                        shape="pill"
                        size="xs"
                        variant="secondary"
                        onClick={() => onOpenSite(site.id)}
                      >
                        <GlobeIcon />
                        {site.name}
                      </Button>
                    ))}
                  </>
                ) : (
                  "Not used by any site yet."
                )}
              </p>
            }
            onEditService={() => onEdit({ kind: "service", row: service })}
            onAddCheck={() => onEdit({ kind: "check", serviceId: service.id })}
            onEditCheck={(check) => onEdit({ kind: "check", row: check })}
          />
        );
      })}
    </div>
  );
}

/** The page's own shape while the first snapshot loads, so the layout holds when it arrives. */
function SitesSkeleton() {
  return (
    <div role="status" aria-label="Loading sites" className="flex flex-col gap-8">
      <Skeleton shape="pill" className="h-10 w-56" />
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          {["first", "second", "third"].map((row) => (
            <div key={row} className="flex items-center gap-3 px-2.5 py-2">
              <Skeleton shape="card" className="size-9" />
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex items-start gap-5 rounded-3xl border border-border p-5 sm:p-7">
            <Skeleton shape="card" className="size-16" />
            <div className="flex flex-1 flex-col gap-3 pt-1">
              <Skeleton className="h-8 w-48 max-w-full" />
              <Skeleton className="h-3 w-72 max-w-full" />
            </div>
          </div>
          <div className={cn(LIBRARY_OUTLINE, "flex flex-col gap-4 p-4")}>
            {["first", "second", "third"].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton shape="pill" className="size-2" />
                <Skeleton className="h-3.5 flex-1" />
                <Skeleton shape="pill" className="h-5 w-16" />
              </div>
            ))}
          </div>
          <SiteTrafficSkeleton />
        </div>
      </div>
    </div>
  );
}
