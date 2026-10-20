import type { EnvironmentId } from "@t3tools/contracts";
import type {
  DirectoryEnvironment,
  DirectoryListing,
  DirectoryMachine,
  DirectoryRoute,
  LoomIdentityMetadata,
} from "@t3tools/contracts/fork";
import { isDirectoryRouteUrl } from "@t3tools/shared/fork/directory";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A report this recent counts as now, matching the Library's `LIBRARY_COMPUTER_ONLINE_WINDOW`.
 * Recent never means online: only a connection from this device says that.
 */
export const DIRECTORY_REPORT_RECENT_MS = 2 * MINUTE_MS;

/** "just now", "2 min ago", "3 hours ago" or "2 days ago". */
export function directoryAgeText(ageMs: number): string {
  const age = Math.max(0, ageMs);
  if (age < MINUTE_MS) return "just now";
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min ago`;
  if (age < DAY_MS) {
    const hours = Math.floor(age / HOUR_MS);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  const days = Math.floor(age / DAY_MS);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** How long ago a computer last reported, never whether it is online. */
export interface DirectoryProofAge {
  readonly reportedAt: string;
  readonly ageMs: number;
  /** Reported within `DIRECTORY_REPORT_RECENT_MS`. */
  readonly recent: boolean;
  /** For example "Reported 2 min ago". */
  readonly text: string;
}

export function directoryProofAge(reportedAt: string, now: number): DirectoryProofAge | null {
  const at = Date.parse(reportedAt);
  if (!Number.isFinite(at)) return null;
  // A computer whose clock runs ahead reads as just now, not as a report from the future.
  const ageMs = Math.max(0, now - at);
  return {
    reportedAt,
    ageMs,
    recent: ageMs <= DIRECTORY_REPORT_RECENT_MS,
    text: `Reported ${directoryAgeText(ageMs)}`,
  };
}

const ROUTE_ORDER: Record<DirectoryRoute["kind"], number> = { public: 0, tailnet: 1 };

/**
 * The routes a client may use from a report: DNS names over HTTPS only, each URL once, public
 * before tailnet. Applied to every listing, because a cached or malformed one is not trusted.
 */
export function directoryRoutes(routes: readonly DirectoryRoute[]): readonly DirectoryRoute[] {
  const seen = new Set<string>();
  const kept: DirectoryRoute[] = [];
  for (const route of routes) {
    if (route.kind !== "public" && route.kind !== "tailnet") continue;
    if (!isDirectoryRouteUrl(route.url) || seen.has(route.url)) continue;
    seen.add(route.url);
    kept.push({ kind: route.kind, url: route.url });
  }
  return kept.sort((left, right) => ROUTE_ORDER[left.kind] - ROUTE_ORDER[right.kind]);
}

const isNewerReport = (candidate: DirectoryEnvironment, current: DirectoryEnvironment) =>
  candidate.sequence !== current.sequence
    ? candidate.sequence > current.sequence
    : Date.parse(candidate.receivedAt) > Date.parse(current.receivedAt);

/**
 * One entry per environment, the newest report winning, with only usable routes. The directory
 * keeps one row per environment, but a client never relies on that.
 */
export function directoryEnvironments(listing: DirectoryListing): readonly DirectoryEnvironment[] {
  const newest = new Map<EnvironmentId, DirectoryEnvironment>();
  for (const environment of listing.environments) {
    const current = newest.get(environment.environmentId);
    if (current === undefined || isNewerReport(environment, current)) {
      newest.set(environment.environmentId, environment);
    }
  }
  return [...newest.values()].map((environment) => ({
    ...environment,
    routes: directoryRoutes(environment.routes),
  }));
}

/** What a client needs from a saved connection to merge it with the directory. */
export interface DirectorySavedConnection {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

/** A verified report without its routes, which only discovered rows carry. */
export type DirectoryCatalogReport = Omit<DirectoryEnvironment, "routes">;

export interface DirectoryCatalogRow<
  Saved extends DirectorySavedConnection = DirectorySavedConnection,
> {
  readonly environmentId: EnvironmentId;
  /** The saved connection's label when there is one, otherwise the reported label. */
  readonly label: string;
  /** This device's saved connection, exactly as passed in. Null for a discovered computer. */
  readonly saved: Saved | null;
  /** The directory's latest report, or null when the directory does not list this computer. */
  readonly report: DirectoryCatalogReport | null;
  /**
   * Directory routes for a discovered computer, public first. Always empty for a saved
   * connection, which keeps the routes it has: the directory never changes them.
   */
  readonly routes: readonly DirectoryRoute[];
  /** LoomOS machines this computer's report carried. */
  readonly machines: readonly DirectoryMachine[];
  /** Connected from this device now. The only thing that makes a row online. */
  readonly connected: boolean;
  readonly proof: DirectoryProofAge | null;
  /** Set on a discovered computer with a route to try; see `directoryConnectPlan`. */
  readonly action: "connect" | null;
}

/**
 * Merges the directory with this device's saved connections: one row per environment id. Saved
 * connections come first in their own order and only gain the directory's annotations. Unsaved
 * computers follow by label as discovered rows. Pass a null listing while none is known.
 */
export function directoryCatalogRows<Saved extends DirectorySavedConnection>(input: {
  readonly listing: DirectoryListing | null;
  readonly saved: readonly Saved[];
  readonly connected: Iterable<EnvironmentId>;
  readonly now: number;
}): readonly DirectoryCatalogRow<Saved>[] {
  const connected = new Set(input.connected);
  const environments = input.listing === null ? [] : directoryEnvironments(input.listing);
  const reports = new Map(
    environments.map((environment) => [environment.environmentId, environment]),
  );
  const machinesBy = new Map<EnvironmentId, DirectoryMachine[]>();
  for (const machine of input.listing?.machines ?? []) {
    machinesBy.set(machine.reportedBy, [...(machinesBy.get(machine.reportedBy) ?? []), machine]);
  }
  const annotate = (environment: DirectoryEnvironment | undefined) => {
    if (environment === undefined) return { report: null, proof: null };
    const { routes: _routes, ...report } = environment;
    return { report, proof: directoryProofAge(environment.reportedAt, input.now) };
  };

  const savedIds = new Set<EnvironmentId>();
  const rows: DirectoryCatalogRow<Saved>[] = [];
  for (const saved of input.saved) {
    if (savedIds.has(saved.environmentId)) continue;
    savedIds.add(saved.environmentId);
    rows.push({
      environmentId: saved.environmentId,
      label: saved.label,
      saved,
      ...annotate(reports.get(saved.environmentId)),
      routes: [],
      machines: machinesBy.get(saved.environmentId) ?? [],
      connected: connected.has(saved.environmentId),
      action: null,
    });
  }
  const discovered = environments
    .filter((environment) => !savedIds.has(environment.environmentId))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.environmentId.localeCompare(right.environmentId),
    );
  for (const environment of discovered) {
    rows.push({
      environmentId: environment.environmentId,
      label: environment.label,
      saved: null,
      ...annotate(environment),
      routes: environment.routes,
      machines: machinesBy.get(environment.environmentId) ?? [],
      connected: connected.has(environment.environmentId),
      action: environment.routes.length > 0 ? "connect" : null,
    });
  }
  return rows;
}

/**
 * Machines whose reporting computer the listing no longer has, for example after that computer
 * was forgotten. They attach to no row, so a client lists them on their own to forget them.
 */
export function directoryUnattachedMachines(
  listing: DirectoryListing,
): readonly DirectoryMachine[] {
  const environments = new Set(
    listing.environments.map((environment) => environment.environmentId),
  );
  return listing.machines.filter((machine) => !environments.has(machine.reportedBy));
}

/** A browser signs in through the computer's login page; desktop and mobile sign in natively. */
export type DirectorySignInSurface = "browser" | "native";

export interface DirectoryConnectPlan {
  readonly environmentId: EnvironmentId;
  /** Directory routes to try in order: public first, then tailnet. */
  readonly routes: readonly DirectoryRoute[];
  /**
   * Loom Identity when the computer advertises it for this surface, pairing otherwise. The
   * directory never issues a credential, so either way the computer's own sign-in decides.
   */
  readonly signIn: "loom-identity" | "pairing";
}

function offersLoomIdentity(
  identity: LoomIdentityMetadata,
  environmentId: EnvironmentId,
  surface: DirectorySignInSurface,
): boolean {
  // Metadata from another environment means the route reaches some other computer, so signing in
  // there would hand that computer a session meant for this one.
  if (!identity.enabled || identity.environmentId !== environmentId) return false;
  if (identity.authorizationEndpoint === null || identity.tokenEndpoint === null) return false;
  return surface === "browser"
    ? identity.browserLoginEnabled && identity.clientId !== null && identity.issuer !== null
    : identity.nativeClientId !== undefined && identity.nativeClientId.length > 0;
}

/**
 * How to connect to a discovered computer. Read the identity metadata from the plan's first route
 * and plan again with it; before that, or when it is missing, the plan is pairing. Null for a
 * saved connection or a computer with no usable route.
 */
export function directoryConnectPlan(
  row: DirectoryCatalogRow,
  identity: LoomIdentityMetadata | null,
  surface: DirectorySignInSurface,
): DirectoryConnectPlan | null {
  if (row.saved !== null || row.action !== "connect") return null;
  const routes = directoryRoutes(row.routes);
  if (routes.length === 0) return null;
  return {
    environmentId: row.environmentId,
    routes,
    signIn:
      identity !== null && offersLoomIdentity(identity, row.environmentId, surface)
        ? "loom-identity"
        : "pairing",
  };
}
