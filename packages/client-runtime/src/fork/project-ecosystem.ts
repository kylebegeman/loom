import type { LibraryProject, SitesSnapshot } from "@t3tools/contracts/fork";
import { siteChecksHealth } from "./sites-presentation.ts";

export function projectRelationships(project: LibraryProject, catalog: readonly LibraryProject[]) {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  return {
    dependencies: [...new Set(project.dependencies ?? [])].map((id) => ({
      id,
      project: byId.get(id) ?? null,
    })),
    dependents: catalog.filter(
      (entry) => entry.id !== project.id && entry.dependencies?.includes(project.id),
    ),
  };
}

export function projectServices(
  projectIds: readonly string[],
  snapshot: SitesSnapshot,
  now: number,
) {
  const ids = new Set(projectIds);
  const linkedSites = snapshot.sites.filter((site) => site.projectIds?.some((id) => ids.has(id)));
  const serviceIds = new Set(linkedSites.flatMap((site) => site.serviceIds));
  const observed = Date.parse(snapshot.observedAt);
  const observation =
    !Number.isFinite(observed) || observed > now
      ? "unknown"
      : now - observed > snapshot.staleAfterSeconds * 1000
        ? "stale"
        : "current";
  return snapshot.services
    .filter((service) => serviceIds.has(service.id))
    .map((service) => {
      const sites = linkedSites.filter((site) => site.serviceIds.includes(service.id));
      const health = siteChecksHealth(
        snapshot.checks.filter((check) => check.service_id === service.id),
        snapshot.staleAfterSeconds,
        now,
        !service.active,
      );
      return {
        service,
        sites,
        linkedProjectIds: [
          ...new Set(sites.flatMap((site) => site.projectIds ?? []).filter((id) => ids.has(id))),
        ],
        health:
          observation === "current" || health.state === "paused"
            ? health
            : {
                ...health,
                state: observation === "unknown" ? ("unchecked" as const) : ("stale" as const),
              },
      };
    });
}

export function projectComputerCapabilities(features: readonly string[] | undefined) {
  return [
    { id: "library-repository-access", label: "Reviewed repository access" },
    { id: "library-profile-readiness", label: "Tool readiness checks" },
    { id: "project-workflows", label: "Recoverable project requests" },
  ].map((feature) => ({
    ...feature,
    supported: features === undefined ? null : features.includes(feature.id),
  }));
}
