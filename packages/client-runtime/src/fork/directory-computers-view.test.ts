import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentId } from "@t3tools/contracts";
import { DirectoryError } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";

import { EnvironmentNotRegisteredError } from "../connection/registry.ts";
import { EnvironmentRpcUnavailableError } from "../rpc/client.ts";
import { storedDirectoryListing, type StoredDirectoryListing } from "./directory-cache.ts";
import { directoryComputersView } from "./directory-computers-view.ts";
import {
  BOOK,
  DESK,
  LIBRARY,
  MINUTES,
  NOW,
  STUDIO,
  listing,
  reported,
} from "./directory-test-fixtures.ts";

const HOURS = 60 * MINUTES;
const saved = [
  { environmentId: LIBRARY, label: "Library" },
  { environmentId: STUDIO, label: "Studio" },
];
const everyone = listing([reported(LIBRARY), reported(STUDIO), reported(BOOK, { label: "Book" })]);
const stored = storedDirectoryListing(LIBRARY, everyone, NOW - 3 * HOURS);
const unreachable = Cause.fail(
  new EnvironmentRpcUnavailableError({ environmentId: LIBRARY, message: "offline" }),
);

const view = (
  live: AsyncResult.AsyncResult<StoredDirectoryListing, unknown>,
  options: {
    readonly stored?: StoredDirectoryListing | null;
    readonly authority?: EnvironmentId | null;
    readonly supportsDirectory?: boolean | null;
    readonly libraryConnection?: Parameters<typeof directoryComputersView>[0]["libraryConnection"];
  } = {},
) =>
  directoryComputersView({
    authorityEnvironmentId: options.authority === undefined ? LIBRARY : options.authority,
    supportsDirectory: options.supportsDirectory ?? true,
    libraryConnection: options.libraryConnection ?? { phase: "connecting", error: null },
    live,
    stored: options.stored === undefined ? stored : options.stored,
    saved,
    now: NOW,
  });

const ids = (shown: ReturnType<typeof view>) => shown.rows.map((row) => row.environmentId);

describe("directoryComputersView", () => {
  it("lists only computers this device has not saved, from the live answer", () => {
    const live = storedDirectoryListing(
      LIBRARY,
      listing([reported(LIBRARY), reported(STUDIO), reported(DESK), reported(BOOK)]),
      NOW,
    );
    const shown = view(AsyncResult.success(live));
    expect(shown).toMatchObject({ status: "listed", refreshing: false, error: null });
    expect(shown.listing.source).toBe("live");
    expect(ids(shown)).toEqual([BOOK, DESK]);
    expect(shown.rows.every((row) => row.saved === null && row.action === "connect")).toBe(true);
  });

  it("is empty when the directory lists only saved computers", () => {
    const live = storedDirectoryListing(
      LIBRARY,
      listing([reported(LIBRARY), reported(STUDIO)]),
      NOW,
    );
    expect(view(AsyncResult.success(live))).toMatchObject({ status: "empty", rows: [] });
  });

  it("shows the kept listing, with its age, when the Library cannot answer", () => {
    const shown = view(AsyncResult.failure(unreachable));
    expect(shown).toMatchObject({
      status: "failed",
      error: "Your Library is not reachable right now.",
      listing: { source: "cache", cacheText: "Showing the list from 3 hours ago" },
    });
    expect(ids(shown)).toEqual([BOOK]);
  });

  it("prefers the listing a failed refresh last read when it is newer than the kept one", () => {
    const recent = storedDirectoryListing(LIBRARY, listing([reported(DESK)]), NOW - 5 * MINUTES);
    const shown = view(
      AsyncResult.failureWithPrevious(unreachable, {
        previous: Option.some(AsyncResult.success(recent)),
      }),
    );
    expect(ids(shown)).toEqual([DESK]);
    expect(shown.listing.cacheText).toBe("Showing the list from 5 min ago");
  });

  it("explains a Library that does not keep the list", () => {
    const shown = view(
      AsyncResult.failure(Cause.fail(new DirectoryError({ reason: "not-authority" }))),
    );
    expect(shown.error).toBe("The computer set as your Library does not keep a computer list.");
  });

  it("says the Library is not saved here when its connection was removed from this device", () => {
    const shown = view(
      AsyncResult.failure(
        Cause.fail(new EnvironmentNotRegisteredError({ environmentId: LIBRARY })),
      ),
    );
    expect(shown).toMatchObject({
      status: "failed",
      error: "Your Library is not saved on this device.",
    });
  });

  it("shows the kept listing while the first read runs", () => {
    const shown = view(AsyncResult.initial(true));
    expect(shown).toMatchObject({ status: "loading", refreshing: true });
    expect(ids(shown)).toEqual([BOOK]);
    expect(view(AsyncResult.initial(true), { stored: null }).rows).toEqual([]);
  });

  it("says the Library is unreachable while its connection retries, instead of loading forever", () => {
    const retrying = { phase: "reconnecting", error: "Connection refused" } as const;
    const first = view(AsyncResult.initial(true), { libraryConnection: retrying });
    expect(first).toMatchObject({
      status: "failed",
      refreshing: false,
      error: "Your Library is not reachable right now.",
      listing: { source: "cache", cacheText: "Showing the list from 3 hours ago" },
    });
    expect(ids(first)).toEqual([BOOK]);

    // A refresh after a good answer keeps that answer, with its age, rather than a spinner.
    const earlier = storedDirectoryListing(LIBRARY, listing([reported(DESK)]), NOW - 5 * MINUTES);
    const again = view(AsyncResult.success(earlier, { waiting: true }), {
      libraryConnection: retrying,
    });
    expect(again).toMatchObject({ status: "failed", refreshing: false });
    expect(again.listing.cacheText).toBe("Showing the list from 5 min ago");
    expect(ids(again)).toEqual([DESK]);

    // A first attempt that has not failed yet is still loading.
    expect(view(AsyncResult.initial(true))).toMatchObject({ status: "loading", error: null });
  });

  it("lists nothing without a Library or when the Library has no directory", () => {
    expect(view(AsyncResult.initial(false), { authority: null })).toMatchObject({
      status: "no-library",
      rows: [],
    });
    expect(view(AsyncResult.initial(false), { supportsDirectory: false })).toMatchObject({
      status: "unsupported",
      rows: [],
    });
  });

  it("never shows another Library's kept listing", () => {
    const other = storedDirectoryListing(STUDIO, everyone, NOW - HOURS);
    expect(view(AsyncResult.failure(unreachable), { stored: other }).rows).toEqual([]);
  });
});
