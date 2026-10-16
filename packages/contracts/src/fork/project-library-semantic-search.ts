import * as Schema from "effect/Schema";

/**
 * Advertised by a Library that blends meaning into history search. Requests and hits keep the
 * `library-search` shape; the fields below are optional and absent without this feature.
 */
export const LIBRARY_SEMANTIC_SEARCH_FEATURE = "library-semantic-search";

/**
 * Why a hit was returned: its words matched the query, its meaning was close to the query's, or
 * both. A `semantic` hit has no highlights and its snippet is the start of the item.
 */
export const LibrarySearchMatch = Schema.Literals(["text", "semantic", "both"]);
export type LibrarySearchMatch = typeof LibrarySearchMatch.Type;
