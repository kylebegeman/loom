import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ProviderDriverKind,
} from "@t3tools/contracts";
import type { DirectoryListing } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";

import { connectionRoutes } from "../connection/routes.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import * as Option from "effect/Option";

import type { EnvironmentConnectionPresentation } from "../connection/presentation.ts";
import { directoryAgeText, directoryEnvironments, directoryProofAge } from "./directory.ts";

/**
 * How long a computer may keep failing before clients stop showing progress for it. Shorter
 * drops still read as reconnecting; past this a spinner would promise a connection that is not
 * coming.
 */
export const CONNECTION_STALL_MS = 60_000;

type FailingConnection = Pick<EnvironmentConnectionPresentation, "phase" | "failingSince">;

/** When `connection` counts as stalled, or null while it is not failing to connect. */
export function connectionStallAt(connection: FailingConnection): number | null {
  if (connection.phase !== "connecting" && connection.phase !== "reconnecting") return null;
  return connection.failingSince === undefined
    ? null
    : connection.failingSince + CONNECTION_STALL_MS;
}

export function isConnectionStalled(connection: FailingConnection, now: number): boolean {
  const at = connectionStallAt(connection);
  return at !== null && now >= at;
}

/** "3:04 PM" on the same day, "Oct 24, 3:04 PM" on another. */
export function connectionFailingSinceText(failingSince: number, now: number): string {
  const since = DateTime.toDate(DateTime.makeUnsafe(failingSince));
  return since.toDateString() === DateTime.toDate(DateTime.makeUnsafe(now)).toDateString()
    ? since.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : since.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** "Can't reach Dorothy since 3:04 PM". Pair it with `CONNECTION_STALL_DETAIL`. */
export function connectionStallTitle(label: string, failingSince: number, now: number): string {
  return `Can't reach ${label} since ${connectionFailingSinceText(failingSince, now)}`;
}

export const CONNECTION_STALL_DETAIL = "Loom keeps trying.";

/** What the Library last heard from a computer, independent of this device's connection. */
export interface ComputerDirectoryHealth {
  /** A recent live report, or the age of older or cached evidence. */
  readonly text: string;
  /** For example "Codex needs attention on Dorothy.", or null. */
  readonly attention: string | null;
}

const providerName = (id: string) => PROVIDER_DISPLAY_NAMES[id as ProviderDriverKind] ?? id;

// Not Intl.ListFormat, which Hermes lacks.
const listText = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** A cached report gives history, never evidence that the computer is reporting now. */
export function computerDirectoryHealth(input: {
  readonly listing: DirectoryListing;
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly now: number;
  readonly source?: "live" | "cache";
}): ComputerDirectoryHealth | null {
  const report = directoryEnvironments(input.listing).find(
    (environment) => environment.environmentId === input.environmentId,
  );
  const proof = report === undefined ? null : directoryProofAge(report.reportedAt, input.now);
  if (report === undefined || proof === null) return null;
  const attention = report.providers
    .filter((provider) => provider.status === "error" || provider.status === "warning")
    .map((provider) => providerName(provider.id));
  return {
    text:
      proof.recent && input.source !== "cache"
        ? `Reporting normally, last seen ${directoryAgeText(proof.ageMs)}.`
        : `Last reported ${directoryAgeText(proof.ageMs)}.`,
    attention:
      attention.length === 0
        ? null
        : `${listText(attention)} ${attention.length === 1 ? "needs" : "need"} attention on ${input.label}.`,
  };
}

/** A route label alone cannot prove Tailscale: only the catalog's explicit network marker can. */
export function tailnetOnlyConnectionHint(
  entry: ConnectionCatalogEntry,
  connection: Pick<EnvironmentConnectionPresentation, "phase" | "failingSince" | "blockedReason">,
): string | null {
  if (
    !entry.enabled ||
    connection.blockedReason !== undefined ||
    (connection.phase !== "reconnecting" &&
      !(connection.phase === "connecting" && connection.failingSince !== undefined))
  )
    return null;
  const routes = connectionRoutes(entry);
  return routes.length > 0 &&
    routes.every((route) => {
      const profile = Option.getOrNull(route.profile);
      return profile?._tag === "BearerConnectionProfile" && profile.network === "tailscale";
    })
    ? "Turn on Tailscale on this device."
    : null;
}
