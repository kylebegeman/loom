import { ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Statement from "effect/sql/Statement";
import { resolveAttachmentPathById } from "../../attachmentStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerActivation from "../../serverActivation.ts";
import { pendingImportThreadIds } from "../project-library/LibraryMigration.ts";
import * as LibraryPublisher from "../project-library/LibraryPublisher.ts";
import * as LibraryWorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import {
  DELETED_HISTORY_RETENTION_MS,
  KEPT_EVENT_TYPES,
  deletionSequence,
} from "./deletedHistory.ts";

export class DeletedThreadHistoryError extends Schema.TaggedError<DeletedThreadHistoryError>()(
  "DeletedThreadHistoryError",
  { cause: Schema.Defect() },
) {}

export interface DeletedThreadHistoryPass {
  /** Threads whose held attachment files were removed. */
  readonly released: number;
  /** Deleted Library threads whose files wait for the Library's acknowledgement. */
  readonly held: number;
  readonly purgedThreads: number;
  readonly deletedEvents: number;
  readonly deletedRows: number;
  /**
   * The page, time or release budget ended this pass before every eligible thread was released
   * or purged.
   */
  readonly pending: boolean;
}

export class DeletedThreadHistory extends Context.Service<
  DeletedThreadHistory,
  {
    readonly pass: (options?: {
      readonly maxPages?: number;
    }) => Effect.Effect<DeletedThreadHistoryPass, DeletedThreadHistoryError>;
  }
>()("t3/fork/deleted-history/DeletedThreadHistory") {}

const PAGE_ROWS = 50;
// A page always takes its first row, so one huge payload still makes progress.
const PAGE_BYTES = 1024 * 1024;
// About 3,000 deleted threads hold about 3 million rows. A pass a minute of up to 6,000 rows
// clears them in under ten hours while each statement holds the writer only briefly.
const PASS_PAGES = 120;
const PASS_MS = 10_000;
const RELEASE_THREADS_PER_PASS = 100;
// The checkpoint worker starts flushing at 1,000 unflushed frames and pauses writers at 10,000.
// A page waits for it to catch up rather than add to that backlog.
const WAL_BEHIND_FRAMES = 1000;
const WAL_WAIT = Duration.millis(100);
const FIRST_PASS_DELAY = Duration.minutes(5);
const BEHIND_INTERVAL = Duration.minutes(1);
const IDLE_INTERVAL = Duration.minutes(30);

// Every projection row a thread owns. Context transfers belong to both ends; linked threads are
// purged only together, so either end may remove them.
const PROJECTION_ROWS: ReadonlyArray<{
  readonly table: string;
  readonly column: string;
  readonly payload: boolean;
}> = [
  { table: "orchestration_v2_turn_item_positions", column: "thread_id", payload: false },
  { table: "orchestration_v2_projection_turn_items", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_messages", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_plans", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_runtime_requests", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_provider_turns", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_checkpoints", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_checkpoint_scopes", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_context_handoffs", column: "thread_id", payload: true },
  {
    table: "orchestration_v2_projection_context_transfers",
    column: "source_thread_id",
    payload: true,
  },
  {
    table: "orchestration_v2_projection_context_transfers",
    column: "target_thread_id",
    payload: true,
  },
  { table: "orchestration_v2_projection_subagents", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_nodes", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_provider_threads", column: "thread_id", payload: true },
  {
    table: "orchestration_v2_projection_provider_session_bindings",
    column: "thread_id",
    payload: false,
  },
  { table: "orchestration_v2_projection_provider_sessions", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_run_attempts", column: "thread_id", payload: true },
  { table: "orchestration_v2_projection_runs", column: "thread_id", payload: true },
];

type Verdict =
  | { readonly kind: "absent" }
  | { readonly kind: "blocked" }
  | {
      readonly kind: "eligible";
      readonly deletion: number;
      readonly lastSequence: number;
      readonly replicated: boolean;
    };

// Rows that only an unfinished purge still has; a finished one leaves none of them.
const remainingWork = (sql: SqlClient.SqlClient, threadId: Statement.Fragment) =>
  sql.or([
    sql`EXISTS (
      SELECT 1 FROM orchestration_events INDEXED BY idx_orchestration_events_agent_stream_sequence
      WHERE application_event_version = 2 AND aggregate_kind = 'thread' AND stream_id = ${threadId}
        AND event_type NOT IN ${sql.in(KEPT_EVENT_TYPES)})`,
    ...PROJECTION_ROWS.map(
      ({ table, column }) =>
        sql`EXISTS (SELECT 1 FROM ${sql(table)} WHERE ${sql(column)} = ${threadId})`,
    ),
  ]);

const byteCapped = <A extends { readonly bytes: number }>(rows: ReadonlyArray<A>) => {
  const page: A[] = [];
  let bytes = 0;
  for (const row of rows) {
    if (page.length > 0 && bytes + row.bytes > PAGE_BYTES) break;
    page.push(row);
    bytes += row.bytes;
  }
  return page;
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const workspaces = yield* LibraryWorkspaceStore.LibraryWorkspaceStore;
  // Without a Library connection replication never runs, so nothing acknowledges a deletion.
  const { enabled: replicating } = yield* LibraryPublisher.LibraryPublisher;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  // A restart forgets it and checks each held thread once more, which is what makes the release
  // durable without a table of its own.
  const released = new Set<string>();
  // The newest event of each purge whose files are gone. A purge that resumes over later passes
  // reads every message payload for attachment ids, so it does that again only after an event
  // newer than this one, which may have added a file.
  const filesRemovedThrough = new Map<string, number>();
  // A pass pages thousands of statements, so they run untraced and the pass span carries counts.
  // The per-thread and per-page helpers below are fnUntraced for the same reason: they run up to
  // thousands of times inside the pass span, which reports what they did.
  const untraced = Effect.withTracerEnabled(false);
  const read = <A, E>(statement: Effect.Effect<A, E>) =>
    statement.pipe(NodeSqliteClient.readOnly, untraced);
  // Before 3.51 SQLite runs NOOP as a PASSIVE checkpoint on the writer, so older versions pace
  // by the page and time budgets alone, like the shared client's checkpoint worker.
  let walCounters: boolean | undefined;

  // Removing every file before any row keeps the attachment ids readable until the files are gone.
  const removeAttachments = Effect.fnUntraced(function* (threadId: string) {
    const ids = yield* read(projections.getThreadAttachmentIds(ThreadId.make(threadId))).pipe(
      Effect.orElseSucceed(() => null),
    );
    if (ids === null) return false;
    const removed = yield* Effect.forEach(
      ids,
      (attachmentId) => {
        const file = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId,
        });
        return file === null
          ? Effect.succeed(true)
          : fs.remove(file, { force: true }).pipe(
              Effect.as(true),
              Effect.orElseSucceed(() => false),
            );
      },
      { concurrency: 4 },
    );
    return removed.every(Boolean);
  });

  const pass = Effect.fn("DeletedThreadHistory.pass")(
    function* (options?: { readonly maxPages?: number }) {
      const maxPages = options?.maxPages ?? PASS_PAGES;
      const startedAt = yield* Clock.currentTimeMillis;
      if (walCounters === undefined) {
        const version =
          (yield* read(sql<{ readonly version: string }>`SELECT sqlite_version() AS version`))[0]
            ?.version ?? "";
        const [major = 0, minor = 0] = version.split(".").map(Number);
        walCounters = major > 3 || (major === 3 && minor >= 51);
      }
      const readWal = walCounters;
      const highWater =
        (yield* read(sql<{ readonly sequence: number | null }>`
          SELECT MAX(sequence) AS sequence FROM orchestration_events
          WHERE application_event_version = 2 AND aggregate_kind = 'thread'`))[0]?.sequence ?? 0;
      // Read before the bindings: activation binds an export's conversations before removing its
      // record, so a missing one is in `bound`. An export recorded after this read saw every thread
      // this pass may purge as deleted. An unreadable record fails the pass after the release,
      // which needs neither.
      const pendingImports = yield* Effect.result(
        pendingImportThreadIds(config.stateDir).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
        ),
      );
      const bound = new Set((yield* workspaces.bindings).map((entry) => String(entry.threadId)));
      let pages = 0;
      let maxPageMs = 0;
      let walWaits = 0;
      let stopped = false;
      let releasedCount = 0;
      let held = 0;
      let purgedThreads = 0;
      let deletedEvents = 0;
      let deletedRows = 0;
      let waiting = 0;
      let skipped = 0;
      let aborted = 0;
      let attachmentFailures = 0;

      const timeLeft = Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) - startedAt < PASS_MS) return true;
        stopped = true;
        return false;
      });
      const budgetLeft = Effect.gen(function* () {
        while (true) {
          if (pages >= maxPages) stopped = true;
          if (stopped || !(yield* timeLeft)) return false;
          if (!readWal) return true;
          // NOOP reads the WAL counters without checkpointing or waiting for admission.
          const wal = (yield* sql<{
            readonly log: number;
            readonly checkpointed: number;
          }>`PRAGMA wal_checkpoint(NOOP)`.pipe(untraced))[0];
          if (wal === undefined || wal.log < 0 || wal.log - wal.checkpointed < WAL_BEHIND_FRAMES)
            return true;
          // The checkpoint worker is already flushing these frames; the pass resumes after it.
          walWaits += 1;
          yield* Effect.sleep(WAL_WAIT);
        }
      });
      // Runs once per page; the pass span reports pages and the slowest one instead.
      const timedPage = Effect.fnUntraced(function* <A, E>(write: Effect.Effect<A, E>) {
        const before = yield* Clock.currentTimeMillis;
        const result = yield* write.pipe(untraced);
        maxPageMs = Math.max(maxPageMs, (yield* Clock.currentTimeMillis) - before);
        pages += 1;
        return result;
      });

      // Release: held files of replicated or bound threads go once the Library holds the deletion,
      // or at once without a Library connection, even if a linked live thread still shows them.
      // Only threads with message or turn item rows can have files, which skips finished purges.
      const releaseRows = yield* read(sql<{
        readonly thread_id: string;
        readonly replicated: number;
        readonly acknowledged: number;
      }>`
        SELECT t.thread_id, r.thread_id IS NOT NULL AS replicated,
          CASE WHEN r.thread_id IS NULL THEN 0 ELSE
            r.acknowledged_sequence >= ${deletionSequence(sql, sql`t.thread_id`)}
            AND NOT EXISTS (
              SELECT 1 FROM fork_library_source_outbox AS o WHERE o.thread_id = t.thread_id)
          END AS acknowledged
        FROM orchestration_v2_projection_threads AS t
        LEFT JOIN fork_library_source_threads AS r ON r.thread_id = t.thread_id
        WHERE t.deleted_at IS NOT NULL AND (
          EXISTS (
            SELECT 1 FROM orchestration_v2_projection_messages AS m WHERE m.thread_id = t.thread_id)
          OR EXISTS (
            SELECT 1 FROM orchestration_v2_projection_turn_items AS i WHERE i.thread_id = t.thread_id))
        ORDER BY t.deleted_at DESC`);
      let releaseChecks = 0;
      // Releases left for a later pass bring it a minute later, like an unfinished purge.
      let releasePending = false;
      for (const row of releaseRows) {
        if (released.has(row.thread_id)) continue;
        if (row.replicated !== 1 && !bound.has(row.thread_id)) continue;
        if (replicating && row.acknowledged !== 1) {
          held += 1;
          continue;
        }
        if (releasePending || releaseChecks >= RELEASE_THREADS_PER_PASS || !(yield* timeLeft)) {
          releasePending = true;
          continue;
        }
        releaseChecks += 1;
        if (yield* removeAttachments(row.thread_id)) {
          released.add(row.thread_id);
          releasedCount += 1;
        } else attachmentFailures += 1;
      }

      const importing = yield* Effect.fromResult(pendingImports);

      // Purge: candidates are evaluated lazily, with their linked threads, until the budget ends.
      const verdicts = new Map<string, Verdict>();
      const evaluate = Effect.fnUntraced(function* (threadId: string) {
        const known = verdicts.get(threadId);
        if (known !== undefined) return known;
        const row = (yield* read(sql<{
          readonly deleted_at: string | null;
          readonly deletion: number | null;
          readonly acknowledged_sequence: number | null;
          readonly pending: number;
          readonly last_sequence: number | null;
        }>`
          SELECT t.deleted_at,
            ${deletionSequence(sql, threadId)} AS deletion,
            r.acknowledged_sequence,
            EXISTS (SELECT 1 FROM fork_library_source_outbox WHERE thread_id = ${threadId}) AS pending,
            (SELECT MAX(sequence) FROM orchestration_events
              INDEXED BY idx_orchestration_events_agent_stream_sequence
              WHERE application_event_version = 2 AND aggregate_kind = 'thread'
                AND stream_id = ${threadId}) AS last_sequence
          FROM orchestration_v2_projection_threads AS t
          LEFT JOIN fork_library_source_threads AS r ON r.thread_id = t.thread_id
          WHERE t.thread_id = ${threadId}`))[0];
        const deletedAt = row?.deleted_at == null ? Number.NaN : Date.parse(row.deleted_at);
        const verdict: Verdict =
          row === undefined
            ? { kind: "absent" }
            : row.deletion === null ||
                !(deletedAt + DELETED_HISTORY_RETENTION_MS <= startedAt) ||
                (row.acknowledged_sequence === null
                  ? bound.has(threadId) || importing.has(threadId)
                  : row.pending === 1 || row.acknowledged_sequence < row.deletion)
              ? { kind: "blocked" }
              : {
                  kind: "eligible",
                  deletion: row.deletion,
                  lastSequence: row.last_sequence ?? 0,
                  replicated: row.acknowledged_sequence !== null,
                };
        verdicts.set(threadId, verdict);
        return verdict;
      });
      // Loaded once a pass needs it. Links made later name the thread in an event after
      // `highWater`, which the purge's guard refuses.
      let links: Map<string, Set<string>> | undefined;
      const loadLinks = Effect.fn("DeletedThreadHistory.loadLinks")(function* () {
        const graph = new Map<string, Set<string>>();
        const link = (a: string | null, b: string | null) => {
          if (a === null || b === null || a === b) return;
          for (const [from, to] of [
            [a, b],
            [b, a],
          ] as const) {
            const neighbors = graph.get(from) ?? new Set<string>();
            neighbors.add(to);
            graph.set(from, neighbors);
          }
        };
        for (const row of yield* read(sql<{
          readonly thread_id: string;
          readonly parent: string | null;
          readonly forked: string | null;
        }>`
          SELECT thread_id,
            json_extract(payload_json, '$.lineage.parentThreadId') AS parent,
            json_extract(payload_json, '$.forkedFrom.threadId') AS forked
          FROM orchestration_v2_projection_threads
          WHERE json_extract(payload_json, '$.lineage.parentThreadId') IS NOT NULL
            OR json_extract(payload_json, '$.forkedFrom.threadId') IS NOT NULL`)) {
          link(row.thread_id, row.parent);
          link(row.thread_id, row.forked);
        }
        for (const row of yield* read(sql<{ readonly a: string; readonly b: string | null }>`
          SELECT source_thread_id AS a, target_thread_id AS b
          FROM orchestration_v2_projection_context_transfers
          WHERE source_thread_id != target_thread_id
          UNION ALL
          SELECT thread_id AS a, child_thread_id AS b FROM orchestration_v2_projection_subagents
          WHERE child_thread_id IS NOT NULL AND child_thread_id != thread_id`))
          link(row.a, row.b);
        const sessions = new Map<string, string>();
        for (const row of yield* read(sql<{
          readonly provider_session_id: string;
          readonly thread_id: string;
        }>`
          SELECT provider_session_id, thread_id FROM orchestration_v2_projection_provider_sessions
          WHERE thread_id IS NOT NULL
          UNION ALL
          SELECT provider_session_id, thread_id
          FROM orchestration_v2_projection_provider_session_bindings`)) {
          const first = sessions.get(row.provider_session_id);
          if (first === undefined) sessions.set(row.provider_session_id, row.thread_id);
          else link(first, row.thread_id);
        }
        links = graph;
        return graph;
      });
      // A thread goes only with every thread it shares rows with; any of them still live,
      // unacknowledged or recent keeps the whole group.
      const groupEligible = Effect.fnUntraced(function* (threadId: string) {
        const graph = links ?? (yield* loadLinks());
        const seen = new Set([threadId]);
        const queue = [threadId];
        while (queue.length > 0) {
          const next = queue.pop()!;
          if ((yield* evaluate(next)).kind === "blocked") return false;
          for (const neighbor of graph.get(next) ?? []) {
            if (seen.has(neighbor)) continue;
            seen.add(neighbor);
            queue.push(neighbor);
          }
        }
        return true;
      });

      const purgeThread = Effect.fnUntraced(function* (
        threadId: string,
        verdict: Extract<Verdict, { readonly kind: "eligible" }>,
      ) {
        const { deletion, lastSequence } = verdict;
        // Every write re-checks in the same statement that the Library still holds the deletion and
        // no event arrived since evaluation: none on this stream, and none after `highWater` on
        // another stream naming it, such as a fork or context transfer. A mention that is not a
        // link only postpones the purge.
        const guard = sql`
          EXISTS (
            SELECT 1 FROM fork_library_source_threads
            WHERE thread_id = ${threadId} AND acknowledged_sequence >= ${deletion})
          AND NOT EXISTS (SELECT 1 FROM fork_library_source_outbox WHERE thread_id = ${threadId})
          AND NOT EXISTS (
            SELECT 1 FROM orchestration_events
            INDEXED BY idx_orchestration_events_agent_stream_sequence
            WHERE application_event_version = 2 AND aggregate_kind = 'thread'
              AND stream_id = ${threadId} AND sequence > ${lastSequence})
          AND NOT EXISTS (
            SELECT 1 FROM orchestration_events
            WHERE sequence > ${highWater} AND stream_id != ${threadId}
              AND instr(payload_json, ${threadId}) > 0)`;
        let recorded = verdict.replicated;
        // An unbound thread has no replication row. Writing one that records the deletion as
        // acknowledged makes the gate withhold it before anything is deleted, and keeps a later
        // binding from snapshotting what is left.
        const recordDeletion = Effect.gen(function* () {
          if (recorded) return true;
          if ((yield* workspaces.getBinding(ThreadId.make(threadId))) !== null) return false;
          yield* sql`
            INSERT INTO fork_library_source_threads (thread_id, queued_sequence, acknowledged_sequence)
            VALUES (${threadId}, ${deletion}, ${deletion})
            ON CONFLICT(thread_id) DO NOTHING`.pipe(untraced);
          recorded = true;
          return true;
        });
        if ((filesRemovedThrough.get(threadId) ?? -1) < lastSequence) {
          if (!(yield* removeAttachments(threadId))) {
            attachmentFailures += 1;
            return "kept" as const;
          }
          filesRemovedThrough.set(threadId, lastSequence);
        }
        released.add(threadId);
        let cursor = Math.min(highWater, lastSequence + 1);
        while (true) {
          const rows = yield* read(sql<{ readonly sequence: number; readonly bytes: number }>`
            SELECT sequence, octet_length(payload_json) AS bytes
            FROM orchestration_events INDEXED BY idx_orchestration_events_agent_stream_sequence
            WHERE application_event_version = 2 AND aggregate_kind = 'thread'
              AND stream_id = ${threadId} AND sequence < ${cursor}
              AND event_type NOT IN ${sql.in(KEPT_EVENT_TYPES)}
            ORDER BY sequence DESC LIMIT ${PAGE_ROWS}`);
          if (rows.length === 0) break;
          if (!(yield* budgetLeft)) return "stopped" as const;
          if (!(yield* recordDeletion)) return "kept" as const;
          const page = byteCapped(rows);
          const sequences = page.map((row) => row.sequence);
          // NOT INDEXED keeps a page to seeks of its listed rowids. Without planner statistics
          // SQLite otherwise ranges over the whole event log, or a projection table's thread
          // index, on every page while it holds the writer.
          const removed = yield* timedPage(sql<{ readonly sequence: number }>`
            DELETE FROM orchestration_events NOT INDEXED
            WHERE sequence IN ${sql.in(sequences)}
              AND application_event_version = 2 AND aggregate_kind = 'thread'
              AND stream_id = ${threadId} AND sequence < ${highWater}
              AND event_type NOT IN ${sql.in(KEPT_EVENT_TYPES)}
              AND ${guard}
            RETURNING sequence`);
          deletedEvents += removed.length;
          if (removed.length !== page.length) return "aborted" as const;
          cursor = sequences.at(-1)!;
          yield* Effect.yieldNow;
        }
        for (const { table, column, payload } of PROJECTION_ROWS) {
          while (true) {
            // Unordered, a page reads only its own index entries; ordering would sort every row
            // the thread still has on each page.
            const rows = yield* read(sql<{ readonly row_id: number; readonly bytes: number }>`
              SELECT rowid AS row_id, ${payload ? sql`octet_length(payload_json)` : sql`0`} AS bytes
              FROM ${sql(table)} WHERE ${sql(column)} = ${threadId}
              LIMIT ${PAGE_ROWS}`);
            if (rows.length === 0) break;
            if (!(yield* budgetLeft)) return "stopped" as const;
            if (!(yield* recordDeletion)) return "kept" as const;
            const page = byteCapped(rows);
            // NOT INDEXED for the same reason as an event page.
            const removed = yield* timedPage(sql<{ readonly row_id: number }>`
              DELETE FROM ${sql(table)} NOT INDEXED
              WHERE rowid IN ${sql.in(page.map((row) => row.row_id))}
                AND ${sql(column)} = ${threadId} AND ${guard}
              RETURNING rowid AS row_id`);
            deletedRows += removed.length;
            if (removed.length !== page.length) return "aborted" as const;
            yield* Effect.yieldNow;
          }
        }
        filesRemovedThrough.delete(threadId);
        return "purged" as const;
      });

      // Probing for remaining rows here keeps finished purges, which accumulate forever, out of
      // every pass, including the first after a restart.
      const deletedThreads = yield* read(sql<{
        readonly thread_id: string;
        readonly deleted_at: string;
      }>`
        SELECT t.thread_id, t.deleted_at FROM orchestration_v2_projection_threads AS t
        WHERE t.deleted_at IS NOT NULL AND ${remainingWork(sql, sql`t.thread_id`)}`);
      const candidates = deletedThreads
        .filter((row) => Date.parse(row.deleted_at) + DELETED_HISTORY_RETENTION_MS <= startedAt)
        .toSorted((a, b) => Date.parse(a.deleted_at) - Date.parse(b.deleted_at));
      for (const candidate of candidates) {
        if (stopped || !(yield* timeLeft)) break;
        const threadId = candidate.thread_id;
        if (!(yield* groupEligible(threadId))) {
          waiting += 1;
          continue;
        }
        const verdict = yield* evaluate(threadId);
        if (verdict.kind !== "eligible") continue;
        // The newest event in the store must stay: verify compares it with the projection. Any
        // later event lets a following pass purge the thread, so this alone is not pending work.
        if (verdict.lastSequence >= highWater) {
          skipped += 1;
          continue;
        }
        const outcome = yield* purgeThread(threadId, verdict);
        if (outcome === "purged") purgedThreads += 1;
        else if (outcome === "aborted") aborted += 1;
        else if (outcome === "kept") waiting += 1;
      }

      const pending = stopped || releasePending;
      yield* Effect.annotateCurrentSpan({
        "deleted_history.released": releasedCount,
        "deleted_history.held": held,
        "deleted_history.candidates": candidates.length,
        "deleted_history.purged_threads": purgedThreads,
        "deleted_history.deleted_events": deletedEvents,
        "deleted_history.deleted_rows": deletedRows,
        "deleted_history.pages": pages,
        "deleted_history.max_page_ms": maxPageMs,
        "deleted_history.waiting": waiting,
        "deleted_history.skipped": skipped,
        "deleted_history.aborted": aborted,
        "deleted_history.attachment_failures": attachmentFailures,
        "deleted_history.wal_waits": walWaits,
        "deleted_history.pending": pending,
      });
      return {
        released: releasedCount,
        held,
        purgedThreads,
        deletedEvents,
        deletedRows,
        pending,
      } satisfies DeletedThreadHistoryPass;
    },
    (effect) => lock.withPermit(effect),
    Effect.mapError((cause) => new DeletedThreadHistoryError({ cause })),
  );

  // A failing pass waits for the idle interval, so a persistent fault never loops.
  let loggedFailure: string | null = null;
  yield* ServerActivation.forkParked(
    Effect.gen(function* () {
      let delay = FIRST_PASS_DELAY;
      while (true) {
        yield* Effect.sleep(delay);
        delay = yield* pass().pipe(
          Effect.matchCauseEffect({
            onFailure: (cause) => {
              const key = Cause.pretty(cause);
              if (key === loggedFailure) return Effect.succeed(IDLE_INTERVAL);
              loggedFailure = key;
              return Effect.logWarning("Deleted thread history cleanup failed", { cause }).pipe(
                Effect.as(IDLE_INTERVAL),
              );
            },
            onSuccess: (result) =>
              Effect.sync(() => {
                loggedFailure = null;
                return result.pending ? BEHIND_INTERVAL : IDLE_INTERVAL;
              }),
          }),
        );
      }
    }),
  );
  return DeletedThreadHistory.of({ pass });
});

export const layer = Layer.effect(DeletedThreadHistory, make);
