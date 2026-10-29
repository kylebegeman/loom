import type { EnvironmentId } from "@t3tools/contracts";
import type { DirectoryListing } from "@t3tools/contracts/fork";
import { loomCompatibility } from "@t3tools/shared/fork/compatibility";
import { directoryCatalogRows, type DirectorySavedConnection } from "./directory.ts";

export interface SavedCompatibilityComputer extends DirectorySavedConnection {
  readonly loomFeatures?: readonly string[] | undefined;
}

/** Reports take precedence; a saved computer with no known capabilities is still unknown. */
export function computersBelowCompatibilityFloor(input: {
  readonly listing: DirectoryListing | null;
  readonly saved: readonly SavedCompatibilityComputer[];
}) {
  return directoryCatalogRows({ ...input, connected: [], now: 0 }).flatMap((row) => {
    const features = row.report?.loomFeatures ?? row.saved?.loomFeatures;
    if (features === undefined) return [];
    const compatibility = loomCompatibility(features);
    return compatibility.belowCompatibilityFloor
      ? [{ environmentId: row.environmentId, label: row.label, ...compatibility }]
      : [];
  });
}

export function directoryServerVersion(
  environmentId: EnvironmentId,
  listing: DirectoryListing | null,
): string | null {
  return (
    listing?.environments.find((entry) => entry.environmentId === environmentId)?.serverVersion ??
    null
  );
}
