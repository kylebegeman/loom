import { EnvironmentAuthorizationError, type EnvironmentId } from "@t3tools/contracts";
import { DirectoryError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";

import type { EnvironmentConnectionPresentation } from "../connection/presentation.ts";
import { EnvironmentNotRegisteredError } from "../connection/registry.ts";
import {
  directoryCatalogRows,
  type DirectoryCatalogRow,
  type DirectorySavedConnection,
} from "./directory.ts";
import {
  directoryListingView,
  type DirectoryAnswer,
  type DirectoryListingView,
  type StoredDirectoryListing,
} from "./directory-cache.ts";

export type DirectoryComputersStatus =
  /** No Library is chosen on this device. */
  | "no-library"
  /** The Library does not advertise `directory`. */
  | "unsupported"
  | "loading"
  | "listed"
  /** The directory answered and lists nothing this device has not saved. */
  | "empty"
  | "failed";

export interface DirectoryComputersView {
  readonly status: DirectoryComputersStatus;
  /** Computers the directory lists that this device has not saved, by label. */
  readonly rows: readonly DirectoryCatalogRow[];
  /** Where the rows came from. A cached listing carries its age in `cacheText`. */
  readonly listing: DirectoryListingView;
  /** A read is running; the rows from the last listing stay meanwhile. */
  readonly refreshing: boolean;
  /** Why the last read failed, in one short line. Set only when `failed`. */
  readonly error: string | null;
}

const NO_ROWS: DirectoryComputersView["rows"] = [];
const LIBRARY_UNREACHABLE = "Your Library is not reachable right now.";

const isDirectoryError = Schema.is(DirectoryError);
const isAuthorizationError = Schema.is(EnvironmentAuthorizationError);
const isUnregistered = Schema.is(EnvironmentNotRegisteredError);

const fetchedAtMs = (stored: StoredDirectoryListing | null) =>
  stored === null ? Number.NEGATIVE_INFINITY : Date.parse(stored.fetchedAt);

/** One short line for a failed read. Never the server's own wording, which names internals. */
function directoryListingErrorText(cause: Cause.Cause<unknown>): string {
  const error = Option.getOrNull(Cause.findErrorOption(cause));
  if (isDirectoryError(error))
    return error.reason === "not-authority"
      ? "The computer set as your Library does not keep a computer list."
      : "Your Library could not read its computer list. Try again.";
  if (isAuthorizationError(error))
    return "This device is not allowed to read your Library's computer list.";
  // The Library stays chosen after this device removes its connection, which the read runs on.
  if (isUnregistered(error)) return "Your Library is not saved on this device.";
  const tag =
    typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : null;
  if (
    tag === "EnvironmentRpcUnavailableError" ||
    tag === "ConnectionTransientError" ||
    tag === "ConnectionBlockedError"
  )
    return LIBRARY_UNREACHABLE;
  return "Loom could not load the computer list.";
}

/**
 * The Library's computer list for one device: the live answer when there is one, otherwise the
 * newest listing this device kept, with its age. Only computers this device has not saved
 * appear; saved connections keep their own routes and are never changed by the directory.
 */
export function directoryComputersView(input: {
  readonly authorityEnvironmentId: EnvironmentId | null;
  /** From the Library's `loomFeatures`; null while its capabilities are unknown. */
  readonly supportsDirectory: boolean | null;
  /**
   * The Library connection's state. While it retries after a failed attempt, a read waits for
   * the connection instead of failing, so this is what says the Library is unreachable.
   */
  readonly libraryConnection: Pick<EnvironmentConnectionPresentation, "phase" | "error"> | null;
  /** The `listing` atom's value. Pass an initial result while it is not mounted. */
  readonly live: AsyncResult.AsyncResult<StoredDirectoryListing, unknown>;
  /** The `stored` atom's value. */
  readonly stored: StoredDirectoryListing | null;
  /** Every connection saved on this device, including the Library itself. */
  readonly saved: readonly DirectorySavedConnection[];
  readonly now: number;
}): DirectoryComputersView {
  const { authorityEnvironmentId, live } = input;
  if (authorityEnvironmentId === null || input.supportsDirectory === false) {
    return {
      status: authorityEnvironmentId === null ? "no-library" : "unsupported",
      rows: NO_ROWS,
      listing: directoryListingView({
        authorityEnvironmentId: null,
        answer: { status: "unsupported" },
        cached: null,
        now: input.now,
      }),
      refreshing: false,
      error: null,
    };
  }
  // A failed refresh keeps the listing it last read; prefer it when it is newer than the store.
  const previous = Option.getOrNull(AsyncResult.value(live));
  const cached = fetchedAtMs(previous) > fetchedAtMs(input.stored) ? previous : input.stored;
  const unreachable =
    live.waiting &&
    input.libraryConnection?.phase === "reconnecting" &&
    input.libraryConnection.error !== null;
  const failed = live._tag === "Failure" || unreachable;
  const answer: DirectoryAnswer =
    live._tag === "Success" && !unreachable
      ? { status: "listed", listing: live.value.listing }
      : { status: failed ? "failed" : "loading" };
  const listing = directoryListingView({
    authorityEnvironmentId,
    answer,
    cached,
    now: input.now,
  });
  const rows = directoryCatalogRows({
    listing: listing.listing,
    saved: input.saved,
    connected: [],
    now: input.now,
  }).filter((row) => row.saved === null);
  return {
    status: failed
      ? "failed"
      : live._tag === "Success"
        ? rows.length > 0
          ? "listed"
          : "empty"
        : "loading",
    rows,
    listing,
    refreshing: live.waiting && !unreachable,
    error:
      live._tag === "Failure"
        ? directoryListingErrorText(live.cause)
        : unreachable
          ? LIBRARY_UNREACHABLE
          : null,
  };
}
