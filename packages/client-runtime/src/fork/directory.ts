import { DIRECTORY_WS_METHODS, type DirectoryReporting } from "@t3tools/contracts/fork";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "../state/runtime.ts";
import { AsyncResult, Atom } from "effect/reactivity";

const idleReporting = Atom.make(AsyncResult.initial<DirectoryReporting, unknown>());
export function createDirectoryReportingAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const reporting = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "loom:directory:reporting",
    tag: DIRECTORY_WS_METHODS.reporting,
    staleTimeMs: 15_000,
  });
  return (
    environmentId: EnvironmentId | null,
  ): Atom.Atom<AsyncResult.AsyncResult<DirectoryReporting, unknown>> =>
    environmentId === null ? idleReporting : reporting({ environmentId, input: {} });
}

export function directoryReportingText(report: DirectoryReporting): readonly string[] {
  const routes = report.routes;
  const lines = [
    routes === undefined
      ? "Your Library lists this computer at: not reported yet"
      : `Your Library lists this computer at: ${routes.length === 0 ? "none" : routes.map((route) => route.url).join(", ")}`,
    `Directory reporting: ${report.state}.`,
  ];
  if (routes?.length === 0)
    lines.push(
      "Turn on Tailscale HTTPS or Reach from anywhere on this computer so other devices can find it. You can also pair a device using a reachable address.",
    );
  const signIn = report.signIn;
  if (signIn?.expiresAt) {
    // fork: library-renewal-status - older servers omit renewedAt
    const renewal =
      signIn.renewal !== "automatic" || signIn.state === "expired"
        ? ""
        : signIn.renewedAt === undefined
          ? " Renews automatically."
          : signIn.renewedAt === null
            ? signIn.renewsAt
              ? ` First renewal scheduled for ${signIn.renewsAt}.`
              : ""
            : ` Last renewed ${signIn.renewedAt}.${signIn.renewsAt ? ` Next renewal ${signIn.renewsAt}.` : ""}`;
    lines.push(
      `Library sign-in ${signIn.state === "expired" ? "expired" : "expires"} ${signIn.expiresAt}.${renewal}`,
    );
  }
  if (signIn?.repair) lines.push(signIn.repair);
  else if (report.state === "signed-out")
    lines.push(
      "Your Library refused this computer's sign-in. Ask its administrator to replace the publisher credential on this computer. Loom reloads it automatically.",
    );
  return lines;
}

// fork: background-check-health
const BACKGROUND_CHECK_NAMES: Readonly<Record<string, string>> = {
  "tailscale-cli": "Tailscale CLI",
  "tailscale-serve": "Tailscale Serve",
  "directory-reporting": "Directory reporting",
  "library-renewal": "Library sign-in renewal",
  "preview-registration": "Preview registration",
  "push-readiness": "Library push",
};

/** One line per recurring check that has failed since it last passed, kept across restarts. */
export function backgroundCheckFailureText(report: DirectoryReporting): readonly string[] {
  return (report.failingChecks ?? []).map((failure) => {
    const name = BACKGROUND_CHECK_NAMES[failure.check] ?? failure.check;
    return failure.count === 1
      ? `${name} failed at ${failure.lastSeenAt}: ${failure.message}`
      : `${name} has failed ${failure.count} times since ${failure.firstSeenAt}, most recently at ${failure.lastSeenAt}: ${failure.message}`;
  });
}

import type { EnvironmentId } from "@t3tools/contracts";
import {
  type DirectoryEnvironment,
  type DirectoryListing,
  type DirectoryMachine,
  type DirectoryRoute,
  type LoomIdentityDirectoryAddresses,
  type LoomIdentityMetadata,
} from "@t3tools/contracts/fork";
import { isDirectoryRouteUrl } from "@t3tools/shared/fork/directory";
import {
  IDENTITY_RESOURCE_MISMATCH_TEXT,
  identityResourceRefusal,
} from "@t3tools/shared/fork/identity-grant";

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
/** A public reach address serves no browser sign-in, so a browser tries tailnet first. */
const BROWSER_ROUTE_ORDER: Record<DirectoryRoute["kind"], number> = { tailnet: 0, public: 1 };

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

function newestReports(
  environments: readonly DirectoryEnvironment[],
): readonly DirectoryEnvironment[] {
  const newest = new Map<EnvironmentId, DirectoryEnvironment>();
  for (const environment of environments) {
    const current = newest.get(environment.environmentId);
    if (current === undefined || isNewerReport(environment, current)) {
      newest.set(environment.environmentId, environment);
    }
  }
  return [...newest.values()];
}

/**
 * One entry per environment, the newest report winning, with only usable routes. The directory
 * keeps one row per environment, but a client never relies on that.
 */
export function directoryEnvironments(listing: DirectoryListing): readonly DirectoryEnvironment[] {
  return newestReports(listing.environments).map((environment) => ({
    ...environment,
    routes: directoryRoutes(environment.routes),
  }));
}

/** The Library as this device saved it: its name and every address it connects to it at. */
export interface IdentityDirectoryLibrary {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly addresses: readonly string[];
}

/**
 * What a native sign-in to a typed address checks with `identityAddressRefusal`: the Library's
 * own addresses, and every route of every kind in each computer's newest report. Unlike
 * `directoryEnvironments`, nothing is filtered out for being unusable here: a route the computer
 * reported is still one of its own addresses. Pass a null listing while none is known.
 */
export function identityDirectoryAddresses(input: {
  readonly library: IdentityDirectoryLibrary;
  readonly listing: DirectoryListing | null;
}): LoomIdentityDirectoryAddresses {
  const { library } = input;
  return {
    library: {
      environmentId: library.environmentId,
      label: library.label,
      addresses: [...new Set(library.addresses)],
    },
    computers: newestReports(input.listing?.environments ?? []).map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      addresses: [...new Set(environment.routes.map((route) => route.url))],
    })),
  };
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
  /** Discovered computers can connect through a route or open the pairing form. */
  readonly action: "connect" | "pair" | null;
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
      action: environment.routes.length > 0 ? "connect" : "pair",
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

/** How this client signs in. A browser page can sign in only where the computer allows its origin. */
export type DirectorySignIn =
  | { readonly surface: "native" }
  | { readonly surface: "browser"; readonly origin: string };

/** Why a discovered computer connects by pairing instead of Loom sign-in. */
export type DirectoryPairingReason =
  | "unreachable"
  | "no-sign-in"
  | "other-computer"
  | "not-here"
  | "library-issuer-unknown"
  | "issuer-mismatch"
  | "resource-mismatch"
  /** Only a public reach address answered, and a browser cannot sign in there. */
  | "reach-browser";

/** One short line per reason, for the row that offers pairing. */
export const DIRECTORY_PAIRING_REASON_TEXT: Readonly<Record<DirectoryPairingReason, string>> = {
  unreachable: "Loom could not reach this computer to check its sign-in.",
  "no-sign-in": "This computer does not offer Loom sign-in.",
  "other-computer": "The address Loom has for this computer reaches a different one.",
  "not-here": "This computer does not allow Loom sign-in from this app.",
  "library-issuer-unknown": "Loom could not confirm your Library's sign-in provider.",
  "issuer-mismatch": "This computer uses a different sign-in provider than your Library.",
  "resource-mismatch": IDENTITY_RESOURCE_MISMATCH_TEXT,
  "reach-browser": "Sign in from this browser on your home network, or pair it with a code.",
};

export interface DirectoryConnectPlan {
  readonly environmentId: EnvironmentId;
  /**
   * Directory routes to try in order. Native sign-in tries public first, then tailnet. A browser
   * tries tailnet first: a public reach address serves no browser sign-in.
   */
  readonly routes: readonly DirectoryRoute[];
  /**
   * Loom Identity when the computer offers it here under the Library's issuer, pairing otherwise.
   * The directory never issues a credential, so either way the computer's own sign-in decides.
   */
  readonly signIn: "loom-identity" | "pairing";
  /** Why the plan is pairing; null for Loom Identity. */
  readonly reason: DirectoryPairingReason | null;
}

export interface DirectoryConnectOptions {
  readonly signIn: DirectorySignIn;
  /** The Library's own Identity issuer, or null when this device does not know it. */
  readonly libraryIssuer: string | null;
}

function pairingReason(
  row: DirectoryCatalogRow,
  identity: LoomIdentityMetadata | null,
  options: DirectoryConnectOptions,
): DirectoryPairingReason | null {
  const { environmentId } = row;
  if (identity === null) return "no-sign-in";
  // Metadata from another environment means the route reaches some other computer, so signing in
  // there would hand that computer a session meant for this one.
  if (identity.environmentId !== environmentId) return "other-computer";
  if (
    !identity.enabled ||
    identity.issuer === null ||
    identity.authorizationEndpoint === null ||
    identity.tokenEndpoint === null
  )
    return "no-sign-in";
  const { signIn } = options;
  const offeredHere =
    identity.sessionExchangeEnabled === true &&
    (signIn.surface === "browser"
      ? identity.browserLoginEnabled &&
        identity.clientId !== null &&
        (identity.browserOrigins ?? []).includes(signIn.origin)
      : identity.nativeClientId !== undefined && identity.nativeClientId.length > 0);
  if (!offeredHere) return "not-here";
  // The client signs in with whatever issuer the computer names. The directory vouches for a
  // computer only under the Library's own issuer; anything else could send this device's passkey
  // sign-in to a provider the computer chose.
  if (options.libraryIssuer === null) return "library-issuer-unknown";
  if (identity.issuer !== options.libraryIssuer) return "issuer-mismatch";
  if (identityResourceRefusal(identity) !== null) return "resource-mismatch";
  return null;
}

/**
 * How to connect to a discovered computer, given the identity metadata one of its routes
 * returned (null when it has none). `resolveDirectoryConnect` reads the metadata and calls this.
 * Null for a saved connection or a computer with no usable route.
 */
export function directoryConnectPlan(
  row: DirectoryCatalogRow,
  identity: LoomIdentityMetadata | null,
  options: DirectoryConnectOptions,
): DirectoryConnectPlan | null {
  if (row.saved !== null || row.action !== "connect") return null;
  const order = options.signIn.surface === "browser" ? BROWSER_ROUTE_ORDER : ROUTE_ORDER;
  const routes = [...directoryRoutes(row.routes)].sort(
    (left, right) => order[left.kind] - order[right.kind],
  );
  if (routes.length === 0) return null;
  const reason = pairingReason(row, identity, options);
  return {
    environmentId: row.environmentId,
    routes,
    signIn: reason === null ? "loom-identity" : "pairing",
    reason,
  };
}
