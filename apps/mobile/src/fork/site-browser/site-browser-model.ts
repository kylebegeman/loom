import { supportsLoomFeature } from "@t3tools/client-runtime/fork";
import type { EnvironmentId } from "@t3tools/contracts";
import { PREVIEW_LINKS_FEATURE, SiteId, type SitesSnapshot } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";

import type { PreviewComputerSource } from "../preview-links/previewLinksLogic";

export type PinnedSites = Readonly<Record<string, readonly string[]>>;
export const SITE_PREVIEW_LIMIT = 3;
const isSiteId = Schema.is(SiteId);

export function sanitizePinnedSites(value: unknown): PinnedSites | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(
    Object.entries(value).flatMap(([authority, ids]) =>
      authority.trim().length > 0 && authority.length <= 200 && Array.isArray(ids)
        ? [[authority, [...new Set(ids.filter(isSiteId))]]]
        : [],
    ),
  );
}

export function togglePinnedSite(
  pinned: PinnedSites | undefined,
  authority: string,
  siteId: string,
): PinnedSites {
  const current = pinned?.[authority] ?? [];
  return {
    ...pinned,
    [authority]: current.includes(siteId)
      ? current.filter((id) => id !== siteId)
      : [...current, siteId],
  };
}

export function siteListSections(sites: SitesSnapshot["sites"], pinnedIds: readonly string[]) {
  const byId = new Map(sites.map((site) => [site.id, site]));
  const ids = new Set(pinnedIds);
  return {
    pinned: [...ids].flatMap((id) => {
      const site = byId.get(id);
      return site ? [site] : [];
    }),
    other: sites
      .filter((site) => !ids.has(site.id))
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
  };
}

export function siteFaviconUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? new URL("/favicon.ico", url.origin).toString()
      : null;
  } catch {
    return null;
  }
}

export function sitePreviewComputers(environments: readonly PreviewComputerSource[]) {
  return environments
    .filter(
      (environment) =>
        environment.entry.enabled &&
        supportsLoomFeature(
          environment.serverConfig?.environment.capabilities,
          PREVIEW_LINKS_FEATURE,
        ),
    )
    .map((environment) => ({
      environmentId: environment.environmentId,
      label: environment.label,
      connected: environment.connection.phase === "connected",
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.environmentId.localeCompare(right.environmentId),
    );
}

export type SitePreviewComputer = ReturnType<typeof sitePreviewComputers>[number];

export function previewUnavailableReason(
  environments: readonly PreviewComputerSource[],
  ready: boolean,
) {
  if (!ready) return "Loading computer capabilities…";
  const enabled = environments.filter((environment) => environment.entry.enabled);
  if (!enabled.length) return "Connect a computer to see live previews.";
  const connected = enabled.filter((environment) => environment.connection.phase === "connected");
  if (!connected.length) return "Reconnect a computer to load live previews.";
  return connected.some((environment) => environment.serverConfig === null)
    ? "Loading computer capabilities…"
    : "Update Loom on a connected computer to use private previews.";
}

export function selectedPreviewComputer(
  computers: readonly SitePreviewComputer[],
  selected: EnvironmentId | null,
) {
  return (
    computers.find((computer) => computer.environmentId === selected) ??
    computers.find((computer) => computer.connected) ??
    computers[0] ??
    null
  );
}
