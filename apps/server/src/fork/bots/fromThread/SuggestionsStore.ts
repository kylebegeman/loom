import { ThreadId } from "@t3tools/contracts";
import {
  BOTS_SUGGESTION_MAX_THREADS,
  BotCreator,
  type BotSuggestion,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { isoAt } from "../BotBudgets.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Threads count toward a suggestion when they opened within this long of the newest one. */
export const SUGGESTION_WINDOW_MS = 14 * DAY_MS;
/** Threads with the same shape in the window before Loom suggests a bot. */
export const SUGGESTION_THRESHOLD = 3;
/** New threads after a dismissal that bring a suggestion back, once. */
export const REOPEN_AFTER = 5;
/** A shape with no new thread for this long is forgotten. */
export const SHAPE_IDLE_MS = 30 * DAY_MS;
export const SHAPES_KEPT = 2_000;
export const SUGGESTIONS_KEPT = 200;
const ENTRIES_KEPT = 50;
const PRUNE_BATCH = 100;

const Entry = Schema.Struct({ threadId: ThreadId, at: Schema.String, by: BotCreator });
type Entry = typeof Entry.Type;
const decodeEntries = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Entry)));
const encodeEntries = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Entry)));

interface ShapeRow {
  readonly shape_key: string;
  readonly shape: string;
  readonly entries_json: string;
  readonly total_count: number;
  readonly last_seen_at: string;
}

interface SuggestionRow extends ShapeRow {
  readonly dismissed_at: string | null;
  readonly dismissed_total: number;
  readonly reopened: number;
}

const toSuggestion = (row: SuggestionRow): BotSuggestion | null => {
  const entries = Option.getOrNull(decodeEntries(row.entries_json));
  if (entries === null || entries.length === 0) return null;
  const agents = entries.filter((entry) => entry.by === "agent").length;
  return {
    id: row.shape_key,
    shape: row.shape,
    threadIds: entries.slice(0, BOTS_SUGGESTION_MAX_THREADS).map((entry) => entry.threadId),
    count: entries.length,
    firstSeenAt: entries.at(-1)!.at,
    lastSeenAt: entries[0]!.at,
    startedBy: agents * 2 > entries.length ? "agent" : "user",
    dismissedAt: row.dismissed_at,
  };
};

export interface BriefInput {
  readonly threadId: ThreadId;
  readonly key: string;
  readonly shape: string;
  readonly at: string;
  readonly by: BotCreator;
}

export const makeSuggestionsStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readSuggestion = Effect.fnUntraced(function* (key: string) {
    const rows =
      yield* sql<SuggestionRow>`SELECT s.*, g.dismissed_at, g.dismissed_total, g.reopened FROM fork_bots_brief_shapes s JOIN fork_bots_suggestions g ON g.shape_key = s.shape_key WHERE s.shape_key = ${key}`;
    return rows[0] ? toSuggestion(rows[0]) : null;
  });

  return {
    isThreadRecorded: Effect.fn("BotSuggestionsStore.isThreadRecorded")(function* (
      threadId: ThreadId,
    ) {
      const rows = yield* sql<{
        thread_id: string;
      }>`SELECT thread_id FROM fork_bots_brief_threads WHERE thread_id = ${threadId}`;
      return rows.length > 0;
    }),

    /** Remembers a thread whose first brief came before Loom was watching, so it never counts. */
    markSeen: Effect.fn("BotSuggestionsStore.markSeen")(function* (threadId: ThreadId, at: string) {
      yield* sql`INSERT INTO fork_bots_brief_threads (thread_id, shape_key, created_at) VALUES (${threadId}, '', ${at}) ON CONFLICT(thread_id) DO NOTHING`;
    }),

    /**
     * Counts a thread's first brief toward its shape and creates or reopens the suggestion once
     * the window holds enough threads. Returns false when the thread was already counted.
     */
    recordBrief: Effect.fn("BotSuggestionsStore.recordBrief")(function* (input: BriefInput) {
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const inserted = yield* sql<{
            thread_id: string;
          }>`INSERT INTO fork_bots_brief_threads (thread_id, shape_key, created_at) VALUES (${input.threadId}, ${input.key}, ${input.at}) ON CONFLICT(thread_id) DO NOTHING RETURNING thread_id`;
          if (inserted.length === 0) return false;

          const existing =
            (yield* sql<ShapeRow>`SELECT * FROM fork_bots_brief_shapes WHERE shape_key = ${input.key}`)[0];
          const previous =
            existing === undefined
              ? []
              : Option.getOrElse(decodeEntries(existing.entries_json), () => []);
          const entry: Entry = { threadId: input.threadId, at: input.at, by: input.by };
          const sorted = [entry, ...previous].toSorted((a, b) => b.at.localeCompare(a.at));
          const newest = Date.parse(sorted[0]!.at);
          const entries = sorted
            .filter((item) => newest - Date.parse(item.at) <= SUGGESTION_WINDOW_MS)
            .slice(0, ENTRIES_KEPT);
          const total = (existing?.total_count ?? 0) + 1;
          const lastSeenAt = sorted[0]!.at;
          yield* sql`INSERT INTO fork_bots_brief_shapes (shape_key, shape, entries_json, total_count, last_seen_at) VALUES (${input.key}, ${input.shape}, ${encodeEntries(entries)}, ${total}, ${lastSeenAt}) ON CONFLICT(shape_key) DO UPDATE SET entries_json = excluded.entries_json, total_count = excluded.total_count, last_seen_at = excluded.last_seen_at`;

          const suggestion = (yield* sql<{
            dismissed_at: string | null;
            dismissed_total: number;
            reopened: number;
          }>`SELECT dismissed_at, dismissed_total, reopened FROM fork_bots_suggestions WHERE shape_key = ${input.key}`)[0];
          if (suggestion === undefined) {
            if (entries.length >= SUGGESTION_THRESHOLD)
              yield* sql`INSERT INTO fork_bots_suggestions (shape_key, created_at, updated_at) VALUES (${input.key}, ${input.at}, ${input.at})`;
          } else if (
            suggestion.dismissed_at !== null &&
            suggestion.reopened === 0 &&
            total >= suggestion.dismissed_total + REOPEN_AFTER
          ) {
            yield* sql`UPDATE fork_bots_suggestions SET dismissed_at = NULL, reopened = 1, updated_at = ${input.at} WHERE shape_key = ${input.key}`;
          } else {
            yield* sql`UPDATE fork_bots_suggestions SET updated_at = ${input.at} WHERE shape_key = ${input.key}`;
          }
          return true;
        }),
      );
    }),

    /** Forgets idle shapes and threads, and keeps both tables bounded. */
    prune: Effect.fn("BotSuggestionsStore.prune")(function* (nowMs: number) {
      const idleBefore = isoAt(nowMs - SHAPE_IDLE_MS);
      yield* sql`DELETE FROM fork_bots_brief_shapes WHERE shape_key IN (SELECT shape_key FROM fork_bots_brief_shapes WHERE last_seen_at < ${idleBefore} ORDER BY last_seen_at LIMIT ${PRUNE_BATCH})`;
      yield* sql`DELETE FROM fork_bots_brief_shapes WHERE shape_key IN (SELECT shape_key FROM fork_bots_brief_shapes ORDER BY last_seen_at DESC LIMIT -1 OFFSET ${SHAPES_KEPT})`;
      // A thread whose brief is that old will not start another; at worst an edit counts again.
      yield* sql`DELETE FROM fork_bots_brief_threads WHERE thread_id IN (SELECT thread_id FROM fork_bots_brief_threads WHERE created_at < ${idleBefore} ORDER BY created_at LIMIT ${PRUNE_BATCH * 5})`;
      yield* sql`DELETE FROM fork_bots_suggestions WHERE shape_key NOT IN (SELECT shape_key FROM fork_bots_brief_shapes)`;
      yield* sql`DELETE FROM fork_bots_suggestions WHERE shape_key IN (SELECT shape_key FROM fork_bots_suggestions ORDER BY updated_at DESC LIMIT -1 OFFSET ${SUGGESTIONS_KEPT})`;
    }),

    list: Effect.fn("BotSuggestionsStore.list")(function* (dismissed: boolean) {
      const rows = dismissed
        ? yield* sql<SuggestionRow>`SELECT s.*, g.dismissed_at, g.dismissed_total, g.reopened FROM fork_bots_brief_shapes s JOIN fork_bots_suggestions g ON g.shape_key = s.shape_key WHERE g.dismissed_at IS NOT NULL ORDER BY g.dismissed_at DESC`
        : yield* sql<SuggestionRow>`SELECT s.*, g.dismissed_at, g.dismissed_total, g.reopened FROM fork_bots_brief_shapes s JOIN fork_bots_suggestions g ON g.shape_key = s.shape_key WHERE g.dismissed_at IS NULL ORDER BY s.last_seen_at DESC`;
      return rows.flatMap((row) => toSuggestion(row) ?? []);
    }),

    /** Null when there is no such suggestion. */
    setDismissed: Effect.fn("BotSuggestionsStore.setDismissed")(function* (
      key: string,
      dismissed: boolean,
      at: string,
    ) {
      if (dismissed)
        yield* sql`UPDATE fork_bots_suggestions SET dismissed_at = ${at}, updated_at = ${at}, dismissed_total = (SELECT total_count FROM fork_bots_brief_shapes WHERE shape_key = ${key}) WHERE shape_key = ${key}`;
      else
        yield* sql`UPDATE fork_bots_suggestions SET dismissed_at = NULL, updated_at = ${at} WHERE shape_key = ${key}`;
      return yield* readSuggestion(key);
    }),
  };
});

export type SuggestionsStore = Effect.Success<typeof makeSuggestionsStore>;
