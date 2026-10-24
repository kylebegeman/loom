import { LibraryError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

/**
 * Deleted-thread history purge rules shared by the purge, the Library history gate and the
 * attachment hold. A purge keeps a thread's `thread.created` and `thread.deleted` events and its
 * thread row, so verify and rebuild still produce the deleted thread, and removes everything
 * else. Invariants:
 *
 * - A thread is purged only after it has been deleted for {@link DELETED_HISTORY_RETENTION_MS}
 *   and, once it has a Library replication row, only after the Library acknowledged its first
 *   deletion with nothing left in the outbox. An unbound thread without a row gets a row that
 *   records the deletion as acknowledged before its first delete, so every purge, finished or
 *   interrupted, is visible to {@link withheldCondition} from the start. No code removes those
 *   rows; {@link purgedShape} still recognizes a finished purge if they are wiped. An unbound
 *   thread that a Library migration export has not been activated for yet waits like a bound one,
 *   because the Library may hold it live; see `recordPendingImport`.
 * - Events go newest first: a slimmed subagent prompt only points at an older event of its own
 *   stream, so every row left behind still finds its prompt.
 * - Linked threads (subagent parents and children, forks, context transfers, shared provider
 *   sessions) are purged only together, because their projections read each other's rows.
 */
export const DELETED_HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;

// Deletion writes `thread.deleted` ahead of a few run and subagent updates, so it is almost always
// among a stream's newest events. No index finds it directly.
const DELETION_SCAN_EVENTS = 256;

export const KEPT_EVENT_TYPES = ["thread.created", "thread.deleted"] as const;

type ThreadRef = string | Statement.Fragment;

/**
 * The thread's first `thread.deleted` sequence, or NULL. A draining subagent or provider turn can
 * write more events after the deletion than the newest-events window holds; only then does
 * COALESCE, which SQLite evaluates lazily, run the scan of the whole stream.
 */
export const deletionSequence = (sql: SqlClient.SqlClient, threadId: ThreadRef) => sql`COALESCE(
  (
    SELECT MIN(recent.sequence) FROM (
      SELECT sequence, event_type
      FROM orchestration_events INDEXED BY idx_orchestration_events_agent_stream_sequence
      WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND stream_id = ${threadId}
      ORDER BY sequence DESC LIMIT ${DELETION_SCAN_EVENTS}
    ) AS recent
    WHERE recent.event_type = 'thread.deleted'
  ),
  (
    SELECT MIN(sequence)
    FROM orchestration_events INDEXED BY idx_orchestration_events_agent_stream_sequence
    WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND stream_id = ${threadId}
      AND event_type = 'thread.deleted'
  )
)`;

/**
 * True once a purge emptied the stream: only the kept events are left and stream versions are
 * missing between them. Versions are assigned without gaps, so a conversation that never had
 * more than its creation and deletion keeps adjacent ones and still sends its deletion.
 * Compaction keeps the newest whole-thread event and both ends of every message and node, so it
 * never removes everything between the two.
 */
export const purgedShape = (sql: SqlClient.SqlClient, threadId: ThreadRef) => sql`(
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM orchestration_events INDEXED BY idx_orchestration_events_agent_stream_sequence
    WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND stream_id = ${threadId}
      AND event_type NOT IN ${sql.in(KEPT_EVENT_TYPES)}
  ) THEN (
    SELECT MAX(stream_version) - MIN(stream_version) >= COUNT(*)
    FROM orchestration_events INDEXED BY idx_orchestration_events_agent_stream_sequence
    WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND stream_id = ${threadId}
  ) ELSE 0 END
)`;

/**
 * Whether a deleted thread's history may no longer go to the Library: the Library already holds
 * its deletion, or a purge already emptied it. The caller checks the thread is deleted. The
 * purged-shape branch keeps a finished purge withheld even if the replication rows are wiped,
 * for example to point the computer at a new Library authority.
 */
export const withheldCondition = (
  sql: SqlClient.SqlClient,
  threadId: ThreadRef,
  options?: { readonly replicationRows: boolean },
) => sql`(
  ${deletionSequence(sql, threadId)} IS NOT NULL AND (
    ${
      options?.replicationRows === false
        ? sql`0`
        : sql`EXISTS (
      SELECT 1 FROM fork_library_source_threads AS replicated
      WHERE replicated.thread_id = ${threadId}
        AND replicated.acknowledged_sequence >= ${deletionSequence(sql, threadId)}
    )`
    }
    OR ${purgedShape(sql, threadId)}
  )
)`;

export const isWithheld = (sql: SqlClient.SqlClient, threadId: string) =>
  sql<{ readonly withheld: number }>`SELECT ${withheldCondition(sql, threadId)} AS withheld`.pipe(
    Effect.map((rows) => rows[0]?.withheld === 1),
  );

const WITHHELD_DETAIL =
  "This conversation was deleted, so its history is no longer sent to the Library.";

/** The only error that tells Library replication to stop sending a conversation. */
export const withheldError = () =>
  new LibraryError({ reason: "not-found", detail: WITHHELD_DETAIL });

export const isWithheldError = (error: LibraryError) =>
  error.reason === "not-found" && error.detail === WITHHELD_DETAIL;
