import { useSiteCheckClock } from "./use-site-check-clock";
import { useState } from "react";
import { Link, useSearch, useNavigate } from "@tanstack/react-router";
import { siteCheckState, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import { SITES_FEATURE, SITES_MANAGEMENT_FEATURE } from "@t3tools/contracts/fork";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SidebarInset } from "~/components/ui/sidebar";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { useAtomCommand } from "~/state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { SiteEditor, type SiteEditTarget } from "./SiteEditor";
import { sites } from "./state";
import { useEnvironmentQuery } from "~/state/query";
import { isElectron } from "~/env";
import {
  useLibraryAuthority,
  useLibraryProjects,
  useLibraryPermission,
} from "../project-library/state";

const date = (value: string | null) =>
  value ? new Date(value).toLocaleString() : "No activity yet";
export function SitesPage() {
  const authority = useLibraryAuthority();
  return <SitesContent key={authority.authorityId} authority={authority} />;
}

// Drafts and pending action state belong to one Library, even when both use the same site IDs.
function SitesContent({ authority }: { authority: ReturnType<typeof useLibraryAuthority> }) {
  const search = useSearch({ from: "/sites" });
  const navigate = useNavigate();
  const supported = supportsLoomFeature(
    authority.environment?.serverConfig?.environment.capabilities,
    SITES_FEATURE,
  );
  const projects = useLibraryProjects(true);
  const allowed = useLibraryPermission(sites.saveSite, authority.authorityId);
  const manages = supportsLoomFeature(
    authority.environment?.serverConfig?.environment.capabilities,
    SITES_MANAGEMENT_FEATURE,
  );
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
                disabled={!canManage || !snapshot}
                onClick={() => setEditing({ kind: "site" })}
              >
                Register site
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canManage || !snapshot || running}
                onClick={() => void run()}
              >
                {running ? "Running checks…" : "Run checks now"}
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
          {actionError ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {actionError}
            </p>
          ) : null}
          {supported && query.data?.configured && !query.data.managementConfigured ? (
            <p role="status" className="text-sm text-muted-foreground">
              {manages
                ? "Site management needs a manager connection on your Library server."
                : "Update your Library server to manage sites here."}
            </p>
          ) : null}
          {query.isPending && !snapshot ? <p role="status">Loading sites…</p> : null}
          {query.error ? (
            <p role="alert" className="text-sm text-destructive-foreground">
              {query.error}
            </p>
          ) : null}
          {query.data?.configured === false ? (
            <p role="status">Connect the personal API to your Library server to view sites here.</p>
          ) : null}
          {snapshot ? (
            <>
              <p className="text-xs text-muted-foreground">
                From api.begam.in through {authority.environment?.label ?? "your Library"}. Updated{" "}
                {date(snapshot.observedAt)}.
              </p>
              {snapshot.sites.length === 0 ? (
                <p>No sites registered yet. Register your first site to connect it to a project.</p>
              ) : null}
              <div className="grid gap-6 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
                <nav aria-label="Registered sites" className="flex flex-col gap-1">
                  {snapshot.sites.map((site) => (
                    <Button
                      key={site.id}
                      variant={site.id === selected?.id ? "secondary" : "ghost"}
                      onClick={() => {
                        void navigate({ to: "/sites", search: { siteId: site.id }, replace: true });
                      }}
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
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h2 className="text-xl font-semibold">{selected.name}</h2>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canManage}
                          onClick={() => setEditing({ kind: "site", row: selected })}
                        >
                          Edit site
                        </Button>
                      </div>
                      <a
                        href={selected.url}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-sm text-muted-foreground underline"
                      >
                        {selected.url}
                      </a>
                    </div>
                    <section className="space-y-2" aria-label="Linked projects">
                      <h3 className="font-medium">Projects</h3>
                      {!selected.projectIds?.length ? (
                        <p className="text-sm text-muted-foreground">
                          Link this existing site to at least one project in Edit site.
                        </p>
                      ) : null}
                      {selected.projectIds?.map((id) => (
                        <div key={id}>
                          <Link
                            to="/library/$projectId"
                            params={{ projectId: id }}
                            className="text-sm underline"
                          >
                            {projects.query.data?.find((project) => project.id === id)?.title ?? id}
                          </Link>
                        </div>
                      ))}
                    </section>
                    <section className="space-y-3" aria-label="Endpoint checks">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-medium">Services and checks</h3>
                      </div>
                      {selected.serviceIds.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No services linked. Link a service in Edit site to monitor its endpoints.
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
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    disabled={!canManage}
                                    onClick={() => setEditing({ kind: "service", row: service })}
                                  >
                                    Edit service
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    disabled={!canManage}
                                    onClick={() =>
                                      setEditing({ kind: "check", serviceId: service.id })
                                    }
                                  >
                                    Add check
                                  </Button>
                                </div>
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
                                  now,
                                );
                                return (
                                  <div
                                    key={check.id}
                                    className="flex flex-wrap items-center justify-between gap-2 text-sm"
                                  >
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <p>{check.name}</p>
                                        <Button
                                          size="xs"
                                          variant="ghost"
                                          disabled={!canManage}
                                          onClick={() => setEditing({ kind: "check", row: check })}
                                        >
                                          Edit check
                                        </Button>
                                      </div>
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
          {snapshot ? (
            <section className="space-y-3" aria-label="Shared service registry">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">Shared services</h2>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canManage}
                  onClick={() => setEditing({ kind: "service" })}
                >
                  Register service
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Services can support several sites. Register a service here, then link it in Edit
                site.
              </p>
              {snapshot.services.map((service) => (
                <div
                  key={service.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      {service.name}
                      {!service.active ? " (paused)" : ""}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">{service.url}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => setEditing({ kind: "service", row: service })}
                    >
                      Edit service
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canManage}
                      onClick={() => setEditing({ kind: "check", serviceId: service.id })}
                    >
                      Add check
                    </Button>
                  </div>
                  {snapshot.checks
                    .filter((check) => check.service_id === service.id)
                    .map((check) => (
                      <Button
                        key={check.id}
                        size="xs"
                        variant="ghost"
                        disabled={!canManage}
                        onClick={() => setEditing({ kind: "check", row: check })}
                      >
                        Edit {check.name}
                      </Button>
                    ))}
                </div>
              ))}
            </section>
          ) : null}
          {snapshot && authority.authorityId && editing ? (
            <SiteEditor
              key={`${editing.kind}:${editing.row?.id ?? "new"}`}
              target={editing}
              snapshot={snapshot}
              environmentId={authority.authorityId}
              connected={canManage}
              onClose={() => setEditing(null)}
              onSaved={(id) => {
                if (editing.kind === "site")
                  void navigate({ to: "/sites", search: { siteId: id }, replace: true });
                setEditing(null);
                refresh();
              }}
            />
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
