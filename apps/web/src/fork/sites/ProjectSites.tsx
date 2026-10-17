import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import { libraryProjectForLocalRefs, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon, GlobeIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { LibraryPanel } from "../project-library/LibraryControls";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";
import { sites } from "./state";

function useProjectSites(projectId: string, environmentId: EnvironmentId) {
  const authority = useLibraryAuthority();
  const supported = supportsLoomFeature(
    authority.environment?.serverConfig?.environment.capabilities,
    SITES_FEATURE,
  );
  const query = useEnvironmentQuery(
    supported ? sites.snapshot({ environmentId, input: {} }) : null,
  );
  const linked =
    query.data?.snapshot?.sites.filter((site) => site.projectIds?.includes(projectId)) ?? [];
  return { supported, query, linked };
}

export function ProjectSites({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: EnvironmentId;
}) {
  const { supported, query, linked } = useProjectSites(projectId, environmentId);
  if (!supported) return null;
  return (
    <section className="space-y-3" aria-label="Project sites">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Sites</h2>
        <Button size="xs" variant="outline" render={<Link to="/sites" />}>
          Open Sites
        </Button>
      </div>
      {query.error ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {query.error}
        </p>
      ) : null}
      {query.isPending && !query.data ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading sites…
        </p>
      ) : null}
      {linked.map((site) => (
        <div key={site.id}>
          <Link to="/sites" search={{ siteId: site.id }} className="text-sm underline">
            {site.name}
            {!site.active ? " (paused)" : ""}
          </Link>
        </div>
      ))}
      {query.data && !linked.length ? (
        <p className="text-sm text-muted-foreground">
          No sites linked. Register a site or link an existing one in Sites.
        </p>
      ) : null}
    </section>
  );
}

/** The Library overview's glance at the sites this project serves. */
export function SitesSummary({
  projectId,
  environmentId,
}: {
  readonly projectId: string;
  readonly environmentId: EnvironmentId;
}) {
  const { supported, query, linked } = useProjectSites(projectId, environmentId);
  if (!supported) return null;
  return (
    <LibraryPanel
      title="Sites"
      icon={GlobeIcon}
      count={linked.length}
      action={
        <Button shape="pill" size="xs" variant="ghost" render={<Link to="/sites" />}>
          {linked.length ? "Open Sites" : "Link"}
          <ArrowRightIcon />
        </Button>
      }
    >
      {linked.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {linked.map((site) => (
            <li key={site.id}>
              <Link
                to="/sites"
                search={{ siteId: site.id }}
                className="flex min-w-0 items-center gap-2.5 px-3 py-2 outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <GlobeIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{site.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {site.active ? new URL(site.url).host : "Paused"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p
          role={query.error ? "alert" : undefined}
          className="px-3.5 pb-3 text-xs leading-relaxed text-muted-foreground"
        >
          {query.error ??
            (query.data ? "Sites this project serves, linked from Sites." : "Loading sites...")}
        </p>
      )}
    </LibraryPanel>
  );
}

export function LocalProjectSites({ projectRefs }: { projectRefs: readonly ScopedProjectRef[] }) {
  const authority = useLibraryAuthority();
  const target = authority.authorityId ? { environmentId: authority.authorityId, input: {} } : null;
  const copies = useEnvironmentQuery(target ? projectLibrary.copies(target) : null);
  const projectId = libraryProjectForLocalRefs([], projectRefs, copies.data ?? []);
  return authority.authorityId && projectId ? (
    <ProjectSites environmentId={authority.authorityId} projectId={projectId} />
  ) : (
    <Button variant="outline" size="sm" render={<Link to="/sites" />}>
      Sites
    </Button>
  );
}
