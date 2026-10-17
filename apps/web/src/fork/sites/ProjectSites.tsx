import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import { libraryProjectForLocalRefs, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { Link } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { useEnvironmentQuery } from "~/state/query";
import { projectLibrary, useLibraryAuthority } from "../project-library/state";
import { sites } from "./state";

export function ProjectSites({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: EnvironmentId;
}) {
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
