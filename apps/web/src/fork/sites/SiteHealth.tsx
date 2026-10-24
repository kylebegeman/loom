import { Fragment } from "react";
import type { LibraryProject, LibraryProjectColor, SitesSnapshot } from "@t3tools/contracts/fork";
import {
  SITE_CHECK_STATES,
  SITE_HEALTH_STATES,
  SITE_TLS_WARNING_DAYS,
  libraryProjectColor,
  siteCheckState,
  siteChecksHealth,
  siteTlsDaysLeft,
} from "@t3tools/client-runtime/fork";
import {
  ArrowRightLeftIcon,
  BracesIcon,
  GlobeIcon,
  PencilIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { LibraryStateBadge, LibraryStateDot } from "../project-library/LibraryControls";
import { LIBRARY_CELL, LibraryTable, TickStrip } from "../project-library/LibraryData";

type Site = SitesSnapshot["sites"][number];
type Service = SitesSnapshot["services"][number];
type Check = SitesSnapshot["checks"][number];

export const SERVICE_KINDS: Record<
  Service["kind"],
  { readonly label: string; readonly icon: LucideIcon }
> = {
  website: { label: "Website", icon: GlobeIcon },
  api: { label: "API", icon: BracesIcon },
  redirect: { label: "Redirect", icon: ArrowRightLeftIcon },
};

/** Sites are about the web, not one project, until a site names the project it serves. */
export const SITES_COLOR: LibraryProjectColor = "blue";

/** A site takes the color of the first project it serves, so it reads as part of that project. */
export function siteColor(
  site: Site,
  projects: ReadonlyMap<string, LibraryProject>,
): LibraryProjectColor {
  const project = site.projectIds?.map((id) => projects.get(id)).find(Boolean);
  return project ? libraryProjectColor(project) : SITES_COLOR;
}

/** Drops the scheme, which every entry shares, so the part that differs is what you read. */
export function siteHost(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

export const formatDuration = (ms: number) =>
  ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

const TILE_SIZES = {
  sm: "size-7 rounded-lg [&>svg]:size-3.5",
  lg: "size-11 rounded-xl [&>svg]:size-5",
} as const;

/** A site's mark: the globe in the color it takes from its project. */
export function SiteTile({
  icon: Icon = GlobeIcon,
  size = "sm",
}: {
  readonly icon?: LucideIcon;
  readonly size?: keyof typeof TILE_SIZES;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
        TILE_SIZES[size],
      )}
    >
      <Icon />
    </span>
  );
}

export const siteChecks = (site: Site, snapshot: Pick<SitesSnapshot, "checks">) =>
  snapshot.checks.filter((check) => site.serviceIds.includes(check.service_id));

/**
 * What a set of checks last saw, reduced to what a person scans for: the slowest answer and the
 * certificate closest to expiry. Paused checks say nothing about the site, so they are left out.
 */
export function checkVitals(checks: readonly Check[], now: number) {
  let slowest: number | null = null;
  let certificate: number | null = null;
  for (const check of checks) {
    if (check.state === "disabled" || !check.last) continue;
    slowest = Math.max(slowest ?? 0, check.last.duration_ms);
    const days = siteTlsDaysLeft(check.last.tls_expires_at, now);
    if (days !== null) certificate = Math.min(certificate ?? days, days);
  }
  return { slowest, certificate };
}

export function CertificateLabel({ days }: { readonly days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">None</span>;
  return (
    <span
      className={cn(
        "tabular-nums",
        days < 0
          ? "text-destructive-foreground"
          : days <= SITE_TLS_WARNING_DAYS && "text-warning-foreground",
      )}
    >
      {days < 0 ? "Expired" : `${days} days`}
    </span>
  );
}

/** Each check's latest state as one tick, so a site's endpoints read at a glance. */
export function CheckTicks({
  checks,
  staleAfterSeconds,
  now,
}: {
  readonly checks: readonly Check[];
  readonly staleAfterSeconds: number;
  readonly now: number;
}) {
  const health = siteChecksHealth(checks, staleAfterSeconds, now);
  if (!checks.length) return <span className="text-xs text-muted-foreground">No checks</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <TickStrip
        label={`${health.passing} of ${health.total} checks passing`}
        ticks={checks.map((check) => ({
          key: check.id,
          tone: SITE_CHECK_STATES[siteCheckState(check, staleAfterSeconds, now)].tone,
        }))}
      />
      <span aria-hidden className="text-xs tabular-nums text-muted-foreground">
        {health.passing}/{health.total}
      </span>
    </span>
  );
}

const ENDPOINT_COLUMNS = [
  { key: "endpoint", label: "Endpoint" },
  { key: "state", label: "State", className: "w-28" },
  { key: "response", label: "Response", className: "hidden w-32 sm:table-cell" },
  { key: "certificate", label: "Certificate", className: "hidden w-28 md:table-cell" },
  { key: "checked", label: "Checked", className: "hidden w-28 lg:table-cell" },
  { key: "actions", label: "Actions", hideLabel: true, className: "w-10" },
] as const;

/**
 * Services and the checks that watch them, as one table: each service heads its own group of
 * endpoint rows, worst news readable down a single column.
 */
export function EndpointsTable({
  label,
  services,
  snapshot,
  now,
  canManage,
  usedBy,
  onEditService,
  onAddCheck,
  onEditCheck,
}: {
  readonly label: string;
  readonly services: readonly Service[];
  readonly snapshot: SitesSnapshot;
  readonly now: number;
  readonly canManage: boolean;
  /** Set in the shared registry, where a service is read apart from the sites using it. */
  readonly usedBy?: {
    readonly sites: readonly Site[];
    readonly onOpenSite: (siteId: string) => void;
  };
  readonly onEditService: (service: Service) => void;
  readonly onAddCheck: (service: Service) => void;
  readonly onEditCheck: (check: Check) => void;
}) {
  return (
    <LibraryTable label={label} columns={ENDPOINT_COLUMNS}>
      {services.map((service) => {
        const checks = snapshot.checks.filter((check) => check.service_id === service.id);
        const kind = SERVICE_KINDS[service.kind];
        const health = siteChecksHealth(checks, snapshot.staleAfterSeconds, now, !service.active);
        const state = SITE_HEALTH_STATES[health.state];
        return (
          <Fragment key={service.id}>
            <tr className="bg-muted/25 dark:bg-accent/15">
              <td colSpan={ENDPOINT_COLUMNS.length} className="px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                  <SiteTile icon={kind.icon} />
                  <div className="flex min-w-0 flex-1 basis-48 items-baseline gap-2">
                    <span className="truncate text-sm font-semibold">{service.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {siteHost(service.url)}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {kind.label}
                    </span>
                  </div>
                  {usedBy ? (
                    <ServiceUsers
                      sites={usedBy.sites.filter((site) => site.serviceIds.includes(service.id))}
                      onOpenSite={usedBy.onOpenSite}
                    />
                  ) : null}
                  <LibraryStateBadge tone={state.tone}>
                    {health.state === "healthy" || health.state === "failing"
                      ? `${health.passing} of ${health.total} passing`
                      : state.label}
                  </LibraryStateBadge>
                  <div className="flex items-center gap-0.5">
                    <Button
                      shape="pill"
                      size="xs"
                      variant="ghost"
                      disabled={!canManage}
                      onClick={() => onAddCheck(service)}
                    >
                      <PlusIcon />
                      Add check
                    </Button>
                    <Button
                      shape="pill"
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Edit service ${service.name}`}
                      disabled={!canManage}
                      onClick={() => onEditService(service)}
                    >
                      <PencilIcon />
                    </Button>
                  </div>
                </div>
              </td>
            </tr>
            {checks.length ? (
              checks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  staleAfterSeconds={snapshot.staleAfterSeconds}
                  now={now}
                  canManage={canManage}
                  onEdit={() => onEditCheck(check)}
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={ENDPOINT_COLUMNS.length}
                  className="px-3 py-2.5 ps-13 text-xs text-muted-foreground"
                >
                  Nothing watches this service yet. Add a check to know when it stops answering.
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </LibraryTable>
  );
}

function ServiceUsers({
  sites,
  onOpenSite,
}: {
  readonly sites: readonly Site[];
  readonly onOpenSite: (siteId: string) => void;
}) {
  if (!sites.length) {
    return <span className="text-xs text-muted-foreground">Not used by a site</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {sites.map((site) => (
        <Button
          key={site.id}
          shape="pill"
          size="xs"
          variant="ghost"
          onClick={() => onOpenSite(site.id)}
        >
          <GlobeIcon />
          {site.name}
        </Button>
      ))}
    </span>
  );
}

function CheckRow({
  check,
  staleAfterSeconds,
  now,
  canManage,
  onEdit,
}: {
  readonly check: Check;
  readonly staleAfterSeconds: number;
  readonly now: number;
  readonly canManage: boolean;
  readonly onEdit: () => void;
}) {
  const state = siteCheckState(check, staleAfterSeconds, now);
  const presentation = SITE_CHECK_STATES[state];
  const last = check.last;
  const expected = check.expected_status ?? 200;
  const problem =
    last?.error ??
    (state === "failing" && last?.status != null && last.status !== expected
      ? `Answered ${last.status}, expected ${expected}.`
      : null);
  return (
    <tr className="transition-colors duration-150 hover:bg-accent/40">
      <td className={cn(LIBRARY_CELL, "ps-5")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <LibraryStateDot tone={presentation.tone} />
          <div className="min-w-0">
            <p className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium">{check.name}</span>
              <span className="hidden truncate font-mono text-xs text-muted-foreground md:inline">
                {siteHost(check.url)}
              </span>
            </p>
            {problem ? (
              <p className="text-xs text-destructive-foreground wrap-anywhere">{problem}</p>
            ) : null}
          </div>
        </div>
      </td>
      <td className={LIBRARY_CELL}>
        <LibraryStateBadge tone={presentation.tone}>{presentation.label}</LibraryStateBadge>
      </td>
      <td className={cn(LIBRARY_CELL, "hidden sm:table-cell")}>
        {last ? (
          <span className="inline-flex items-center gap-2 text-xs tabular-nums">
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-2xs font-medium",
                last.ok
                  ? "bg-success/10 text-success-foreground"
                  : "bg-destructive/10 text-destructive-foreground",
              )}
            >
              {last.status ?? "No answer"}
            </span>
            <span className="text-muted-foreground">{formatDuration(last.duration_ms)}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Waiting</span>
        )}
      </td>
      <td className={cn(LIBRARY_CELL, "hidden text-xs md:table-cell")}>
        <CertificateLabel days={siteTlsDaysLeft(last?.tls_expires_at, now)} />
      </td>
      <td className={cn(LIBRARY_CELL, "hidden text-xs text-muted-foreground lg:table-cell")}>
        {last ? (
          <time dateTime={last.checked_at}>{formatRelativeTimeLabel(last.checked_at)}</time>
        ) : (
          "Never"
        )}
      </td>
      <td className={cn(LIBRARY_CELL, "py-1.5 text-end")}>
        <Button
          shape="pill"
          size="icon-xs"
          variant="ghost"
          aria-label={`Edit check ${check.name}`}
          disabled={!canManage}
          onClick={onEdit}
        >
          <PencilIcon />
        </Button>
      </td>
    </tr>
  );
}
