import { Link } from "@tanstack/react-router";
import type { LibraryProject, SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import { SITE_HEALTH_STATES, siteHealth } from "@t3tools/client-runtime/fork";
import {
  ActivityIcon,
  ChartColumnIcon,
  ClockIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PencilIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import type { EnvironmentQueryView } from "~/state/query";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  LibraryErrorNotice,
  LibrarySection,
  LibraryStateBadge,
} from "../project-library/LibraryControls";
import { HeroTexture, ProjectGlow, ProjectTile } from "../project-library/ProjectIdentity";
import type { SiteEditTarget } from "./SiteEditor";
import { SiteServiceCard, siteHost } from "./SiteHealth";
import { SiteTraffic, SiteTrafficSkeleton } from "./SiteTraffic";

type Site = SitesSnapshot["sites"][number];

export function SiteDetail({
  site,
  snapshot,
  now,
  projects,
  analytics,
  canManage,
  onEdit,
}: {
  readonly site: Site;
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly projects: ReadonlyMap<string, LibraryProject>;
  readonly analytics: EnvironmentQueryView<SiteAnalytics>;
  readonly canManage: boolean;
  readonly onEdit: (target: SiteEditTarget) => void;
}) {
  const health = siteHealth(site, snapshot, now);
  const state = SITE_HEALTH_STATES[health.state];
  const services = snapshot.services.filter((service) => site.serviceIds.includes(service.id));
  const traffic = analytics.data;
  return (
    <section aria-label={site.name} className="flex min-w-0 flex-col gap-8">
      <header className="relative isolate overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-xs/5 sm:p-7">
        <ProjectGlow strength="strong" />
        <HeroTexture />
        <div className="flex flex-wrap items-start gap-x-5 gap-y-4">
          <span
            aria-hidden
            className="inline-flex size-16 shrink-0 items-center justify-center rounded-2xl bg-card text-(--project-color) shadow-sm ring-1 ring-border"
          >
            <span className="inline-flex size-full items-center justify-center rounded-2xl bg-(--project-color)/13 dark:bg-(--project-color)/16">
              <GlobeIcon className="size-7" />
            </span>
          </span>
          <div className="min-w-0 flex-1 basis-60 space-y-2 pt-0.5">
            <h2 className="wrap-anywhere text-3xl leading-tight font-semibold tracking-tight">
              {site.name}
            </h2>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs tabular-nums text-muted-foreground">
              <LibraryStateBadge tone={state.tone}>{state.label}</LibraryStateBadge>
              <a
                href={site.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-w-0 items-center gap-1 rounded-sm font-mono text-foreground/80 underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="truncate">{siteHost(site.url)}</span>
                <ExternalLinkIcon aria-hidden className="size-3 shrink-0 opacity-70" />
              </a>
              {health.total ? (
                <span className="inline-flex items-center gap-1.5">
                  <ActivityIcon aria-hidden className="size-3.5 opacity-70" />
                  {health.passing} of {health.total} checks passing
                </span>
              ) : null}
              {snapshot.observedAt ? (
                <span className="inline-flex items-center gap-1.5">
                  <ClockIcon aria-hidden className="size-3.5 opacity-70" />
                  Checked {formatRelativeTimeLabel(snapshot.observedAt)}
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-1.5 pt-1.5">
            <Button
              shape="pill"
              variant="outline"
              render={<a href={site.url} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon />
              Visit
            </Button>
            <Button
              shape="pill"
              variant="outline"
              disabled={!canManage}
              onClick={() => onEdit({ kind: "site", row: site })}
            >
              <PencilIcon />
              Edit site
            </Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-1.5 sm:ps-21">
          {site.projectIds?.length ? (
            <>
              <span className="me-1 text-xs text-muted-foreground">Serves</span>
              {site.projectIds.map((id) => {
                const project = projects.get(id);
                return (
                  <Link
                    key={id}
                    to="/library/$projectId"
                    params={{ projectId: id }}
                    className="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-full border border-border bg-background/70 ps-0.5 pe-2.5 text-xs font-medium outline-none transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <ProjectTile
                      project={project ?? { id, title: id }}
                      size="sm"
                      neutral={!project}
                    />
                    <span className="truncate">{project?.title ?? "Unavailable project"}</span>
                  </Link>
                );
              })}
            </>
          ) : (
            <p className="text-xs text-warning-foreground">
              Not linked to a project yet. Edit the site to choose the projects it serves.
            </p>
          )}
        </div>
      </header>

      <LibrarySection title="Health" icon={ActivityIcon} count={services.length}>
        {services.length ? (
          <div className="flex flex-col gap-3">
            {services.map((service) => (
              <SiteServiceCard
                key={service.id}
                service={service}
                checks={snapshot.checks.filter((check) => check.service_id === service.id)}
                staleAfterSeconds={snapshot.staleAfterSeconds}
                now={now}
                canManage={canManage}
                onEditService={() => onEdit({ kind: "service", row: service })}
                onAddCheck={() => onEdit({ kind: "check", serviceId: service.id })}
                onEditCheck={(check) => onEdit({ kind: "check", row: check })}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border px-4 py-4">
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
      </LibrarySection>

      <LibrarySection title="Traffic" icon={ChartColumnIcon}>
        <LibraryErrorNotice error={analytics.error} onRetry={analytics.refresh} />
        {traffic ? (
          <SiteTraffic analytics={traffic} origins={site.origins} />
        ) : analytics.isPending ? (
          <SiteTrafficSkeleton />
        ) : null}
      </LibrarySection>
    </section>
  );
}
