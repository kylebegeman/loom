import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  createSitesAtoms,
  siteCheckState,
  supportsLoomFeature,
} from "@t3tools/client-runtime/fork";
import { SITES_FEATURE } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { connectionAtomRuntime } from "~/connection/runtime";
import { useEnvironmentQuery } from "~/state/query";
import { isElectron } from "~/env";
import { useLibraryAuthority } from "../project-library/state";

const sites = createSitesAtoms(connectionAtomRuntime);
const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "No activity yet";
export function SitesPage() {
  const authority = useLibraryAuthority();
  const supported = supportsLoomFeature(
    authority.environment?.serverConfig?.environment.capabilities,
    SITES_FEATURE,
  );
  const [selection, setSelection] = useState<string | null>(null);
  const query = useEnvironmentQuery(
    authority.authorityId && supported
      ? sites.snapshot({ environmentId: authority.authorityId, input: {} })
      : null,
  );
  const snapshot = query.data?.snapshot;
  const selected = snapshot?.sites.find((site) => site.id === selection) ?? snapshot?.sites[0];
  const analytics = useEnvironmentQuery(
    authority.authorityId && supported && selected
      ? sites.analytics({ environmentId: authority.authorityId, input: { siteId: selected.id } })
      : null,
  );
  const refresh = () => {
    query.refresh();
    analytics.refresh();
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <WorkspacePageHeader electron={isElectron}>
        <span className="text-sm font-medium">Sites</span>
      </WorkspacePageHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="wide">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Sites</h1>
              <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                Your websites, their services, and the activity they receive.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={refresh}
                disabled={!authority.connected || !supported || query.isPending}
              >
                Refresh
              </Button>
              <Button
                size="sm"
                render={
                  <a href="https://api.begam.in/admin#/sites" target="_blank" rel="noreferrer" />
                }
              >
                Manage sites
              </Button>
            </div>
          </div>
          {!authority.authorityId ? (
            <p role="status">
              Choose your Library server in{" "}
              <Link to="/projects" className="underline">
                Projects
              </Link>{" "}
              to view your sites.
            </p>
          ) : !authority.connected ? (
            <p role="status">
              Library offline. Reconnect {authority.environment?.label ?? "your Library server"} to
              refresh sites. Any saved results below may be out of date.
            </p>
          ) : !supported ? (
            <p role="status">Update your Library server to use Sites.</p>
          ) : null}
          {query.isPending && !snapshot ? <p role="status">Loading sites…</p> : null}
          {query.error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {query.error}
            </p>
          ) : null}
          {query.data?.configured === false ? (
            <p role="status">
              Connect the personal API to your Library server to view sites here. You can still
              manage sites directly.
            </p>
          ) : null}
          {snapshot ? (
            <>
              <p className="text-xs text-muted-foreground">
                From api.begam.in through {authority.environment?.label ?? "your Library"}. Updated{" "}
                {date(snapshot.observedAt)}.
              </p>
              {snapshot.sites.length === 0 ? (
                <p>No sites registered yet. Add your first site in Manage sites.</p>
              ) : null}
              <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                <nav aria-label="Registered sites" className="flex flex-col gap-1">
                  {snapshot.sites.map((site) => (
                    <Button
                      key={site.id}
                      variant={site.id === selected?.id ? "secondary" : "ghost"}
                      onClick={() => setSelection(site.id)}
                      aria-pressed={site.id === selected?.id}
                    >
                      {site.name}
                      {!site.active ? " (paused)" : ""}
                    </Button>
                  ))}
                </nav>
                {selected ? (
                  <section className="min-w-0 space-y-6" aria-label={selected.name}>
                    <div>
                      <h2 className="text-xl font-semibold">{selected.name}</h2>
                      <a
                        href={selected.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sm text-muted-foreground underline"
                      >
                        {selected.url}
                      </a>
                    </div>
                    <section className="space-y-3" aria-label="Endpoint checks">
                      <h3 className="font-medium">Services and checks</h3>
                      {selected.serviceIds.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No services linked. Link a service in Manage sites to monitor its
                          endpoints.
                        </p>
                      ) : null}
                      {snapshot.services
                        .filter((service) => selected.serviceIds.includes(service.id))
                        .map((service) => {
                          const checks = snapshot.checks.filter(
                            (check) => check.service_id === service.id,
                          );
                          return (
                            <div
                              key={service.id}
                              className="space-y-2 rounded-lg border border-border p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">{service.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {service.kind}
                                  {!service.active ? " (paused)" : ""}
                                </span>
                              </div>
                              {checks.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  No endpoint checks configured.
                                </p>
                              ) : null}
                              {checks.map((check) => {
                                const state = siteCheckState(
                                  check,
                                  snapshot.staleAfterSeconds,
                                  Date.now(),
                                );
                                return (
                                  <div
                                    key={check.id}
                                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                  >
                                    <div className="min-w-0">
                                      <p>{check.name}</p>
                                      <p className="break-all text-xs text-muted-foreground">
                                        {check.url}
                                      </p>
                                      <p className="text-xs text-muted-foreground">
                                        {check.last
                                          ? `Checked ${date(check.last.checked_at)}`
                                          : "Awaiting first check"}
                                      </p>
                                    </div>
                                    <Badge
                                      variant={
                                        state === "healthy"
                                          ? "success"
                                          : state === "failing"
                                            ? "error"
                                            : state === "stale"
                                              ? "warning"
                                              : "secondary"
                                      }
                                    >
                                      {state}
                                    </Badge>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                    </section>
                    <section className="space-y-3" aria-label="Site analytics">
                      <h3 className="font-medium">Activity in the last 30 days</h3>
                      {analytics.isPending && !analytics.data ? (
                        <p role="status">Loading activity…</p>
                      ) : null}
                      {analytics.error ? (
                        <p role="alert" className="text-sm text-destructive-foreground">
                          {analytics.error}
                        </p>
                      ) : null}
                      {analytics.data ? (
                        <>
                          <dl className="grid grid-cols-3 gap-3">
                            {[
                              ["Page views", analytics.data.pageviews],
                              ["Daily visitors", analytics.data.visitors],
                              ["Events", analytics.data.events],
                            ].map(([label, value]) => (
                              <div key={label}>
                                <dt className="text-xs text-muted-foreground">{label}</dt>
                                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                                  {value}
                                </dd>
                              </div>
                            ))}
                          </dl>
                          <p className="text-xs text-muted-foreground">
                            Visitors are counted per day. Last activity:{" "}
                            {date(analytics.data.lastEventAt)}.
                          </p>
                          {analytics.data.pages.length ? (
                            <div>
                              <h4 className="mb-2 text-sm font-medium">Top pages</h4>
                              <ul className="space-y-2 text-sm">
                                {analytics.data.pages.map((page) => (
                                  <li key={page.path} className="flex justify-between gap-3">
                                    <span className="min-w-0 break-all">{page.path}</span>
                                    <span className="tabular-nums">{page.pageviews}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              No page views recorded for this site in this period.
                            </p>
                          )}
                          {analytics.data.named.length ? (
                            <div>
                              <h4 className="mb-2 text-sm font-medium">Clicks and events</h4>
                              <ul className="space-y-2 text-sm">
                                {analytics.data.named.map((event) => (
                                  <li
                                    key={JSON.stringify([event.name, event.label, event.target])}
                                    className="flex justify-between gap-3"
                                  >
                                    <span className="min-w-0 break-all">
                                      {event.label || event.name}
                                      {event.target ? ` · ${event.target}` : ""}
                                    </span>
                                    <span className="tabular-nums">{event.count}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </section>
                  </section>
                ) : null}
              </div>
            </>
          ) : null}
          <p className="text-sm text-muted-foreground">
            Building another project? Explore the{" "}
            <a
              className="underline"
              href="https://api.begam.in/v1/public/catalog"
              target="_blank"
              rel="noreferrer"
            >
              personal API catalog
            </a>
            .
          </p>
        </WorkspacePageContainer>
      </main>
    </SidebarInset>
  );
}
