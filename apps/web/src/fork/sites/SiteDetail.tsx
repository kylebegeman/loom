import { Link } from "@tanstack/react-router";
import type { LibraryProject, SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import { SITE_HEALTH_STATES, siteHealth } from "@t3tools/client-runtime/fork";
import { ExternalLinkIcon, PencilIcon, PlayIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import type { EnvironmentQueryView } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryErrorNotice, LibraryStateBadge } from "../project-library/LibraryControls";
import { LibraryBackLink } from "../project-library/LibraryPageFrame";
import { ProjectTile } from "../project-library/ProjectIdentity";
import type { SiteEditTarget } from "./SiteEditor";
import {
  CertificateLabel,
  CheckTicks,
  EndpointsTable,
  SiteTile,
  checkVitals,
  formatDuration,
  siteChecks,
  siteHost,
} from "./SiteHealth";
import { SiteTraffic, SiteTrafficSkeleton, formatCount } from "./SiteTraffic";

type Site = SitesSnapshot["sites"][number];

/**
 * One site across the page's full width: who it is and what to do with it, its vital signs in
 * one line, then its traffic and endpoints beside the facts that rarely change.
 */
export function SiteDetail({
  site,
  snapshot,
  now,
  projects,
  analytics,
  canManage,
  running,
  onRunChecks,
  onEdit,
}: {
  readonly site: Site;
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly analytics: EnvironmentQueryView<SiteAnalytics>;
  readonly canManage: boolean;
  readonly running: boolean;
  readonly onRunChecks: () => void;
  readonly onEdit: (target: SiteEditTarget) => void;
}) {
  const health = siteHealth(site, snapshot, now);
  const state = SITE_HEALTH_STATES[health.state];
  const services = snapshot.services.filter((service) => site.serviceIds.includes(service.id));
  const checks = siteChecks(site, snapshot);
  const vitals = checkVitals(checks, now);
  const traffic = analytics.data;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div>
        <LibraryBackLink to="/sites">Sites</LibraryBackLink>
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <SiteTile size="lg" />
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-xl font-semibold tracking-tight">{site.name}</h1>
              <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
            </div>
            <a
              href={site.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 rounded-sm font-mono text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="truncate">{siteHost(site.url)}</span>
              <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              shape="pill"
              size="sm"
              variant="ghost"
              disabled={!canManage || running}
              onClick={onRunChecks}
            >
              <PlayIcon />
              {running ? "Running checks…" : "Run checks"}
            </Button>
            <Button
              shape="pill"
              size="sm"
              variant="outline"
              disabled={!canManage}
              onClick={() => onEdit({ kind: "site", row: site })}
            >
              <PencilIcon />
              Edit site
            </Button>
            <Button
              shape="pill"
              size="sm"
              render={<a href={site.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              Visit
            </Button>
          </div>
        </header>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 border-y border-border py-3">
        <Vital label="Checks">
          <CheckTicks checks={checks} staleAfterSeconds={snapshot.staleAfterSeconds} now={now} />
        </Vital>
        <Vital label="Slowest response">
          {vitals.slowest === null ? "None yet" : formatDuration(vitals.slowest)}
        </Vital>
        <Vital label="Certificate">
          <CertificateLabel days={vitals.certificate} />
        </Vital>
        <Vital label={traffic ? `Page views, ${traffic.days} days` : "Page views"}>
          {traffic ? formatCount(traffic.pageviews) : "…"}
        </Vital>
        <Vital label="Last checked">
          {snapshot.observedAt ? formatRelativeTimeLabel(snapshot.observedAt) : "Never"}
        </Vital>
      </dl>

      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <Block title="Traffic">
            <LibraryErrorNotice error={analytics.error} onRetry={analytics.refresh} />
            {traffic ? (
              <SiteTraffic analytics={traffic} />
            ) : analytics.isPending ? (
              <SiteTrafficSkeleton />
            ) : null}
          </Block>
          <Block title="Endpoints" detail={`${services.length} services · ${checks.length} checks`}>
            {services.length ? (
              <EndpointsTable
                label={`${site.name} endpoints`}
                services={services}
                snapshot={snapshot}
                now={now}
                canManage={canManage}
                onEditService={(service) => onEdit({ kind: "service", row: service })}
                onAddCheck={(service) => onEdit({ kind: "check", serviceId: service.id })}
                onEditCheck={(check) => onEdit({ kind: "check", row: check })}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3">
                <p className="text-sm text-muted-foreground">
                  No services linked. Link the services this site runs on to watch their endpoints.
                </p>
                <Button
                  shape="pill"
                  size="sm"
                  variant="outline"
                  disabled={!canManage}
                  onClick={() => onEdit({ kind: "site", row: site })}
                >
                  Link services
                </Button>
              </div>
            )}
          </Block>
        </div>

        <aside aria-label="About this site" className="flex min-w-0 flex-col gap-6">
          <Block title="Serves">
            {site.projectIds?.length ? (
              <ul className="flex flex-col gap-0.5">
                {site.projectIds.map((id) => {
                  const project = projects.get(id);
                  return (
                    <li key={id}>
                      <Link
                        to="/library/$projectId"
                        params={{ projectId: id }}
                        className="-mx-2 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <ProjectTile
                          project={project ?? { id, title: id }}
                          size="sm"
                          neutral={!project}
                        />
                        <span className="truncate">{project?.title ?? "Unavailable project"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-warning-foreground">
                Not linked to a project yet. Edit the site to choose the projects it serves.
              </p>
            )}
          </Block>
          <Block title="Counting visits from">
            <ul className="flex flex-col gap-1.5">
              {site.origins.map((origin) => (
                <li key={origin} className="truncate font-mono text-xs text-foreground/80">
                  {siteHost(origin)}
                </li>
              ))}
            </ul>
          </Block>
        </aside>
      </div>
    </div>
  );
}

function Vital({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex h-5 items-center text-sm font-medium tabular-nums">{children}</dd>
    </div>
  );
}

/** A titled stretch of the detail page; the title is small so the content leads. */
function Block({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2.5">
      <h2 className="flex items-baseline justify-between gap-3 text-sm font-semibold tracking-tight">
        {title}
        {detail ? (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">{detail}</span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}
