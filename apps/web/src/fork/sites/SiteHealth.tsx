import { Fragment, useState, type ReactNode } from "react";
import type { LibraryProject, LibraryProjectColor, SitesSnapshot } from "@t3tools/contracts/fork";
import {
  SITE_CHECK_STATES,
  SITE_HEALTH_STATES,
  SITE_TLS_WARNING_DAYS,
  libraryProjectColor,
  siteCheckState,
  siteChecksHealth,
  siteTlsDaysLeft,
  type LibraryWorkflowTone,
  type SiteCheckState,
  type SiteHealthState,
} from "@t3tools/client-runtime/fork";
import {
  ArrowRightLeftIcon,
  BracesIcon,
  EllipsisIcon,
  GlobeIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "~/components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
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

/** The part of a check's address after its service's origin, which its group already names. */
export function sitePath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
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

/**
 * The icon a site publishes at its origin's conventional path. Fetching it loads no page, so it
 * runs none of the site's scripts and counts no visit.
 */
export function siteFaviconUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return new URL("/favicon.ico", parsed.origin).href;
  } catch {
    return null;
  }
}

const MARK_SIZES = {
  sm: { box: "size-7 rounded-lg", glyph: "size-3.5", image: "size-4" },
  lg: { box: "size-11 rounded-xl", glyph: "size-5", image: "size-6" },
  "2xl": { box: "size-16 rounded-2xl", glyph: "size-7", image: "size-9" },
} as const;

/**
 * A site's own icon on its project's tint, so it is recognized the way a browser tab shows it.
 * The globe stands in until the icon arrives, and stays when the site publishes none.
 */
export function SiteMark({
  url,
  size = "sm",
}: {
  readonly url: string;
  readonly size?: keyof typeof MARK_SIZES;
}) {
  const src = siteFaviconUrl(url);
  const [result, setResult] = useState<{
    readonly src: string;
    readonly loaded: boolean;
  } | null>(null);
  const loaded = result?.src === src && result.loaded;
  const failed = result?.src === src && !result.loaded;
  const dimensions = MARK_SIZES[size];
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-(--project-color)/12 text-(--project-color) dark:bg-(--project-color)/16",
        dimensions.box,
      )}
    >
      {loaded ? null : <GlobeIcon className={dimensions.glyph} />}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={() => setResult({ src, loaded: true })}
          onError={() => setResult({ src, loaded: false })}
          className={cn(dimensions.image, "object-contain", !loaded && "absolute opacity-0")}
        />
      ) : null}
    </span>
  );
}

export const siteChecks = (site: Site, snapshot: Pick<SitesSnapshot, "checks">) =>
  snapshot.checks.filter((check) => site.serviceIds.includes(check.service_id));

/**
 * When a set of checks last reported, from the checks themselves. The snapshot's own time says
 * when the list was read, which stays fresh even while every check has stopped reporting.
 */
export function siteLastChecked(checks: readonly Check[]): string | null {
  let latest: string | null = null;
  let latestAt = -Infinity;
  for (const check of checks) {
    if (!check.last) continue;
    const at = Date.parse(check.last.checked_at);
    if (Number.isFinite(at) && at > latestAt) {
      latestAt = at;
      latest = check.last.checked_at;
    }
  }
  return latest;
}

/**
 * What a set of checks last saw, reduced to what a person scans for: the slowest answer and the
 * certificate closest to expiry. Paused checks say nothing about the site, so they are left out.
 */
export function checkVitals(checks: readonly Check[], now: number) {
  let slowest: number | null = null;
  let certificate: number | null = null;
  let certificateExpiresAt: string | null = null;
  for (const check of checks) {
    if (check.state === "disabled" || !check.last) continue;
    slowest = Math.max(slowest ?? 0, check.last.duration_ms);
    const days = siteTlsDaysLeft(check.last.tls_expires_at, now);
    if (days !== null && (certificate === null || days < certificate)) {
      certificate = days;
      certificateExpiresAt = check.last.tls_expires_at;
    }
  }
  return { slowest, certificate, certificateExpiresAt };
}

// Worst news first: a failure, then a result too old to trust, then one that never came.
const CHECK_ATTENTION: Record<SiteCheckState, number> = {
  failing: 0,
  stale: 1,
  unknown: 2,
  healthy: 3,
  disabled: 4,
};

const SERVICE_ATTENTION: Record<SiteHealthState, number> = {
  failing: 0,
  stale: 1,
  unchecked: 2,
  unmonitored: 3,
  healthy: 4,
  paused: 5,
};

const byName = (a: { readonly name: string }, b: { readonly name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

/** Checks with the worst current state first, then by name, so a failure is the first row read. */
export function orderChecksForAttention(
  checks: readonly Check[],
  staleAfterSeconds: number,
  now: number,
): readonly Check[] {
  return checks
    .map((check) => ({
      check,
      rank: CHECK_ATTENTION[siteCheckState(check, staleAfterSeconds, now)],
    }))
    .toSorted((a, b) => a.rank - b.rank || byName(a.check, b.check))
    .map(({ check }) => check);
}

/** Services holding a failing check first; paused services sink to the end. */
export function orderServicesForAttention(
  services: readonly Service[],
  snapshot: Pick<SitesSnapshot, "checks" | "staleAfterSeconds">,
  now: number,
): readonly Service[] {
  return services
    .map((service) => ({
      service,
      rank: SERVICE_ATTENTION[
        siteChecksHealth(
          snapshot.checks.filter((check) => check.service_id === service.id),
          snapshot.staleAfterSeconds,
          now,
          !service.active,
        ).state
      ],
    }))
    .toSorted((a, b) => a.rank - b.rank || byName(a.service, b.service))
    .map(({ service }) => service);
}

/** What went wrong on a check's last request, in words, or null while nothing did. */
export function checkProblem(check: Check, state: SiteCheckState): string | null {
  const last = check.last;
  if (!last || state === "disabled") return null;
  if (last.error) return last.error;
  if (state !== "failing") return null;
  const expected = check.expected_status ?? 200;
  if (last.status === null) return "No answer.";
  if (last.status !== expected) return `Answered ${last.status}, expected ${expected}.`;
  // The status matched, so the one remaining condition, the expected text, is what failed.
  return check.content ? `Answered ${last.status} without “${check.content}”.` : null;
}

export type CheckIssue = {
  readonly check: Check;
  readonly tone: LibraryWorkflowTone;
  /** What a person should know, in words. */
  readonly problem: string;
};

const certificateProblem = (days: number) =>
  days < 0
    ? "Certificate expired."
    : days === 0
      ? "Certificate expires today."
      : `Certificate expires in ${days} ${days === 1 ? "day" : "days"}.`;

/**
 * What needs a person across a set of checks, worst first: failures with what went wrong, results
 * too old to trust, then certificates near or past expiry on checks that still answer. One entry
 * per check, its most serious one.
 */
export function checkIssues(
  checks: readonly Check[],
  staleAfterSeconds: number,
  now: number,
): readonly CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const check of orderChecksForAttention(checks, staleAfterSeconds, now)) {
    const state = siteCheckState(check, staleAfterSeconds, now);
    const last = check.last;
    if (state === "disabled" || !last) continue;
    if (state === "failing") {
      const problem = checkProblem(check, state) ?? "Failed its last check.";
      issues.push({ check, tone: "danger", problem });
      continue;
    }
    if (state === "stale") {
      const problem = `Last result ${formatRelativeTimeLabel(last.checked_at, now)}.`;
      issues.push({ check, tone: "warning", problem });
      continue;
    }
    const days = siteTlsDaysLeft(last.tls_expires_at, now);
    if (days !== null && days <= SITE_TLS_WARNING_DAYS) {
      const tone = days < 0 ? "danger" : "warning";
      issues.push({ check, tone, problem: certificateProblem(days) });
    }
  }
  return issues;
}

/** What a check asks of its endpoint, read beside its address. */
export function checkExpectation(check: Check) {
  const status = `Expects ${check.expected_status ?? 200}`;
  return check.content ? `${status} with “${check.content}”` : status;
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
        ticks={orderChecksForAttention(checks, staleAfterSeconds, now).map((check) => ({
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

/**
 * A tooltip for a control whose label cannot say everything, such as why it is off. A disabled
 * button takes no pointer events, so the hint hangs on a wrapper around it.
 */
export function ActionHint({
  hint,
  children,
}: {
  /** Null when the control speaks for itself. */
  readonly hint: string | null | undefined;
  readonly children: ReactNode;
}) {
  if (!hint) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipPopup side="bottom">{hint}</TooltipPopup>
    </Tooltip>
  );
}

/** A site, service or check to pause or resume in place, without opening its editor. */
export type ActiveToggleTarget =
  | { readonly kind: "site"; readonly row: Site }
  | { readonly kind: "service"; readonly row: Service }
  | { readonly kind: "check"; readonly row: Check };

/** The shape of the editor's `useSiteActiveToggle`, so its result passes straight through. */
export type ActiveToggle = {
  /** The `kind:id` of the entry being saved, so its control can say so. */
  readonly pending: string | null;
  readonly toggle: (target: ActiveToggleTarget) => void;
};

const ENDPOINT_COLUMNS = [
  { key: "endpoint", label: "Endpoint" },
  { key: "state", label: "State", className: "w-28" },
  { key: "response", label: "Response", className: "hidden w-32 sm:table-cell" },
  { key: "certificate", label: "Certificate", className: "hidden w-24 md:table-cell" },
  { key: "checked", label: "Checked", className: "hidden w-28 lg:table-cell" },
  { key: "actions", label: "Actions", hideLabel: true, className: "w-10" },
] as const;

const MAX_SERVICE_USERS = 2;

/**
 * Services and the checks that watch them, as one table: each service heads its own group of
 * endpoint rows. Groups and rows both put the worst news first, so it reads down one column.
 */
export function EndpointsTable({
  label,
  services,
  snapshot,
  now,
  canManage,
  manageHint,
  activeToggle,
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
  /** Why changes are off while `canManage` is false, shown on the controls it disables. */
  readonly manageHint?: string | null | undefined;
  /** Offers Pause and Resume in each row's menu; without it, pausing stays in the editor. */
  readonly activeToggle?: ActiveToggle | undefined;
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
      {orderServicesForAttention(services, snapshot, now).map((service) => {
        const checks = snapshot.checks.filter((check) => check.service_id === service.id);
        const kind = SERVICE_KINDS[service.kind];
        const health = siteChecksHealth(checks, snapshot.staleAfterSeconds, now, !service.active);
        const state = SITE_HEALTH_STATES[health.state];
        const paused = !service.active;
        return (
          <Fragment key={service.id}>
            <tr className="bg-muted/25 dark:bg-accent/15">
              <td colSpan={ENDPOINT_COLUMNS.length} className="py-1.5 ps-3 pe-1.5">
                <div className="flex min-w-0 items-center gap-x-3 gap-y-1">
                  <SiteTile icon={kind.icon} />
                  <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        "truncate text-sm font-semibold",
                        paused && "text-muted-foreground",
                      )}
                    >
                      {service.name}
                    </span>
                    <span className="hidden truncate font-mono text-xs text-muted-foreground sm:inline">
                      {siteHost(service.url)}
                    </span>
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {kind.label}
                    </span>
                    {usedBy ? (
                      <ServiceUsers
                        sites={usedBy.sites.filter((site) => site.serviceIds.includes(service.id))}
                        onOpenSite={usedBy.onOpenSite}
                      />
                    ) : null}
                  </div>
                  <LibraryStateBadge tone={state.tone}>
                    {health.state === "healthy" || health.state === "failing"
                      ? `${health.passing} of ${health.total} passing`
                      : state.label}
                  </LibraryStateBadge>
                  <Menu>
                    <MenuTrigger
                      render={
                        <Button
                          shape="pill"
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Actions for ${service.name}`}
                        />
                      }
                    >
                      <EllipsisIcon />
                    </MenuTrigger>
                    <MenuPopup side="bottom" align="end">
                      <MenuItem disabled={!canManage} onClick={() => onAddCheck(service)}>
                        <PlusIcon />
                        Add check
                      </MenuItem>
                      <MenuSeparator />
                      <MenuItem disabled={!canManage} onClick={() => onEditService(service)}>
                        <PencilIcon />
                        {paused && !activeToggle ? "Edit or resume service" : "Edit service"}
                      </MenuItem>
                      {activeToggle ? (
                        <MenuItem
                          disabled={!canManage || activeToggle.pending === `service:${service.id}`}
                          onClick={() => activeToggle.toggle({ kind: "service", row: service })}
                        >
                          {paused ? <PlayIcon /> : <PauseIcon />}
                          {paused ? "Resume service" : "Pause service"}
                        </MenuItem>
                      ) : null}
                    </MenuPopup>
                  </Menu>
                </div>
              </td>
            </tr>
            {checks.length ? (
              orderChecksForAttention(checks, snapshot.staleAfterSeconds, now).map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  muted={paused}
                  staleAfterSeconds={snapshot.staleAfterSeconds}
                  now={now}
                  canManage={canManage}
                  manageHint={manageHint}
                  activeToggle={activeToggle}
                  onEdit={() => onEditCheck(check)}
                />
              ))
            ) : (
              <tr>
                <td colSpan={ENDPOINT_COLUMNS.length} className="py-2 ps-13 pe-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-xs text-muted-foreground">
                      Nothing watches this service yet. Add a check to know when it stops answering.
                    </p>
                    <ActionHint hint={canManage ? null : manageHint}>
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
                    </ActionHint>
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </LibraryTable>
  );
}

/** The sites a shared service backs, as quiet links that never crowd the group's heading. */
function ServiceUsers({
  sites,
  onOpenSite,
}: {
  readonly sites: readonly Site[];
  readonly onOpenSite: (siteId: string) => void;
}) {
  if (!sites.length) {
    return <span className="text-xs text-muted-foreground/75">Not used by a site</span>;
  }
  const shown = sites.slice(0, MAX_SERVICE_USERS);
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
      Used by
      {shown.map((site, index) => (
        <span key={site.id} className="min-w-0 truncate">
          <button
            type="button"
            onClick={() => onOpenSite(site.id)}
            className="rounded-sm font-medium text-foreground/85 underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {site.name}
          </button>
          {index < shown.length - 1 ? "," : null}
        </span>
      ))}
      {sites.length > MAX_SERVICE_USERS ? (
        <span className="tabular-nums">+{sites.length - MAX_SERVICE_USERS}</span>
      ) : null}
    </span>
  );
}

function CheckRow({
  check,
  muted,
  staleAfterSeconds,
  now,
  canManage,
  manageHint,
  activeToggle,
  onEdit,
}: {
  readonly check: Check;
  /** Its service is paused, so its rows recede with it. */
  readonly muted: boolean;
  readonly staleAfterSeconds: number;
  readonly now: number;
  readonly canManage: boolean;
  readonly manageHint: string | null | undefined;
  readonly activeToggle: ActiveToggle | undefined;
  readonly onEdit: () => void;
}) {
  const state = siteCheckState(check, staleAfterSeconds, now);
  const presentation = SITE_CHECK_STATES[state];
  const last = check.last;
  const problem = checkProblem(check, state);
  return (
    <tr
      className={cn(
        "transition-colors duration-150 hover:bg-accent/40",
        (muted || state === "disabled") && "text-muted-foreground",
      )}
    >
      <td className={cn(LIBRARY_CELL, "py-2 ps-5")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <LibraryStateDot tone={presentation.tone} />
          <div className="min-w-0">
            <p className="truncate font-medium">{check.name}</p>
            <p className="flex min-w-0 items-baseline gap-1.5 text-xs">
              <span className="max-w-48 shrink-0 truncate font-mono text-muted-foreground">
                {sitePath(check.url)}
              </span>
              <span aria-hidden className="text-muted-foreground/60">
                ·
              </span>
              {problem ? (
                <span className="min-w-0 text-destructive-foreground wrap-anywhere">{problem}</span>
              ) : (
                <span className="min-w-0 truncate text-muted-foreground">
                  {checkExpectation(check)}
                </span>
              )}
            </p>
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
          <span className="text-xs text-muted-foreground">
            {state === "disabled" ? "Paused" : "Waiting"}
          </span>
        )}
      </td>
      <td className={cn(LIBRARY_CELL, "hidden text-xs md:table-cell")}>
        <CertificateLabel days={siteTlsDaysLeft(last?.tls_expires_at, now)} />
      </td>
      <td className={cn(LIBRARY_CELL, "hidden text-xs text-muted-foreground lg:table-cell")}>
        {last ? (
          <time dateTime={last.checked_at}>{formatRelativeTimeLabel(last.checked_at, now)}</time>
        ) : (
          "Never"
        )}
      </td>
      <td className={cn(LIBRARY_CELL, "py-1.5 text-end")}>
        {activeToggle ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  shape="pill"
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Actions for check ${check.name}`}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup side="bottom" align="end">
              <MenuItem disabled={!canManage} onClick={onEdit}>
                <PencilIcon />
                Edit check
              </MenuItem>
              <MenuItem
                disabled={!canManage || activeToggle.pending === `check:${check.id}`}
                onClick={() => activeToggle.toggle({ kind: "check", row: check })}
              >
                {check.active ? <PauseIcon /> : <PlayIcon />}
                {check.active ? "Pause check" : "Resume check"}
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : (
          <ActionHint hint={canManage ? null : manageHint}>
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
          </ActionHint>
        )}
      </td>
    </tr>
  );
}
