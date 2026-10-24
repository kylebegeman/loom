import type { SiteAnalytics, SitesSnapshot } from "@t3tools/contracts/fork";
import type { LibraryWorkflowTone } from "./library-workflows.ts";

type SiteCheck = SitesSnapshot["checks"][number];

/** A previously healthy observation must not stay green while a client is offline. */
export function siteCheckState(check: SiteCheck, staleAfterSeconds: number, now: number) {
  if (check.state === "disabled") return "disabled";
  if (!check.last) return "unknown";
  const checkedAt = Date.parse(check.last.checked_at);
  if (!Number.isFinite(checkedAt) || now - checkedAt > staleAfterSeconds * 1000) return "stale";
  return check.state;
}

export type SiteCheckState = ReturnType<typeof siteCheckState>;

export const SITE_CHECK_STATES: Record<
  SiteCheckState,
  { readonly label: string; readonly tone: LibraryWorkflowTone }
> = {
  healthy: { label: "Healthy", tone: "success" },
  failing: { label: "Failing", tone: "danger" },
  stale: { label: "Out of date", tone: "warning" },
  unknown: { label: "Not checked yet", tone: "neutral" },
  disabled: { label: "Paused", tone: "neutral" },
};

export type SiteHealthState =
  | "failing"
  | "stale"
  | "healthy"
  | "unchecked"
  | "unmonitored"
  | "paused";

export const SITE_HEALTH_STATES: Record<
  SiteHealthState,
  { readonly label: string; readonly tone: LibraryWorkflowTone }
> = {
  failing: { label: "Failing", tone: "danger" },
  stale: { label: "Out of date", tone: "warning" },
  healthy: { label: "Healthy", tone: "success" },
  unchecked: { label: "Not checked yet", tone: "neutral" },
  unmonitored: { label: "No checks", tone: "neutral" },
  paused: { label: "Paused", tone: "neutral" },
};

export type SiteHealth = {
  readonly state: SiteHealthState;
  /** Checks that are not paused. */
  readonly total: number;
  readonly passing: number;
  readonly failing: number;
};

/**
 * The worst current state across checks, so one failing endpoint is never averaged away. Paused
 * checks are left out of the count; they say nothing about whether the site is up.
 */
export function siteChecksHealth(
  checks: readonly SiteCheck[],
  staleAfterSeconds: number,
  now: number,
  paused = false,
): SiteHealth {
  let total = 0;
  let passing = 0;
  let failing = 0;
  let stale = 0;
  for (const check of checks) {
    const state = siteCheckState(check, staleAfterSeconds, now);
    if (state === "disabled") continue;
    total += 1;
    if (state === "healthy") passing += 1;
    else if (state === "failing") failing += 1;
    else if (state === "stale") stale += 1;
  }
  const state: SiteHealthState = paused
    ? "paused"
    : !total
      ? "unmonitored"
      : failing
        ? "failing"
        : stale
          ? "stale"
          : passing === total
            ? "healthy"
            : "unchecked";
  return { state, total, passing, failing };
}

/** A site's health across the checks of every service it uses. */
export function siteHealth(
  site: SitesSnapshot["sites"][number],
  snapshot: Pick<SitesSnapshot, "checks" | "staleAfterSeconds">,
  now: number,
) {
  return siteChecksHealth(
    snapshot.checks.filter((check) => site.serviceIds.includes(check.service_id)),
    snapshot.staleAfterSeconds,
    now,
    !site.active,
  );
}

/** Certificates closer than this to expiry are worth a person's attention. */
export const SITE_TLS_WARNING_DAYS = 14;

const DAY_MS = 86_400_000;

/** Whole days until a certificate expires; negative once it has. */
export function siteTlsDaysLeft(expiresAt: string | null | undefined, now: number) {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) ? Math.floor((at - now) / DAY_MS) : null;
}

/**
 * Every day of the analytics window, quiet days included, so a chart's gaps read as no traffic
 * rather than as days that never happened.
 */
export function siteTrafficDays(
  analytics: Pick<SiteAnalytics, "since" | "days" | "byDay">,
): readonly { readonly day: string; readonly pageviews: number; readonly visitors: number }[] {
  const start = Date.parse(`${analytics.since.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(start)) return analytics.byDay;
  const recorded = new Map(analytics.byDay.map((entry) => [entry.day.slice(0, 10), entry]));
  return Array.from({ length: analytics.days }, (_, index) => {
    const day = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    const entry = recorded.get(day);
    return { day, pageviews: entry?.pageviews ?? 0, visitors: entry?.visitors ?? 0 };
  });
}
