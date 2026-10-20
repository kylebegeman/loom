import {
  LIBRARY_SEARCH_MAX_LIMIT,
  LibraryError,
  LibrarySearchHit,
  type LibrarySearchRequest,
  type LibrarySearchResult,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { Fragment } from "effect/sql/Statement";
import { LibraryEmbedder } from "./LibraryEmbedder.ts";
import { fuseRankings, makeLibrarySemanticSearch } from "./LibrarySemanticSearch.ts";

/**
 * Full-text search over saved conversation history.
 *
 * `fork_library_search_items` holds one row per searchable history item: user and assistant
 * messages and proposed plans. Tool output and reasoning are left out. The FTS5 table
 * `fork_library_search` indexes those rows as external content, kept in step by triggers. Rows are
 * derived from `fork_library_history_items`, which ingest rewrites in the same transaction.
 */

// The longest item text that is indexed. Longer pastes stay readable in history.
const MAX_INDEXED_CHARS = 64 * 1024;
const SNIPPET_TOKENS = 24;
const MAX_TERMS = 16;
// Paging is by offset into the ranked matches; this bounds how deep a cursor can reach.
const MAX_OFFSET = 1000;
/**
 * A cursor is `<offset>.<bound>`: the matches earlier pages returned, and the highest
 * `fork_library_search_items.id` when the first page was read. Every page skips rows above the
 * bound, so history indexed while a client pages cannot push earlier matches onto a later page.
 *
 * The bound holds because reindexing keeps the id of every item that is still saved (see `index`);
 * only items that are new to the index get new, higher ids. SQLite reuses an id only after the
 * rows above it are removed. Items edited or removed while a client pages can still shift the
 * offset by one. bm25 still sees new rows in its corpus statistics, which
 * scales every match of a term alike and so rarely reorders the snapshot; a keyset cursor on rank
 * would break under that scaling, which is why paging stays by offset.
 */
const CURSOR = /^([1-9]\d{0,3})\.([1-9]\d{0,15})$/;
const MIN_PREFIX_CHARS = 3;
// Private-use characters mark matches in snippets. Indexed text has them removed.
const MATCH_OPEN = "";
const MATCH_CLOSE = "";
// A blended search reads this many full-text matches, enough for every page a cursor can reach.
const FUSED_TEXT_DEPTH = MAX_OFFSET + LIBRARY_SEARCH_MAX_LIMIT + 1;
// A semantic hit's snippet is the start of its item, cut at a word near this length.
const LEAD_SNIPPET_CHARS = 160;
// Past this the query is answered by words alone rather than kept waiting on the model.
const QUERY_EMBED_TIMEOUT = Duration.seconds(3);

export const LIBRARY_SEARCH_SCHEMA = [
  `CREATE TABLE fork_library_search_items (id INTEGER PRIMARY KEY, library_id TEXT NOT NULL, position INTEGER NOT NULL, item_id TEXT NOT NULL, role TEXT NOT NULL, occurred_at TEXT NOT NULL, body TEXT NOT NULL)`,
  `CREATE INDEX fork_library_search_items_conversation ON fork_library_search_items(library_id)`,
  `CREATE VIRTUAL TABLE fork_library_search USING fts5(body, content='fork_library_search_items', content_rowid='id', tokenize='unicode61 remove_diacritics 2')`,
  `CREATE TRIGGER fork_library_search_items_insert AFTER INSERT ON fork_library_search_items BEGIN INSERT INTO fork_library_search(rowid, body) VALUES (new.id, new.body); END`,
  `CREATE TRIGGER fork_library_search_items_delete AFTER DELETE ON fork_library_search_items BEGIN INSERT INTO fork_library_search(fork_library_search, rowid, body) VALUES ('delete', old.id, old.body); END`,
  `CREATE TRIGGER fork_library_search_items_update AFTER UPDATE ON fork_library_search_items BEGIN INSERT INTO fork_library_search(fork_library_search, rowid, body) VALUES ('delete', old.id, old.body); INSERT INTO fork_library_search(rowid, body) VALUES (new.id, new.body); END`,
] as const;

/**
 * The searchable items of every conversation matched by `where`, a condition on
 * `fork_library_threads AS t`. Deleted conversations have none.
 */
const searchItemRows = (sql: SqlClient.SqlClient, where: Fragment) => sql`
  SELECT library_id, position, item_id, role, occurred_at, body FROM (
    SELECT h.library_id, h.position,
      coalesce(json_extract(h.payload_json, '$.item.id'), json_extract(h.payload_json, '$.id')) AS item_id,
      CASE
        WHEN json_type(h.payload_json, '$.item') = 'object' THEN
          CASE json_extract(h.payload_json, '$.item.type')
            WHEN 'user_message' THEN 'user'
            WHEN 'assistant_message' THEN 'assistant'
            WHEN 'proposed_plan' THEN 'plan'
          END
        WHEN json_extract(h.payload_json, '$.role') IN ('user', 'assistant', 'system')
          THEN json_extract(h.payload_json, '$.role')
      END AS role,
      coalesce(
        json_extract(h.payload_json, '$.item.startedAt'),
        json_extract(h.payload_json, '$.item.completedAt'),
        json_extract(h.payload_json, '$.item.updatedAt'),
        json_extract(h.payload_json, '$.createdAt')
      ) AS occurred_at,
      replace(replace(substr(coalesce(
        json_extract(h.payload_json, '$.item.text'),
        json_extract(h.payload_json, '$.item.markdown'),
        json_extract(h.payload_json, '$.text')
      ), 1, ${MAX_INDEXED_CHARS}), char(57344), ''), char(57345), '') AS body,
      -- An inherited item belongs to the conversation it was forked from, which is indexed itself.
      json_extract(h.payload_json, '$.visibility') AS visibility
    FROM fork_library_threads AS t
    JOIN fork_library_history_items AS h ON h.library_id = t.library_id
    WHERE ${where} AND coalesce(json_extract(t.summary_json, '$.deleted'), 0) = 0
  )
  WHERE role IS NOT NULL AND item_id IS NOT NULL AND occurred_at IS NOT NULL
    AND typeof(body) = 'text' AND trim(body) <> '' AND coalesce(visibility, '') <> 'inherited'`;

/** Index every saved conversation. Used once when the search tables are created. */
export const backfillLibrarySearch = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO fork_library_search_items (library_id, position, item_id, role, occurred_at, body)
    ${searchItemRows(sql, sql`1 = 1`)}`;
});

/**
 * Turn a user's words into an FTS5 query. Each word must match, as a prefix when it is long
 * enough. Double-quoted text matches as an exact phrase. Returns null when nothing is searchable.
 */
export function libraryMatchQuery(query: string): string | null {
  const terms: string[] = [];
  // FTS5 reads a NUL as the end of the query, so control characters only separate words.
  const words = query.replace(/\p{Cc}/gu, " ");
  for (const match of words.matchAll(/"([^"]*)"|([^\s"]+)/g)) {
    const phrase = match[1] !== undefined;
    const text = (match[1] ?? match[2] ?? "").trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    const quoted = `"${text.replaceAll('"', '""')}"`;
    terms.push(!phrase && text.length >= MIN_PREFIX_CHARS ? `${quoted}*` : quoted);
    if (terms.length === MAX_TERMS) break;
  }
  return terms.length === 0 ? null : terms.join(" ");
}

/** Split an FTS5 snippet into plain text and the ranges its match markers enclosed. */
export function parseLibrarySnippet(marked: string) {
  let snippet = "";
  let start: number | null = null;
  const highlights: { start: number; end: number }[] = [];
  for (const character of marked) {
    if (character === MATCH_OPEN) start = snippet.length;
    else if (character === MATCH_CLOSE) {
      if (start !== null && snippet.length > start) highlights.push({ start, end: snippet.length });
      start = null;
    } else snippet += character;
  }
  return { snippet, highlights };
}

const isoTime = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const time = DateTime.make(value);
  return Option.isSome(time) ? DateTime.formatIso(time.value) : null;
};
const decodeCursor = (cursor: string) => {
  const parts = CURSOR.exec(cursor);
  if (parts === null) return null;
  const offset = Number(parts[1]);
  const bound = Number(parts[2]);
  return offset <= MAX_OFFSET && Number.isSafeInteger(bound) ? { offset, bound } : null;
};
/** The start of an item's text, as the snippet of a hit that matched by meaning alone. */
export function leadSnippet(text: string) {
  const flat = text.replace(/\s+/gu, " ").trim();
  if (flat.length <= LEAD_SNIPPET_CHARS) return flat;
  const cut = flat.lastIndexOf(" ", LEAD_SNIPPET_CHARS);
  return `${flat.slice(0, cut > LEAD_SNIPPET_CHARS / 2 ? cut : LEAD_SNIPPET_CHARS).trimEnd()}…`;
}
// Quoted text asks for those exact words, so such a query is not blended with meaning.
const hasQuotedPhrase = (query: string) => /"[^"]*[\p{L}\p{N}][^"]*"/u.test(query);
const invalid = () => new LibraryError({ reason: "invalid" });
const io = (cause: unknown) => new LibraryError({ reason: "io", cause });
const decodeHit = Schema.decodeUnknownEffect(LibrarySearchHit);

export const makeLibrarySearch = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const embedder = yield* LibraryEmbedder;
  /** Null unless this server has the semantic search model. */
  const semantic = embedder === null ? null : yield* makeLibrarySemanticSearch(embedder);
  /**
   * Bring one conversation's entries in step with its saved items. Run inside the ingest
   * transaction. An item keeps its row, and so its id, for as long as it is saved at the same
   * position; search cursors rely on that. `NOT IN` builds each lookup once, where a correlated
   * `NOT EXISTS` rescanned the conversation per item and took a second per save at 8,000 items.
   */
  const index = Effect.fn("LibrarySearch.index")(function* (libraryId: string) {
    const saved = searchItemRows(sql, sql`t.library_id = ${libraryId}`);
    yield* Effect.all(
      [
        sql`DELETE FROM fork_library_search_items AS i WHERE i.library_id = ${libraryId}
          AND (i.position, i.item_id) NOT IN (SELECT position, item_id FROM (${saved}))`,
        sql`UPDATE fork_library_search_items AS i SET role = s.role, occurred_at = s.occurred_at, body = s.body
          FROM (${saved}) AS s
          WHERE i.library_id = ${libraryId} AND s.position = i.position AND s.item_id = i.item_id
            AND (i.role, i.occurred_at, i.body) IS NOT (s.role, s.occurred_at, s.body)`,
        sql`INSERT INTO fork_library_search_items (library_id, position, item_id, role, occurred_at, body)
          SELECT * FROM (${saved}) AS s WHERE (s.position, s.item_id) NOT IN (
            SELECT position, item_id FROM fork_library_search_items WHERE library_id = ${libraryId})`,
      ],
      { discard: true },
    ).pipe(Effect.mapError(io));
  });
  /**
   * One page of full-text matches blended with the items closest in meaning, by reciprocal rank
   * fusion. Both rankings are read whole for the snapshot `bound`, then paged by offset like a
   * plain search, so a cursor keeps the same format and the same snapshot guarantee.
   */
  const blended = Effect.fnUntraced(function* (
    limit: number,
    offset: number,
    knownBound: number | undefined,
    match: string,
    query: Float32Array,
    scope: (bound: Fragment) => Fragment,
  ) {
    const bound =
      knownBound ??
      (yield* sql<{
        bound: number;
      }>`SELECT coalesce(max(id), 0) AS bound FROM fork_library_search_items`)[0]!.bound;
    const text = yield* sql<{ id: number }>`
        SELECT i.id FROM fork_library_search
        JOIN fork_library_search_items AS i ON i.id = fork_library_search.rowid
        JOIN fork_library_threads AS t ON t.library_id = i.library_id
        WHERE fork_library_search MATCH ${match} AND ${scope(sql`${bound}`)}
        ORDER BY fork_library_search.rank, i.id
        LIMIT ${FUSED_TEXT_DEPTH}`;
    const ranked = fuseRankings(
      text.map(({ id }) => id),
      yield* semantic!.nearest(query, scope(sql`${bound}`)),
    );
    const entries = ranked.slice(offset, offset + limit);
    if (entries.length === 0) return { hits: [], nextCursor: null } satisfies LibrarySearchResult;
    const rows = yield* sql<{
      id: number;
      library_id: string;
      position: number;
      item_id: string;
      role: string;
      occurred_at: string;
      project_id: string;
      environment_id: string;
      thread_id: string;
      title: string | null;
      archived: number | null;
      lead: string;
    }>`
        SELECT i.id, i.library_id, i.position, i.item_id, i.role, i.occurred_at,
          t.project_id, t.source_environment_id AS environment_id, t.source_thread_id AS thread_id,
          json_extract(t.summary_json, '$.title') AS title,
          json_extract(t.summary_json, '$.archived') AS archived,
          substr(i.body, 1, ${LEAD_SNIPPET_CHARS * 2}) AS lead
        FROM fork_library_search_items AS i
        JOIN fork_library_threads AS t ON t.library_id = i.library_id
        WHERE i.id IN ${sql.in(entries.map(({ id }) => id))}`;
    const textIds = entries.filter((entry) => entry.text).map(({ id }) => id);
    const snippets = new Map(
      textIds.length === 0
        ? []
        : (yield* sql<{ id: number; snippet: string }>`
              SELECT rowid AS id,
                snippet(fork_library_search, 0, char(57344), char(57345), '…', ${SNIPPET_TOKENS}) AS snippet
              FROM fork_library_search
              WHERE fork_library_search MATCH ${match} AND rowid IN ${sql.in(textIds)}`).map(
            (row) => [row.id, row.snippet],
          ),
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const hits = yield* Effect.forEach(
      // An item removed since the rankings were read is left out of the page.
      entries.flatMap((entry) => {
        const row = byId.get(entry.id);
        return row === undefined ? [] : [{ entry, row }];
      }),
      ({ entry, row }) => {
        const snippet = snippets.get(entry.id);
        return decodeHit({
          id: row.library_id,
          projectId: row.project_id,
          environmentId: row.environment_id,
          threadId: row.thread_id,
          title: row.title ?? "",
          archived: row.archived === 1,
          itemId: row.item_id,
          position: row.position,
          role: row.role,
          ...(snippet === undefined
            ? { snippet: leadSnippet(row.lead), highlights: [] }
            : parseLibrarySnippet(snippet)),
          occurredAt: row.occurred_at,
          rank: entry.score,
          match: entry.text ? (entry.semantic ? "both" : "text") : "semantic",
        });
      },
    );
    return {
      hits,
      nextCursor:
        ranked.length > offset + limit && offset + limit <= MAX_OFFSET
          ? `${offset + limit}.${bound}`
          : null,
    } satisfies LibrarySearchResult;
  }, Effect.mapError(io));
  const search = Effect.fnUntraced(function* (input: LibrarySearchRequest) {
    const match = libraryMatchQuery(input.query);
    const since = isoTime(input.since);
    const until = isoTime(input.until);
    const page =
      input.cursor === undefined ? { offset: 0, bound: undefined } : decodeCursor(input.cursor);
    if (
      page === null ||
      since === null ||
      until === null ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > LIBRARY_SEARCH_MAX_LIMIT
    )
      return yield* invalid();
    const { offset } = page;
    // One statement reads the first page and its bound, so both see the same index.
    const bound =
      page.bound === undefined
        ? sql`(SELECT coalesce(max(id), 0) FROM fork_library_search_items)`
        : sql`${page.bound}`;
    if (match === null) return { hits: [], nextCursor: null } satisfies LibrarySearchResult;
    /** The items a search may return, on `fork_library_search_items AS i` and `fork_library_threads AS t`. */
    const scope = (bound: Fragment) => sql`i.id <= ${bound}
        AND coalesce(json_extract(t.summary_json, '$.deleted'), 0) = 0
        ${input.projectId === undefined ? sql`` : sql`AND t.project_id = ${input.projectId}`}
        ${input.environmentId === undefined ? sql`` : sql`AND t.source_environment_id = ${input.environmentId}`}
        ${since === undefined ? sql`` : sql`AND i.occurred_at >= ${since}`}
        ${until === undefined ? sql`` : sql`AND i.occurred_at < ${until}`}`;
    if (semantic !== null && input.semantic !== false && !hasQuotedPhrase(input.query)) {
      const query = yield* semantic.embedQuery(input.query).pipe(
        Effect.timeoutOption(QUERY_EMBED_TIMEOUT),
        Effect.catchCause((cause) =>
          Effect.logWarning("Semantic search fell back to words", cause).pipe(
            Effect.as(Option.none()),
          ),
        ),
      );
      if (Option.isSome(query))
        return yield* blended(input.limit, offset, page.bound, match, query.value, scope);
    }
    const rows = yield* sql<{
      library_id: string;
      position: number;
      item_id: string;
      role: string;
      occurred_at: string;
      project_id: string;
      environment_id: string;
      thread_id: string;
      title: string | null;
      archived: number | null;
      snippet: string;
      rank: number;
      bound: number;
    }>`
      SELECT i.library_id, i.position, i.item_id, i.role, i.occurred_at,
        t.project_id, t.source_environment_id AS environment_id, t.source_thread_id AS thread_id,
        json_extract(t.summary_json, '$.title') AS title,
        json_extract(t.summary_json, '$.archived') AS archived,
        snippet(fork_library_search, 0, char(57344), char(57345), '…', ${SNIPPET_TOKENS}) AS snippet,
        fork_library_search.rank AS rank, ${bound} AS bound
      FROM fork_library_search
      JOIN fork_library_search_items AS i ON i.id = fork_library_search.rowid
      JOIN fork_library_threads AS t ON t.library_id = i.library_id
      WHERE fork_library_search MATCH ${match} AND ${scope(bound)}
      ORDER BY fork_library_search.rank, i.id
      LIMIT ${input.limit + 1} OFFSET ${offset}`.pipe(Effect.mapError(io));
    const hits = yield* Effect.forEach(rows.slice(0, input.limit), (row) =>
      decodeHit({
        id: row.library_id,
        projectId: row.project_id,
        environmentId: row.environment_id,
        threadId: row.thread_id,
        title: row.title ?? "",
        archived: row.archived === 1,
        itemId: row.item_id,
        position: row.position,
        role: row.role,
        ...parseLibrarySnippet(row.snippet),
        occurredAt: row.occurred_at,
        // bm25 scores are negative, lower being better.
        rank: -row.rank,
      }).pipe(Effect.mapError(io)),
    );
    return {
      hits,
      nextCursor:
        rows.length > input.limit && offset + input.limit <= MAX_OFFSET
          ? `${offset + input.limit}.${rows[0]!.bound}`
          : null,
    } satisfies LibrarySearchResult;
  });
  return { index, search, semantic };
});
