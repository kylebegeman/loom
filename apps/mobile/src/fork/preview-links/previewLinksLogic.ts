import { formatPreviewDuration, supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import {
  PREVIEW_LINKS_FEATURE,
  PREVIEW_PAGES_FEATURE,
  isCurrentPreviewHost,
  type PreviewLink,
  type PreviewLinkLifetime,
  type PreviewLinksSettings,
  type PreviewLinksSetup,
} from "@t3tools/contracts/fork";
import { isLocalLoopbackHost, isPrivateNetworkHost } from "@t3tools/shared/hostClassification";

export interface PreviewComputerSource {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly entry: { readonly enabled: boolean };
  readonly connection: { readonly phase: string };
  readonly serverConfig: {
    readonly environment: { readonly capabilities: ExecutionEnvironmentCapabilities };
  } | null;
}

export interface PreviewComputer {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  /** Whether its server relays the pages it published to its Library. */
  readonly pages: boolean;
}

/** Connected computers whose server can share previews, in a stable order. */
export function previewComputers(
  environments: ReadonlyArray<PreviewComputerSource>,
): ReadonlyArray<PreviewComputer> {
  return environments
    .filter(
      (environment) =>
        environment.entry.enabled &&
        environment.connection.phase === "connected" &&
        supportsLoomFeature(
          environment.serverConfig?.environment.capabilities,
          PREVIEW_LINKS_FEATURE,
        ),
    )
    .map(({ environmentId, label, serverConfig }) => ({
      environmentId,
      label,
      pages: supportsLoomFeature(serverConfig?.environment.capabilities, PREVIEW_PAGES_FEATURE),
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.environmentId.localeCompare(right.environmentId),
    );
}

export interface PreviewSetupStatus {
  readonly label: string;
  readonly detail: string | null;
  readonly ready: boolean;
}

export function previewSetupStatus(setup: PreviewLinksSetup): PreviewSetupStatus {
  const { settings, tunnel, gateway } = setup;
  if (!settings.enabled) return { label: "Previews off", detail: null, ready: false };
  if (settings.suffix === null) return { label: "Needs a domain", detail: null, ready: false };
  if (gateway.state === "error") {
    return { label: "Gateway error", detail: gateway.message, ready: false };
  }
  switch (tunnel.state) {
    case "connected":
      return { label: `Ready on ${settings.suffix}`, detail: null, ready: true };
    case "needs-token":
      return { label: "Needs a tunnel token", detail: tunnel.message, ready: false };
    case "starting":
      return { label: "Tunnel starting", detail: tunnel.message, ready: false };
    case "error":
      return { label: "Tunnel error", detail: tunnel.message, ready: false };
    case "off":
      return { label: "Tunnel off", detail: tunnel.message, ready: false };
  }
}

/** Links that are open or can still be restored: open first, then the most recently ended. */
export function visiblePreviewLinks(
  links: ReadonlyArray<PreviewLink>,
  settings: PreviewLinksSettings,
  now: number,
): ReadonlyArray<PreviewLink> {
  const open = links
    .filter((link) => link.state === "open")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const ended = links
    .filter((link) => canRestorePreviewLink(link, settings, now))
    .sort((left, right) => endedAt(right) - endedAt(left));
  return [...open, ...ended];
}

/** A link made under another domain or computer name has no address here until settings change back. */
export function canRestorePreviewLink(
  link: PreviewLink,
  settings: PreviewLinksSettings,
  now: number,
): boolean {
  return (
    link.state !== "open" &&
    link.restorableUntil !== null &&
    Date.parse(link.restorableUntil) > now &&
    isCurrentPreviewHost(link.host, settings)
  );
}

function endedAt(link: PreviewLink): number {
  return Date.parse(link.endedAt ?? link.expiresAt);
}

const MINUTE_MS = 60_000;

export function previewLinkTiming(link: PreviewLink, now: number): string {
  if (link.state === "open") {
    const left = Date.parse(link.expiresAt) - now;
    return left <= 0 ? "Ending now" : `Ends in ${formatPreviewDuration(left)}`;
  }
  const verb = link.state === "expired" ? "Expired" : "Ended";
  const ago = Math.max(0, now - endedAt(link));
  return ago < MINUTE_MS ? `${verb} just now` : `${verb} ${formatPreviewDuration(ago)} ago`;
}

export function previewLinkSummary(link: PreviewLink, now: number): string {
  const owner = link.createdBy === "agent" ? "Agent" : "You";
  return `Port ${link.port} · ${owner} · ${previewLinkTiming(link, now)}`;
}

export type PreviewLinkAction = "open" | "copy" | "extend" | "end" | "restore";

export interface PreviewLinkPermissions {
  readonly open: boolean;
  readonly extend: boolean;
  readonly end: boolean;
  readonly restore: boolean;
}

export interface PreviewLinkActionAvailability {
  readonly action: PreviewLinkAction;
  readonly enabled: boolean;
}

/**
 * Copy needs no permission: the canonical link only opens for someone who entered from Loom or
 * signed in to the Library.
 */
export function previewLinkActions(
  link: PreviewLink,
  permissions: PreviewLinkPermissions,
  settings: PreviewLinksSettings,
  now: number,
): ReadonlyArray<PreviewLinkActionAvailability> {
  if (link.state === "open") {
    return [
      { action: "open", enabled: permissions.open },
      { action: "copy", enabled: true },
      { action: "extend", enabled: permissions.extend },
      { action: "end", enabled: permissions.end },
    ];
  }
  return [
    {
      action: "restore",
      enabled: permissions.restore && canRestorePreviewLink(link, settings, now),
    },
    { action: "copy", enabled: true },
  ];
}

export const PREVIEW_LIFETIME_LABELS: Record<PreviewLinkLifetime, string> = {
  "1h": "1 hour",
  "12h": "12 hours",
  "24h": "24 hours",
};

const parseBaseUrl = (httpBaseUrl: string): URL | null => {
  try {
    return new URL(httpBaseUrl);
  } catch {
    return null;
  }
};

/**
 * A phone reaches a computer's loopback only as a simulator talking to its own Mac. Until there
 * is a connection to judge, the URL is left for the open itself to report.
 */
export function connectionReachesLoopback(httpBaseUrl: string | null): boolean {
  const base = httpBaseUrl === null ? null : parseBaseUrl(httpBaseUrl);
  return base === null || isLocalLoopbackHost(base.hostname);
}

/** The port on the computer's private network address, which a phone on that network reaches. */
export function privateNetworkPortUrl(httpBaseUrl: string | null, url: URL): string | null {
  const base = httpBaseUrl === null ? null : parseBaseUrl(httpBaseUrl);
  if (base === null || !isPrivateNetworkHost(base.hostname)) return null;
  const mapped = new URL(url.href);
  mapped.hostname = base.hostname;
  return mapped.href;
}
