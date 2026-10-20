import { EnvironmentId } from "@t3tools/contracts";
import { DirectoryListing } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { directoryAgeText } from "./directory.ts";

/**
 * The last directory listing this device read, kept beside its connection catalog so the
 * Computers list still shows discovered computers while the directory cannot answer.
 */
export const StoredDirectoryListing = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  /** The Library that answered. A cache from another Library is never shown. */
  authorityEnvironmentId: EnvironmentId,
  fetchedAt: Schema.String,
  listing: DirectoryListing,
});
export type StoredDirectoryListing = typeof StoredDirectoryListing.Type;

export const StoredDirectoryListingJson = Schema.fromJsonString(StoredDirectoryListing);

const decodeStored = Schema.decodeUnknownOption(StoredDirectoryListingJson);
const encodeStored = Schema.encodeSync(StoredDirectoryListingJson);

export function storedDirectoryListing(
  authorityEnvironmentId: EnvironmentId,
  listing: DirectoryListing,
  fetchedAt: number,
): StoredDirectoryListing {
  return {
    schemaVersion: 1,
    authorityEnvironmentId,
    fetchedAt: DateTime.formatIso(DateTime.makeUnsafe(fetchedAt)),
    listing,
  };
}

export const encodeStoredDirectoryListing = (stored: StoredDirectoryListing): string =>
  encodeStored(stored);

/** Null for anything unreadable, including an older or newer schema; the next read replaces it. */
export const decodeStoredDirectoryListing = (
  text: string | null | undefined,
): StoredDirectoryListing | null => (text == null ? null : Option.getOrNull(decodeStored(text)));

/** What the Library said when this device last asked for the directory. */
export type DirectoryAnswer =
  | { readonly status: "listed"; readonly listing: DirectoryListing }
  /** Not asked yet, or the first answer is on its way. */
  | { readonly status: "loading" }
  /** The directory could not be reached or answered with an error. */
  | { readonly status: "failed" }
  /** The Library does not advertise `directory`. */
  | { readonly status: "unsupported" };

export interface DirectoryListingView {
  readonly listing: DirectoryListing | null;
  readonly source: "live" | "cache" | "none";
  /** When the cached listing was read. Set only for a cached listing. */
  readonly fetchedAt: string | null;
  readonly cacheAgeMs: number | null;
  /** For example "Showing the list from 3 hours ago". Set only for a cached listing. */
  readonly cacheText: string | null;
}

const NO_LISTING: DirectoryListingView = {
  listing: null,
  source: "none",
  fetchedAt: null,
  cacheAgeMs: null,
  cacheText: null,
};

/**
 * The listing to show: the live answer when there is one, otherwise this Library's cached
 * listing with its age. Remember a live answer with `storedDirectoryListing` so the next failure
 * has something to show.
 */
export function directoryListingView(input: {
  readonly authorityEnvironmentId: EnvironmentId | null;
  readonly answer: DirectoryAnswer;
  readonly cached: StoredDirectoryListing | null;
  readonly now: number;
}): DirectoryListingView {
  if (input.authorityEnvironmentId === null) return NO_LISTING;
  if (input.answer.status === "listed") {
    return {
      listing: input.answer.listing,
      source: "live",
      fetchedAt: null,
      cacheAgeMs: null,
      cacheText: null,
    };
  }
  const cached = input.cached;
  if (cached === null || cached.authorityEnvironmentId !== input.authorityEnvironmentId) {
    return NO_LISTING;
  }
  const fetchedAt = Date.parse(cached.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return NO_LISTING;
  const cacheAgeMs = Math.max(0, input.now - fetchedAt);
  return {
    listing: cached.listing,
    source: "cache",
    fetchedAt: cached.fetchedAt,
    cacheAgeMs,
    cacheText:
      cacheAgeMs < 60_000
        ? "Showing the list from a moment ago"
        : `Showing the list from ${directoryAgeText(cacheAgeMs)}`,
  };
}
