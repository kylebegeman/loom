import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { SITES_FEATURE, SITES_MANAGEMENT_FEATURE } from "@t3tools/contracts/fork";
import {
  SITE_HEALTH_STATES,
  siteHealth,
  supportsLoomFeature,
  type SiteHealthState,
} from "@t3tools/client-runtime/fork";
import { Link, useNavigate } from "@tanstack/react-router";
import { AppWindowIcon, ArrowRightIcon, GlobeIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useEnvironmentQuery } from "~/state/query";
import { LibraryCardTarget } from "../project-library/LibraryCollection";
import { LibraryPanel, LibraryStateBadge } from "../project-library/LibraryControls";
import { useLibraryAuthority, useLibraryPermission } from "../project-library/state";
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
              <LibraryCardTarget
                label={`Open ${site.name}`}
                to="/sites"
                search={{ siteId: site.id }}
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
