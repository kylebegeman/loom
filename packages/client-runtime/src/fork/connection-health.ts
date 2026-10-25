import { PROVIDER_DISPLAY_NAMES, type EnvironmentId, type ProviderDriverKind } from "@t3tools/contracts";
import type { DirectoryListing } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";

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

/** What the Library's directory says about a saved computer this device cannot reach. */
export interface ComputerDirectoryHealth {
  /** "Running, but not reachable from here." or "Last reported 3 hours ago." */
  readonly text: string;
  /** For example "Codex needs attention on Dorothy.", or null. */
  readonly attention: string | null;
}

const providerName = (id: string) => PROVIDER_DISPLAY_NAMES[id as ProviderDriverKind] ?? id;

// Not Intl.ListFormat, which Hermes lacks.
const listText = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/**
 * Reads a live listing only: a cached one cannot say the computer is running now. A recent report
 * means the computer reaches the Library but not this device, which a route or network fixes,
 * not a restart. Null when the directory has no report for the computer.
 */
export function computerDirectoryHealth(input: {
  readonly listing: DirectoryListing;
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly now: number;
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
    text: proof.recent
      ? "Running, but not reachable from here."
      : `Last reported ${directoryAgeText(proof.ageMs)}.`,
    attention:
      attention.length === 0
        ? null
        : `${listText(attention)} ${attention.length === 1 ? "needs" : "need"} attention on ${input.label}.`,
  };
}
