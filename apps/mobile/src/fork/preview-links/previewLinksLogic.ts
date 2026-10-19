import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId, ExecutionEnvironmentCapabilities } from "@t3tools/contracts";
import {
  PREVIEW_LINKS_FEATURE,
  type PreviewLink,
  type PreviewLinkLifetime,
  type PreviewLinksSetup,
} from "@t3tools/contracts/fork";

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
    .map(({ environmentId, label }) => ({ environmentId, label }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.environmentId.localeCompare(right.environmentId),
    );
}

/**
 * Computers to ask for an entry link to a URL from a message. The thread's own computer most
 * likely serves it, so it goes first; the rest follow in display order.
 */
export function previewOpenCandidates(
  computers: ReadonlyArray<PreviewComputer>,
  preferred: EnvironmentId | null,
): ReadonlyArray<EnvironmentId> {
  const ids = computers.map((computer) => computer.environmentId);
  if (preferred === null || !ids.includes(preferred)) return ids;
  return [preferred, ...ids.filter((id) => id !== preferred)];
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
  now: number,
): ReadonlyArray<PreviewLink> {
  const open = links
    .filter((link) => link.state === "open")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const ended = links
    .filter((link) => link.state !== "open" && canRestorePreviewLink(link, now))
    .sort((left, right) => endedAt(right) - endedAt(left));
  return [...open, ...ended];
}

export function canRestorePreviewLink(link: PreviewLink, now: number): boolean {
  return (
    link.state !== "open" && link.restorableUntil !== null && Date.parse(link.restorableUntil) > now
  );
}

function endedAt(link: PreviewLink): number {
  return Date.parse(link.endedAt ?? link.expiresAt);
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Whole units, rounded down: `3h 12m`, `45m`, `2d 4h`. */
export function formatPreviewDuration(ms: number): string {
  if (ms < MINUTE_MS) return "under a minute";
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m`;
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

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

/** Copy needs no permission: the canonical link only opens for someone who entered from Loom. */
export function previewLinkActions(
  link: PreviewLink,
  permissions: PreviewLinkPermissions,
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
    { action: "restore", enabled: permissions.restore && canRestorePreviewLink(link, now) },
    { action: "copy", enabled: true },
  ];
}

export const PREVIEW_LIFETIME_LABELS: Record<PreviewLinkLifetime, string> = {
  "1h": "1 hour",
  "12h": "12 hours",
  "24h": "24 hours",
};
