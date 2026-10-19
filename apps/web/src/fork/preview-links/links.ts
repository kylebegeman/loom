import {
  PreviewLinkSuffix,
  PreviewMachineName,
  isCurrentPreviewHost,
  type PreviewLink,
  type PreviewLinkLifetime,
  type PreviewLinksSettings,
  type PreviewLinksSetup,
} from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

// Copy matches the mobile Previews screen so both clients describe a link the same way.

export const LIFETIME_LABELS: Record<PreviewLinkLifetime, string> = {
  "1h": "1 hour",
  "12h": "12 hours",
  "24h": "24 hours",
};

export interface SetupStatus {
  readonly label: string;
  readonly detail: string | null;
  readonly ready: boolean;
}

export function setupStatus(setup: PreviewLinksSetup): SetupStatus {
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

export function gatewayStatus(setup: PreviewLinksSetup): string {
  const { gateway, settings } = setup;
  switch (gateway.state) {
    case "listening":
      return `Listening on 127.0.0.1:${settings.gatewayPort}`;
    case "error":
      return gateway.message ?? "The gateway could not start.";
    case "off":
      return "Off";
  }
}

export function tunnelStatus(setup: PreviewLinksSetup): string {
  const { tunnel } = setup;
  const base = {
    connected: "Connected",
    starting: "Starting",
    "needs-token": "Needs a connector token",
    error: "Error",
    off: "Off",
  }[tunnel.state];
  return tunnel.message && tunnel.state !== "connected" ? `${base}: ${tunnel.message}` : base;
}

/** A link made under another domain or computer name has no address here until settings change back. */
function canRestore(link: PreviewLink, settings: PreviewLinksSettings, now: number): boolean {
  return (
    link.state !== "open" &&
    link.restorableUntil !== null &&
    Date.parse(link.restorableUntil) > now &&
    isCurrentPreviewHost(link.host, settings)
  );
}

const endedAt = (link: PreviewLink) => Date.parse(link.endedAt ?? link.expiresAt);

/** Open links newest first, then ended links that can still be restored, most recent first. */
export function visibleLinks(
  links: ReadonlyArray<PreviewLink>,
  settings: PreviewLinksSettings,
  now: number,
): ReadonlyArray<PreviewLink> {
  const open = links
    .filter((link) => link.state === "open")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const ended = links
    .filter((link) => canRestore(link, settings, now))
    .sort((left, right) => endedAt(right) - endedAt(left));
  return [...open, ...ended];
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Whole units, rounded down: `3h 12m`, `45m`, `2d 4h`. */
export function formatDuration(ms: number): string {
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

export function linkTiming(link: PreviewLink, now: number): string {
  if (link.state === "open") {
    const left = Date.parse(link.expiresAt) - now;
    return left <= 0 ? "Ending now" : `Ends in ${formatDuration(left)}`;
  }
  const verb = link.state === "expired" ? "Expired" : "Ended";
  const ago = Math.max(0, now - endedAt(link));
  return ago < MINUTE_MS ? `${verb} just now` : `${verb} ${formatDuration(ago)} ago`;
}

export function linkSummary(link: PreviewLink, now: number): string {
  const owner = link.createdBy === "agent" ? "Agent" : "You";
  return `Port ${link.port} · ${owner} · ${linkTiming(link, now)}`;
}

export interface SettingsDraft {
  readonly enabled: boolean;
  readonly suffix: string;
  readonly machine: string;
  readonly defaultLifetime: PreviewLinkLifetime;
  readonly gatewayPort: string;
}

export const draftFromSettings = (settings: PreviewLinksSettings): SettingsDraft => ({
  enabled: settings.enabled,
  suffix: settings.suffix ?? "",
  machine: settings.machine,
  defaultLifetime: settings.defaultLifetime,
  gatewayPort: String(settings.gatewayPort),
});

const isSuffix = Schema.is(PreviewLinkSuffix);
const isMachine = Schema.is(PreviewMachineName);

/** The settings to save, or the first problem to show next to Save. */
export function settingsFromDraft(
  draft: SettingsDraft,
): { readonly settings: PreviewLinksSettings } | { readonly problem: string } {
  const suffix = draft.suffix.trim().toLowerCase();
  const machine = draft.machine.trim().toLowerCase();
  const gatewayPort = Number(draft.gatewayPort.trim());
  if (suffix.length > 0 && !isSuffix(suffix)) {
    return { problem: "Use a domain you own, such as example.com." };
  }
  if (!isMachine(machine)) {
    return { problem: "Use up to 40 lowercase letters and digits for the computer name." };
  }
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1024 || gatewayPort > 65535) {
    return { problem: "Use a gateway port from 1024 to 65535." };
  }
  return {
    settings: {
      enabled: draft.enabled,
      suffix: suffix.length === 0 ? null : suffix,
      machine,
      defaultLifetime: draft.defaultLifetime,
      gatewayPort,
    },
  };
}
