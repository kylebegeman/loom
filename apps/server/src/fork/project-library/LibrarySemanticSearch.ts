import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";
import type { Fragment } from "effect/sql/Statement";
import { LIBRARY_EMBEDDING_MAX_CHARS, type LibraryEmbedderShape } from "./LibraryEmbedder.ts";

/**
 * Semantic search over the history search index.
 *
 * `fork_library_search_vectors` holds one embedding per `fork_library_search_items` row, keyed by
 * the same id, as int8 values with a per-vector scale (384 bytes for the pinned model). A row
 * without a vector is pending; a background loop embeds pending rows newest first, so the backfill
 * resumes wherever it stopped and new history is embedded shortly after it is saved. Triggers drop
 * a vector when its item is removed or its text changes. Queries scan the vectors in process: at
 * 60,000 items that stays well under the time a full-text query over common words takes, and no
 * native SQLite extension is needed.
 */

// Created with IF NOT EXISTS because parallel packets renumber this migration at merge.
export const LIBRARY_SEMANTIC_SEARCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS fork_library_search_vectors (id INTEGER PRIMARY KEY, model TEXT NOT NULL, scale REAL NOT NULL, vector BLOB NOT NULL)`,
  `CREATE TRIGGER IF NOT EXISTS fork_library_search_vectors_item_delete AFTER DELETE ON fork_library_search_items BEGIN DELETE FROM fork_library_search_vectors WHERE id = old.id; END`,
  `CREATE TRIGGER IF NOT EXISTS fork_library_search_vectors_item_update AFTER UPDATE OF body ON fork_library_search_items WHEN substr(old.body, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) IS NOT substr(new.body, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) BEGIN DELETE FROM fork_library_search_vectors WHERE id = old.id; END`,
] as const;

// Items embedded per write. Each takes 5-80 ms in the worker, so a batch commits within about a second.
const BATCH_SIZE = 16;
// Rest between batches, leaving the CPU to ingest and queries during a long backfill.
const BATCH_PAUSE = Duration.millis(250);
// Lets the server finish starting before the model loads.
const STARTUP_DELAY = Duration.seconds(30);
// Catches items saved by a path that does not signal a refresh.
const IDLE_POLL = Duration.minutes(5);
const RETRY_AFTER_FAILURE = Duration.minutes(10);
/** Candidates the semantic side contributes to one search. */
export const SEMANTIC_DEPTH = 100;
/**
 * Cosine similarity below which an item is not offered as a meaning match. With the pinned model,
 * short coding-chat messages unrelated to a query scored -0.06 to 0.21 and rephrasings of it 0.28
 * to 0.9.
 */
export const SEMANTIC_MIN_SIMILARITY = 0.25;
// The constant in reciprocal rank fusion. 60 is the value from the original paper and common use.
const FUSION_K = 60;

/** Store a unit vector as int8 values scaled by its largest component. */
export function quantizeEmbedding(vector: Float32Array) {
  let largest = 0;
  for (const value of vector) largest = Math.max(largest, Math.abs(value));
  const scale = largest / 127;
  const values = new Int8Array(vector.length);
  if (scale > 0)
    for (let index = 0; index < vector.length; index++)
      values[index] = Math.round(vector[index]! / scale);
  return { scale, bytes: new Uint8Array(values.buffer) };
}

/** Cosine similarity of a unit query vector and a stored vector. */
export function storedSimilarity(query: Float32Array, scale: number, bytes: Uint8Array) {
  const values = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = Math.min(query.length, values.length);
  let sum = 0;
  for (let index = 0; index < length; index++) sum += query[index]! * values[index]!;
  return sum * scale;
}

/**
 * Blend two ranked lists of item ids by reciprocal rank fusion: each list adds 1 / (k + rank) to
 * an item's score. Ties keep the lower id first, as full-text ranking does.
 */
export function fuseRankings(text: ReadonlyArray<number>, semantic: ReadonlyArray<number>) {
  const fused = new Map<number, { id: number; score: number; text: boolean; semantic: boolean }>();
  const add = (ids: ReadonlyArray<number>, list: "text" | "semantic") =>
    ids.forEach((id, index) => {
      const entry = fused.get(id) ?? { id, score: 0, text: false, semantic: false };
      if (entry[list]) return;
      entry.score += 1 / (FUSION_K + index + 1);
      entry[list] = true;
      fused.set(id, entry);
    });
  add(text, "text");
  add(semantic, "semantic");
  return [...fused.values()].sort((a, b) => b.score - a.score || a.id - b.id);
}

export const makeLibrarySemanticSearch = (embedder: LibraryEmbedderShape) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const model = embedder.model;

    /** Embed up to `limit` pending items, newest first. Returns how many were pending. */
    const embedPending = Effect.fnUntraced(function* (limit: number) {
      const pending = yield* sql<{ id: number; text: string }>`
        SELECT i.id, substr(i.body, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) AS text
        FROM fork_library_search_items AS i
        WHERE NOT EXISTS (SELECT 1 FROM fork_library_search_vectors AS v WHERE v.id = i.id)
        ORDER BY i.id DESC LIMIT ${limit}`;
      const embedded = yield* Effect.forEach(pending, (item) =>
        embedder
          .embed(item.text)
          .pipe(Effect.map((vector) => ({ item, ...quantizeEmbedding(vector) }))),
      );
      // An item edited or removed while it was embedded keeps no vector, and is embedded again.
      yield* sql.withTransaction(
        Effect.forEach(
          embedded,
          ({ item, scale, bytes }) => sql`
            INSERT OR REPLACE INTO fork_library_search_vectors (id, model, scale, vector)
            SELECT ${item.id}, ${model}, ${scale}, ${bytes}
            WHERE EXISTS (SELECT 1 FROM fork_library_search_items
              WHERE id = ${item.id} AND substr(body, 1, ${LIBRARY_EMBEDDING_MAX_CHARS}) = ${item.text})`,
          { discard: true },
        ),
      );
      return pending.length;
    });

    /**
     * Embed history until none is pending, then wait for `revisions` to change. Runs for the life
     * of the Library; a failure is logged and retried later rather than ending it.
     */
    const backfill = (revisions: SubscriptionRef.SubscriptionRef<number>) =>
      Effect.gen(function* () {
        yield* Effect.sleep(STARTUP_DELAY);
        // Vectors from another model cannot be compared with this one's queries.
        yield* sql`DELETE FROM fork_library_search_vectors WHERE model <> ${model}`;
        while (true) {
          const seen = yield* SubscriptionRef.get(revisions);
          const pending = yield* embedPending(BATCH_SIZE).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Semantic search could not embed history", cause).pipe(
                Effect.andThen(Effect.sleep(RETRY_AFTER_FAILURE)),
                Effect.as(0),
              ),
            ),
          );
          // A full batch may leave more behind; a partial one emptied the queue.
          if (pending === BATCH_SIZE) {
            yield* Effect.sleep(BATCH_PAUSE);
            continue;
          }
          yield* SubscriptionRef.changes(revisions).pipe(
            Stream.filter((revision) => revision !== seen),
            Stream.take(1),
            Stream.runDrain,
            Effect.timeoutOption(IDLE_POLL),
          );
        }
      });

    /**
     * Ids of the items closest in meaning to `query`, best first, among the items `scope` admits.
     * `scope` is a condition on `fork_library_search_items AS i` and `fork_library_threads AS t`.
     */
    const nearest = Effect.fnUntraced(function* (query: Float32Array, scope: Fragment) {
      const rows = yield* sql<{ id: number; scale: number; vector: Uint8Array }>`
        SELECT v.id, v.scale, v.vector FROM fork_library_search_vectors AS v
        JOIN fork_library_search_items AS i ON i.id = v.id
        JOIN fork_library_threads AS t ON t.library_id = i.library_id
        WHERE v.model = ${model} AND ${scope}`;
      const scored: { id: number; similarity: number }[] = [];
      for (const row of rows) {
        const similarity = storedSimilarity(query, row.scale, row.vector);
        if (similarity >= SEMANTIC_MIN_SIMILARITY) scored.push({ id: row.id, similarity });
      }
      return scored
        .sort((a, b) => b.similarity - a.similarity || a.id - b.id)
        .slice(0, SEMANTIC_DEPTH)
        .map(({ id }) => id);
    });

    return { embedQuery: embedder.embed, embedPending, backfill, nearest };
  });
