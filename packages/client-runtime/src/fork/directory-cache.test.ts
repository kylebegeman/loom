import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

import { directoryCatalogRows } from "./directory.ts";
import {
  decodeStoredDirectoryListing,
  directoryListingView,
  encodeStoredDirectoryListing,
  storedDirectoryListing,
  type DirectoryAnswer,
} from "./directory-cache.ts";
import { BOOK, MINUTES, NOW, STUDIO, listing, reported } from "./directory-test-fixtures.ts";

const LIBRARY = EnvironmentId.make("library");
const HOURS = 60 * MINUTES;
const cachedListing = listing([reported(STUDIO), reported(BOOK, { label: "Book" })]);
const cached = storedDirectoryListing(LIBRARY, cachedListing, NOW - 3 * HOURS);
const savedStudio = {
  environmentId: STUDIO,
  label: "Studio",
  httpBaseUrl: "https://studio.example.com",
};

describe("stored directory listing", () => {
  it("round-trips through its stored text", () => {
    expect(decodeStoredDirectoryListing(encodeStoredDirectoryListing(cached))).toEqual(cached);
  });

  it("reads anything unreadable as no cache", () => {
    expect(decodeStoredDirectoryListing(null)).toBeNull();
    expect(decodeStoredDirectoryListing("{")).toBeNull();
    expect(
      decodeStoredDirectoryListing(JSON.stringify({ ...cached, schemaVersion: 2 })),
    ).toBeNull();
  });
});

describe("directoryListingView", () => {
  const view = (answer: DirectoryAnswer, authorityEnvironmentId: EnvironmentId | null = LIBRARY) =>
    directoryListingView({ authorityEnvironmentId, answer, cached, now: NOW });

  it("shows a live answer as it is", () => {
    const live = listing([reported(BOOK)]);
    expect(view({ status: "listed", listing: live })).toEqual({
      listing: live,
      source: "live",
      fetchedAt: null,
      cacheAgeMs: null,
      cacheText: null,
    });
  });

  it("falls back to the cache with its age when the directory fails or is missing", () => {
    for (const status of ["failed", "unsupported", "loading"] as const) {
      expect(view({ status })).toEqual({
        listing: cachedListing,
        source: "cache",
        fetchedAt: cached.fetchedAt,
        cacheAgeMs: 3 * HOURS,
        cacheText: "Showing the list from 3 hours ago",
      });
    }
  });

  it("says a moment ago for a cache under a minute old", () => {
    expect(
      directoryListingView({
        authorityEnvironmentId: LIBRARY,
        answer: { status: "failed" },
        cached: storedDirectoryListing(LIBRARY, cachedListing, NOW - 10_000),
        now: NOW,
      }).cacheText,
    ).toBe("Showing the list from a moment ago");
  });

  it("never shows another Library's cache", () => {
    expect(view({ status: "failed" }, EnvironmentId.make("other-library")).source).toBe("none");
    expect(view({ status: "failed" }, null).source).toBe("none");
  });

  it("keeps saved rows and lists discovered rows from the cache while the directory errors", () => {
    const shown = view({ status: "failed" });
    const rows = directoryCatalogRows({
      listing: shown.listing,
      saved: [savedStudio],
      connected: [STUDIO],
      now: NOW,
    });
    expect(shown.cacheText).toBe("Showing the list from 3 hours ago");
    expect(rows.map((row) => [row.environmentId, row.saved, row.routes, row.connected])).toEqual([
      [STUDIO, savedStudio, [], true],
      [BOOK, null, [{ kind: "tailnet", url: "https://book.example.ts.net" }], false],
    ]);
  });

  it("filters the routes of a cached listing that a client wrote with bad routes", () => {
    const tampered = JSON.parse(encodeStoredDirectoryListing(cached));
    tampered.listing.environments[1].routes = [{ kind: "public", url: "https://172.16.0.9" }];
    const stored = decodeStoredDirectoryListing(JSON.stringify(tampered));
    const shown = directoryListingView({
      authorityEnvironmentId: LIBRARY,
      answer: { status: "failed" },
      cached: stored,
      now: NOW,
    });
    const rows = directoryCatalogRows({
      listing: shown.listing,
      saved: [],
      connected: [],
      now: NOW,
    });
    expect(rows.find((row) => row.environmentId === BOOK)).toMatchObject({
      routes: [],
      action: "pair",
    });
  });
});
