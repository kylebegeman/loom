import { useState } from "react";
import type { EnvironmentId, ScopedProjectRef } from "@t3tools/contracts";
import { SITES_FEATURE, SITES_MANAGEMENT_FEATURE } from "@t3tools/contracts/fork";
import {
  SITE_HEALTH_STATES,
  libraryProjectForLocalRefs,
  siteHealth,
  supportsLoomFeature,
  type SiteHealthState,
} from "@t3tools/client-runtime/fork";
import { Link, useNavigate } from "@tanstack/react-router";
import { AppWindowIcon, ArrowRightIcon, GlobeIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentQuery } from "~/state/query";
import {
  LibraryPanel,
  LibraryStateBadge,
  LibraryStateDot,
} from "../project-library/LibraryControls";
import {
  projectLibrary,
  useLibraryAuthority,
  useLibraryPermission,
} from "../project-library/state";
import { SiteEditor } from "./SiteEditor";
import { SiteMark, siteHost } from "./SiteHealth";
import { sites } from "./state";
import { useSiteCheckClock } from "./use-site-check-clock";

/** A project's place only says something when a site needs someone; quiet otherwise. */
const NEWS_STATES: ReadonlySet<SiteHealthState> = new Set(["failing", "stale", "paused"]);

function useProjectSites(projectId: string, environmentId: EnvironmentId) {
  const authority = useLibraryAuthority();
  const capabilities = authority.environment?.serverConfig?.environment.capabilities;
  const supported = supportsLoomFeature(capabilities, SITES_FEATURE);
  const manages = supportsLoomFeature(capabilities, SITES_MANAGEMENT_FEATURE);
  const allowed = useLibraryPermission(sites.saveSite, environmentId);
  const query = useEnvironmentQuery(
    supported ? sites.snapshot({ environmentId, input: {} }) : null,
  );
  const snapshot = query.data?.snapshot ?? null;
  const now = useSiteCheckClock(snapshot);
  const linked = snapshot
    ? snapshot.sites
        .filter((site) => site.projectIds?.includes(projectId))
        .map((site) => ({ site, state: siteHealth(site, snapshot, now).state }))
    : [];
  const canManage = Boolean(
    manages && query.data?.managementConfigured && allowed && authority.connected,
  );
  return { supported, canManage, query, snapshot, linked };
}

/** Opens a site's Preview, the quickest way to see it without leaving the app. */
function PreviewLink({ siteId, name }: { readonly siteId: string; readonly name: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            shape="pill"
            size="icon-xs"
            variant="ghost"
            aria-label={`Preview ${name}`}
            render={<Link to="/sites" search={{ siteId, tab: "preview" }} />}
          />
        }
      >
        <AppWindowIcon />
      </TooltipTrigger>
      <TooltipPopup side="bottom">Preview</TooltipPopup>
    </Tooltip>
  );
}

/** The sites a local project serves, as small links beside its other ways in. */
function ProjectSites({
  projectId,
  environmentId,
}: {
  readonly projectId: string;
  readonly environmentId: EnvironmentId;
}) {
  const { supported, query, linked } = useProjectSites(projectId, environmentId);
  if (!supported) return null;
  if (!linked.length) {
    if (!query.error || query.data) return null;
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        This project&apos;s sites could not load.
        <Button
          shape="pill"
          size="xs"
          variant="ghost"
          disabled={query.isPending}
          onClick={query.refresh}
        >
          <RefreshCwIcon />
          Try again
        </Button>
      </p>
    );
  }
  return (
    <ul aria-label="Sites this project serves" className="flex flex-wrap items-center gap-1.5">
      {linked.map(({ site, state }) => (
        <li key={site.id} className="flex min-w-0 items-center">
          <Link
            to="/sites"
            search={{ siteId: site.id }}
            className="inline-flex h-7 min-w-0 max-w-72 items-center gap-1.5 rounded-full border border-border ps-2 pe-2.5 text-xs outline-none transition-colors duration-150 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <LibraryStateDot tone={SITE_HEALTH_STATES[state].tone} />
            <span className="truncate font-medium">{site.name}</span>
            <span className="truncate font-mono text-muted-foreground">{siteHost(site.url)}</span>
            <span className="sr-only">, {SITE_HEALTH_STATES[state].label}</span>
          </Link>
          <PreviewLink siteId={site.id} name={site.name} />
        </li>
      ))}
    </ul>
  );
}

/** The Library overview's glance at the sites this project serves, and the way to add one. */
export function SitesSummary({
  projectId,
  environmentId,
}: {
  readonly projectId: string;
  readonly environmentId: EnvironmentId;
}) {
  const { supported, canManage, query, snapshot, linked } = useProjectSites(
    projectId,
    environmentId,
  );
  const navigate = useNavigate();
  const [registering, setRegistering] = useState(false);
  if (!supported) return null;
  const openSites = (
    <Button shape="pill" size="xs" variant="ghost" render={<Link to="/sites" />}>
      Open Sites
      <ArrowRightIcon />
    </Button>
  );
  return (
    <LibraryPanel
      title="Sites"
      icon={GlobeIcon}
      count={linked.length}
      action={
        !linked.length && canManage && snapshot ? (
          <Button shape="pill" size="xs" variant="ghost" onClick={() => setRegistering(true)}>
            <PlusIcon />
            Register site
          </Button>
        ) : (
          openSites
        )
      }
    >
      {linked.length ? (
        <ul className="divide-y divide-border border-t border-border">
          {linked.map(({ site, state }) => (
            <li
              key={site.id}
              className="relative flex min-w-0 items-center gap-2.5 py-2 ps-3 pe-2 transition-colors duration-150 hover:bg-accent/50"
            >
              <Link
                to="/sites"
                search={{ siteId: site.id }}
                aria-label={`Open ${site.name}`}
                className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              />
              <span className="pointer-events-none flex">
                <SiteMark url={site.url} />
              </span>
              <span className="pointer-events-none min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{site.name}</span>
                <span className="block truncate font-mono text-2xs text-muted-foreground">
                  {siteHost(site.url)}
                </span>
              </span>
              {NEWS_STATES.has(state) ? (
                <LibraryStateBadge tone={SITE_HEALTH_STATES[state].tone}>
                  {SITE_HEALTH_STATES[state].label}
                </LibraryStateBadge>
              ) : null}
              <span className="relative">
                <PreviewLink siteId={site.id} name={site.name} />
              </span>
            </li>
          ))}
        </ul>
      ) : query.error && !query.data ? (
        <div role="alert" className="flex flex-col items-start gap-2 px-3.5 pb-3">
          <p className="text-xs leading-relaxed text-muted-foreground">{query.error}</p>
          <Button
            shape="pill"
            size="xs"
            variant="outline"
            disabled={query.isPending}
            onClick={query.refresh}
          >
            <RefreshCwIcon />
            Try again
          </Button>
        </div>
      ) : !query.data ? (
        <p role="status" className="px-3.5 pb-3 text-xs text-muted-foreground">
          Checking sites…
        </p>
      ) : query.data.configured === false ? (
        <p className="px-3.5 pb-3 text-xs leading-relaxed text-muted-foreground">
          Sites needs the personal API on your Library server. Open Sites to see what is missing.
        </p>
      ) : (
        <p className="px-3.5 pb-3 text-xs leading-relaxed text-muted-foreground">
          {canManage
            ? "No site serves this project yet. Register one to watch whether it is up and count its visits."
            : "No site serves this project yet. Sites linked to it in Sites appear here."}
        </p>
      )}
      {registering && snapshot ? (
        <SiteEditor
          target={{ kind: "site", projectId }}
          snapshot={snapshot}
          environmentId={environmentId}
          connected={canManage}
          onClose={() => setRegistering(false)}
          onSaved={(siteId) => {
            setRegistering(false);
            query.refresh();
            void navigate({ to: "/sites", search: { siteId } });
          }}
        />
      ) : null}
    </LibraryPanel>
  );
}

/** A local project's sites, through the Library project its copies belong to. */
export function LocalProjectSites({
  projectRefs,
}: {
  readonly projectRefs: readonly ScopedProjectRef[];
}) {
  const authority = useLibraryAuthority();
  const target = authority.authorityId ? { environmentId: authority.authorityId, input: {} } : null;
  const copies = useEnvironmentQuery(target ? projectLibrary.copies(target) : null);
  const projectId = libraryProjectForLocalRefs([], projectRefs, copies.data ?? []);
  // A project outside the Library has no sites to show, and Sites stays one click away in the nav.
  if (!authority.authorityId || !projectId) return null;
  return <ProjectSites environmentId={authority.authorityId} projectId={projectId} />;
}
