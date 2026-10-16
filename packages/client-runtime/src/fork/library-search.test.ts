import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { LibrarySearchHit, LibrarySearchResult } from "@t3tools/contracts/fork";
import {
  EMPTY_LIBRARY_SEARCH_FEED,
  libraryHistoryOffsetForItem,
  librarySearchKey,
  librarySearchRequest,
  librarySnippetParts,
  mergeLibrarySearchPage,
} from "./library-search.ts";

const hit = (itemId: string, id = "conv-1"): LibrarySearchHit => ({
  id,
  projectId: "loom",
  environmentId: EnvironmentId.make("dorothy"),
  threadId: ThreadId.make("thread-1"),
  title: "Fix login",
  archived: false,
  itemId,
  position: 0,
  role: "user",
  snippet: "the login fails",
  highlights: [],
  occurredAt: "2026-10-10T00:00:00.000Z",
  rank: 1,
});
const page = (itemIds: readonly string[], nextCursor: string | null): LibrarySearchResult => ({
  hits: itemIds.map((itemId) => hit(itemId)),
  nextCursor,
});
const itemIds = (feed: { readonly hits: readonly LibrarySearchHit[] }) =>
  feed.hits.map((entry) => entry.itemId);

describe("librarySearchRequest", () => {
  it("sends nothing for blank text or text without letters or digits", () => {
    expect(librarySearchRequest("")).toBeNull();
    expect(librarySearchRequest("   ")).toBeNull();
    expect(librarySearchRequest(' "" -- ')).toBeNull();
  });

  it("trims the query, scopes it to a project and starts a new search when either changes", () => {
    const all = librarySearchRequest("  login bug ");
    const scoped = librarySearchRequest("login bug", { projectId: "loom" });
    expect(all).toEqual({ query: "login bug", limit: 20 });
    expect(scoped).toEqual({ query: "login bug", limit: 20, projectId: "loom" });
    expect(librarySearchKey(all!)).not.toBe(librarySearchKey(scoped!));
    expect(librarySearchKey(scoped!)).toBe(
      librarySearchKey(librarySearchRequest(" login bug", { projectId: "loom" })!),
    );
  });

  it("keeps the query within the Library's limit", () => {
    expect(librarySearchRequest("a".repeat(600))?.query).toHaveLength(500);
  });
});

describe("mergeLibrarySearchPage", () => {
  it("pages on with the cursor until the last page", () => {
    const first = mergeLibrarySearchPage(EMPTY_LIBRARY_SEARCH_FEED, page(["a", "b"], "2.9"));
    const last = mergeLibrarySearchPage(first, page(["c"], null), "2.9");
    expect(itemIds(last)).toEqual(["a", "b", "c"]);
    expect(last.nextCursor).toBeNull();
  });

  it("does not repeat a hit when an edit shifts the next page by one", () => {
    const first = mergeLibrarySearchPage(EMPTY_LIBRARY_SEARCH_FEED, page(["a", "b"], "2.9"));
    const next = mergeLibrarySearchPage(first, page(["b", "c"], "4.9"), "2.9");
    expect(itemIds(next)).toEqual(["a", "b", "c"]);
    expect(next.nextCursor).toBe("4.9");
  });

  it("keeps the same item of different conversations apart", () => {
    const feed = mergeLibrarySearchPage(EMPTY_LIBRARY_SEARCH_FEED, {
      hits: [hit("a", "conv-1"), hit("a", "conv-2")],
      nextCursor: null,
    });
    expect(feed.hits).toHaveLength(2);
  });

  it("ignores a stale page, a re-read first page and a page folded twice", () => {
    const first = mergeLibrarySearchPage(EMPTY_LIBRARY_SEARCH_FEED, page(["a", "b"], "2.9"));
    expect(mergeLibrarySearchPage(first, page(["x"], "3.9"))).toBe(first);
    expect(mergeLibrarySearchPage(first, page(["x"], null), "9.9")).toBe(first);
    const next = mergeLibrarySearchPage(first, page(["c"], null), "2.9");
    expect(mergeLibrarySearchPage(next, page(["c"], null), "2.9")).toBe(next);
  });
});

describe("librarySnippetParts", () => {
  it("splits matched runs from plain text", () => {
    expect(
      librarySnippetParts("why does login fail", [
        { start: 9, end: 14 },
        { start: 15, end: 19 },
      ]),
    ).toEqual([
      { text: "why does ", match: false },
      { text: "login", match: true },
      { text: " ", match: false },
      { text: "fail", match: true },
    ]);
  });

  it("keeps markup as text and tolerates ranges out of order, overlapping or out of bounds", () => {
    const snippet = "<b>x</b> ok";
    const parts = librarySnippetParts(snippet, [
      { start: 9, end: 40 },
      { start: 0, end: 3 },
      { start: 1, end: 2 },
      { start: 5, end: 5 },
    ]);
    expect(parts).toEqual([
      { text: "<b>", match: true },
      { text: "x</b> ", match: false },
      { text: "ok", match: true },
    ]);
    expect(parts.map((part) => part.text).join("")).toBe(snippet);
  });
});

describe("libraryHistoryOffsetForItem", () => {
  // 500 saved items; the newest page read 100 of them.
  const latest = { offset: 0, totalItems: 500, nextOffset: 100 };

  it("stays on a page that already shows the item", () => {
    expect(libraryHistoryOffsetForItem(450, latest)).toBeNull();
    expect(libraryHistoryOffsetForItem(400, latest)).toBeNull();
  });

  it("reads the page with the item and a few newer items below it", () => {
    // Item 120 has 379 newer items; reading from 376 shows three of them first.
    expect(libraryHistoryOffsetForItem(120, latest)).toBe(376);
    expect(
      libraryHistoryOffsetForItem(120, { offset: 376, totalItems: 500, nextOffset: 476 }),
    ).toBeNull();
  });

  it("reads from the item itself when large items cut that page short", () => {
    const short = { offset: 376, totalItems: 500, nextOffset: 378 };
    expect(libraryHistoryOffsetForItem(120, short)).toBe(379);
    // A page read from the item always includes it; if history changed meanwhile, stop there.
    expect(
      libraryHistoryOffsetForItem(120, { offset: 379, totalItems: 500, nextOffset: 379 }),
    ).toBeNull();
  });

  it("does not read for a position history no longer has", () => {
    expect(libraryHistoryOffsetForItem(600, latest)).toBeNull();
    expect(libraryHistoryOffsetForItem(-1, latest)).toBeNull();
    expect(libraryHistoryOffsetForItem(3, undefined)).toBeNull();
  });
});
