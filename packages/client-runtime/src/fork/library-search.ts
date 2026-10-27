import type {
  LibrarySearchHit,
  LibrarySearchRequest,
  LibrarySearchResult,
} from "@t3tools/contracts/fork";

/** How long typing pauses before the Library is asked, so a search is not sent per keystroke. */
export const LIBRARY_SEARCH_DEBOUNCE_MS = 300;
/** Hits per request. Enough to scan at a glance; more arrive on request. */
const LIBRARY_SEARCH_PAGE = 20;
const MAX_QUERY_CHARS = 500;

export const LIBRARY_SEARCH_ROLE_LABELS: Record<LibrarySearchHit["role"], string> = {
  user: "You",
  assistant: "Agent",
  plan: "Plan",
  system: "Project context",
};

/**
 * The first-page request for what was typed, or null when there is nothing to search for. The
 * Library skips words without a letter or digit, so text made only of those is never sent.
 */
export function librarySearchRequest(
  text: string,
  scope: { readonly projectId?: string | undefined } = {},
): LibrarySearchRequest | null {
  const query = text.trim().slice(0, MAX_QUERY_CHARS).trim();
  if (!/[\p{L}\p{N}]/u.test(query)) return null;
  return {
    query,
    limit: LIBRARY_SEARCH_PAGE,
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
  };
}

/**
 * Names one search. A cursor is not tied to the query it came from, so results and paging must
 * start over whenever this changes.
 */
export function librarySearchKey(request: LibrarySearchRequest) {
  return JSON.stringify([request.query, request.projectId ?? null, request.environmentId ?? null]);
}

/**
 * Hits read so far, best first, and the cursor for the next page. `nextCursor` is undefined until
 * the first page arrives and null after the last one.
 */
export type LibrarySearchFeed = {
  readonly hits: readonly LibrarySearchHit[];
  readonly nextCursor: string | null | undefined;
};

export const EMPTY_LIBRARY_SEARCH_FEED: LibrarySearchFeed = { hits: [], nextCursor: undefined };

/** Identifies a hit across pages: one item of one conversation. */
export function librarySearchHitKey(hit: Pick<LibrarySearchHit, "id" | "itemId">) {
  return `${hit.id}\u0000${hit.itemId}`;
}

/**
 * Folds a page of one search into its feed; omit `cursor` for the first page. Only the first page's
 * first read and the page at the feed's cursor count; others are stale and ignored. Hits already
 * shown are not repeated, since an edit while paging can shift a later page by one. Returns the
 * same feed when nothing changed.
 */
export function mergeLibrarySearchPage(
  feed: LibrarySearchFeed,
  page: LibrarySearchResult,
  cursor?: string,
): LibrarySearchFeed {
  if (cursor === undefined ? feed.nextCursor !== undefined : cursor !== feed.nextCursor)
    return feed;
  const known = new Set(feed.hits.map(librarySearchHitKey));
  const added = page.hits.filter((hit) => {
    const key = librarySearchHitKey(hit);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });
  if (!added.length && page.nextCursor === feed.nextCursor) return feed;
  return {
    hits: added.length ? [...feed.hits, ...added] : feed.hits,
    nextCursor: page.nextCursor,
  };
}

export type LibrarySnippetPart = { readonly text: string; readonly match: boolean };

/**
 * Splits a snippet into plain text and matched runs. Snippets come from other computers' history,
 * so callers render the parts as text, never as markup. Ranges out of order, overlapping or out
 * of bounds are tolerated rather than trusted.
 */
export function librarySnippetParts(
  snippet: string,
  highlights: readonly { readonly start: number; readonly end: number }[],
): readonly LibrarySnippetPart[] {
  const ranges = highlights
    .map(({ start, end }) => ({
      start: Math.max(0, Math.min(start, snippet.length)),
      end: Math.max(0, Math.min(end, snippet.length)),
    }))
    .filter(({ start, end }) => start < end)
    .sort((a, b) => a.start - b.start);
  const parts: LibrarySnippetPart[] = [];
  let at = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, at);
    if (range.end <= start) continue;
    if (start > at) parts.push({ text: snippet.slice(at, start), match: false });
    parts.push({ text: snippet.slice(start, range.end), match: true });
    at = range.end;
  }
  if (at < snippet.length) parts.push({ text: snippet.slice(at), match: false });
  return parts;
}

/** Newer items shown below a matched item, so it reads in context rather than at a page's end. */
const ITEM_CONTEXT_AFTER = 3;

/**
 * The history offset to read so the page shows the item at `position` (oldest first, as a search
 * hit gives it), or null when `window` already shows it or no read would. Offsets count back from
 * the newest item. A page of large items stops early, so the next try starts at the item itself.
 */
export function libraryHistoryOffsetForItem(
  position: number,
  window:
    | {
        readonly offset: number;
        readonly totalItems: number;
        readonly nextOffset?: number | undefined;
      }
    | undefined,
): number | null {
  if (!window || !Number.isSafeInteger(position) || position < 0) return null;
  if (position >= window.totalItems) return null;
  const newest = window.totalItems - 1 - window.offset;
  const oldest = window.totalItems - (window.nextOffset ?? window.totalItems);
  if (position >= oldest && position <= newest) return null;
  const exact = window.totalItems - 1 - position;
  const roomy = Math.max(0, exact - ITEM_CONTEXT_AFTER);
  if (window.offset === exact) return null;
  return window.offset === roomy ? exact : roomy;
}
