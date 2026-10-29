import { LibraryError, type LibraryDeletedPreferences } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
const isLibraryError = Schema.is(LibraryError);

export function visibleLibraryArchive<A>(cached: A | null, failure: unknown): A | null {
  return isLibraryError(failure) && failure.reason === "not-found" ? null : cached;
}

export function libraryRetentionDays(
  saved: boolean | null,
  supported: boolean,
  preferences: LibraryDeletedPreferences | null,
): number | null {
  return saved && supported && preferences ? preferences.retentionDays : null;
}
