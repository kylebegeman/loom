import type { OrchestrationV2AppThread } from "@t3tools/contracts";
import { LibraryError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";

/**
 * Purge rules: a purge keeps `thread.created`, `thread.deleted` and the thread row, and runs only
 * after retention and the Library's acknowledgement (unbound threads get an acknowledged row;
 * pending imports wait like bound threads). Events go newest first so kept rows find their prompts,
 * and linked threads purge together since their projections read each other's rows.
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
 * True once a purge emptied the stream: only the kept events remain, with stream versions missing
 * between them. Versions otherwise have no gaps, so a conversation that only had creation and
 * deletion still sends its deletion, and compaction always leaves something between the two.
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

/**
 * Fails when a command would copy history from, or write into, a deleted thread: a purge may be
 * emptying the source, and writes into a deleted thread only postpone its purge. The source is
 * checked before the dispatch mode limit, so a deleted one is never refused as needing a mode a
 * caller could approve for nothing.
 */
export const refuseDeleted = (thread: Pick<OrchestrationV2AppThread, "id" | "deletedAt">) =>
  thread.deletedAt === null ? Effect.void : Effect.fail(`Thread ${thread.id} is deleted.`);

const WITHHELD_DETAIL =
  "This conversation was deleted, so its history is no longer sent to the Library.";

/** The only error that tells Library replication to stop sending a conversation. */
export const withheldError = () =>
  new LibraryError({ reason: "not-found", detail: WITHHELD_DETAIL });

export const isWithheldError = (error: LibraryError) =>
  error.reason === "not-found" && error.detail === WITHHELD_DETAIL;
