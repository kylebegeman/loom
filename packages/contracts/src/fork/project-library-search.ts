import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import { EnvironmentAuthorizationError } from "../auth.ts";
import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "../baseSchemas.ts";
import { LibraryError, LibraryId } from "./project-library.ts";

/** Advertised by a Library that can search saved history. Clients show no search without it. */
export const LIBRARY_SEARCH_FEATURE = "library-search";
export const LIBRARY_SEARCH_MAX_LIMIT = 50;

export const LibrarySearchRequest = Schema.Struct({
  /** Words match anywhere in an item, in any order. Wrap words in double quotes for an exact phrase. */
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(500)),
  projectId: Schema.optional(LibraryId),
  /** The computer the conversation ran on. */
  environmentId: Schema.optional(EnvironmentId),
  /** Inclusive lower bound on the item's time. */
  since: Schema.optional(IsoDateTime),
  /** Exclusive upper bound on the item's time. */
  until: Schema.optional(IsoDateTime),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(LIBRARY_SEARCH_MAX_LIMIT)),
  /**
   * `nextCursor` from the previous page of the same search. Opaque. Later pages read the history
   * indexed when the first page was read, so history saved meanwhile appears in a new search.
   */
  cursor: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(32))),
});
export type LibrarySearchRequest = typeof LibrarySearchRequest.Type;

export const LibrarySearchHit = Schema.Struct({
  /** The conversation's Library id, as used by history reads. */
  id: LibraryId,
  projectId: LibraryId,
  environmentId: EnvironmentId,
  threadId: ThreadId,
  title: Schema.String,
  archived: Schema.Boolean,
  itemId: TrimmedNonEmptyString,
  /** Index of the item in the conversation's saved history, oldest first. */
  position: NonNegativeInt,
  role: Schema.Literals(["user", "assistant", "plan", "system"]),
  /** A short excerpt around the match. */
  snippet: Schema.String,
  /** Matched ranges in `snippet`, as UTF-16 offsets with an exclusive end. */
  highlights: Schema.Array(Schema.Struct({ start: NonNegativeInt, end: NonNegativeInt })),
  occurredAt: IsoDateTime,
  /** Relevance. Higher is better; comparable only within one search. */
  rank: Schema.Number,
});
export type LibrarySearchHit = typeof LibrarySearchHit.Type;

export const LibrarySearchResult = Schema.Struct({
  hits: Schema.Array(LibrarySearchHit),
  /** Pass as `cursor` for the next page, or null after the last page. */
  nextCursor: Schema.NullOr(Schema.String),
});
export type LibrarySearchResult = typeof LibrarySearchResult.Type;

export const LIBRARY_SEARCH_WS_METHODS = {
  search: "loom.library.search",
} as const;

export const LibrarySearchRpcGroup = RpcGroup.make(
  Rpc.make(LIBRARY_SEARCH_WS_METHODS.search, {
    payload: LibrarySearchRequest,
    success: LibrarySearchResult,
    error: Schema.Union([LibraryError, EnvironmentAuthorizationError]),
  }),
);
