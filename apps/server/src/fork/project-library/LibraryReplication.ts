import { ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryThreadArchive,
  LibraryWorkingCopy,
  type LibraryInfo,
  type LibraryIngestHistoryRequest,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as NodeBuffer from "node:buffer";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ServerActivation from "../../serverActivation.ts";
import * as DocumentPublication from "./LibraryDocumentPublication.ts";
import * as CopyHealthPublication from "./LibraryCopyHealthPublication.ts";
import * as HistorySource from "./LibraryHistorySource.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as Workspace from "./LibraryWorkspace.ts";

export class LibraryReplication extends Context.Service<
  LibraryReplication,
  {
    readonly drain: Effect.Effect<void, LibraryError>;
    /**
     * Uploads every conversation's latest history now, without waiting for snapshot spacing. A
     * snapshot that does not fit the outbox keeps waiting and is reported as the storage limit.
     */
    readonly flush: Effect.Effect<void, LibraryError>;
    /** Publishes this computer's copy health now, if it changed since the last report. */
    readonly reportCopyHealth: Effect.Effect<void, LibraryError>;
    readonly status: Effect.Effect<
      {
        readonly enabled: boolean;
        readonly journalId: string | null;
        readonly acknowledgedSequence: number;
        readonly pendingEntries: number;
        readonly pendingBytes: number;
        readonly maxPendingBytes: number;
        readonly lastFailure: LibraryError["reason"] | null;
        readonly threads: readonly {
          readonly threadId: ThreadId;
          readonly queuedSequence: number;
          readonly acknowledgedSequence: number;
          readonly currentSequence: number;
          readonly pending: boolean;
        }[];
      },
      LibraryError
    >;
  }
>()("t3/fork/project-library/LibraryReplication") {}

const archiveJson = Schema.toCodecJson(LibraryThreadArchive);
const encodeCopy = Schema.encodeEffect(Schema.fromJsonString(LibraryWorkingCopy));
// Encoding stringifies separately: the schema's JSON step reports V8's string limit as an
// invalid value, which would hide an oversized conversation behind a generic failure.
const encodeArchiveJson = Schema.encodeEffect(archiveJson);
const decodeArchive = Schema.decodeEffect(Schema.fromJsonString(archiveJson));
const isLibraryError = Schema.is(LibraryError);
const mapIo = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io", cause }),
    ),
  );
const EVENT_SCAN_LIMIT = 512;
const PUBLISH_BATCH_LIMIT = 10;
const PUBLISH_BATCH_BYTES = 8 * 1024 * 1024;
// Every snapshot carries a conversation's whole history, which the Library parses, writes and
// compresses again. A conversation is snapshotted at most once a second for every 256 KiB it
// holds: a small one at every milestone, a 200 MB one about every 13 minutes.
const SNAPSHOT_SPACING_BYTES_PER_SECOND = 256 * 1024;
// A pull-request link update is a milestone because compaction deletes it once a later reorder
// carries the whole thread, and navigation alone never uploads.
const MILESTONE_EVENTS = `event_type IN ('thread.created','thread.metadata-updated','thread.archived','thread.unarchived','thread.deleted','thread.settled','thread.unsettled','thread.snoozed','thread.unsnoozed','thread.provider-switched','thread.model-selection-updated','thread.runtime-mode-updated','thread.interaction-mode-updated','run.created','checkpoint.captured','checkpoint.rollback-requested','runtime-request.updated','context-handoff.updated','context-transfer.created','context-transfer.updated','thread.pinned','thread.unpinned','thread.auto-settle-set','thread.pull-request-synced','thread.pull-request-link-updated')
  OR (event_type='run.updated' AND json_extract(payload_json,'$.status') NOT IN ('preparing','starting','running'))
  OR (event_type='message.updated' AND json_extract(payload_json,'$.streaming')=0)`;
// Navigation changes nothing a reader of the history sees.
const NAVIGATION_EVENTS = `event_type IN ('thread.visited','thread.marked-unread','thread.pin-reordered','thread.active-reordered')`;

const make = Effect.gen(function* () {
  const publisher = yield* Publisher.LibraryPublisher;
  if (!publisher.enabled)
    return LibraryReplication.of({
      drain: Effect.void,
      flush: Effect.void,
      reportCopyHealth: Effect.void,
      status: Effect.succeed({
        enabled: false,
        journalId: null,
        acknowledgedSequence: 0,
        pendingEntries: 0,
        pendingBytes: 0,
        maxPendingBytes: 0,
        lastFailure: null,
        threads: [],
      }),
    });
  const sql = yield* SqlClient.SqlClient;
  const maxPendingBytes = yield* Config.Int("LOOM_LIBRARY_MAX_PENDING_BYTES").pipe(
    Config.withDefault(512 * 1024 * 1024),
  );
  if (maxPendingBytes <= 0) return yield* new LibraryError({ reason: "invalid" });
  const source = yield* HistorySource.LibraryHistorySource;
  const crypto = yield* Crypto.Crypto;
  const workspaces = yield* WorkspaceStore.LibraryWorkspaceStore;
  const workspace = yield* Effect.serviceOption(Workspace.LibraryWorkspace);
  const identity = yield* ServerEnvironmentIdentity;
  const environmentId = yield* identity.getEnvironmentId;
  const lock = yield* Semaphore.make(1);
  const failure = yield* Ref.make<LibraryError["reason"] | null>(null);
  const milestone = sql.literal(MILESTONE_EVENTS);
  const navigation = sql.literal(NAVIGATION_EVENTS);
  // Capture changes these under the drain lock, and status reads deferred. Threads with a
  // milestone not yet snapshotted wait here for their spacing and for their previous snapshot's
  // acknowledgement. A restart forgets them, so the first capture finds them again in the event
  // log.
  const deferred = new Set<ThreadId>();
  const spacedUntil = new Map<ThreadId, number>();
  // The size of each deferred thread's last snapshot that did not fit the outbox. These keep the
  // storage limit reported while they wait, and retry as soon as that size fits.
  const oversized = new Map<ThreadId, number>();
  let reconciled = false;
  // octet_length reads each payload's size from its record header, not its pages.
  const outboxBytes = sql<{
    bytes: number;
  }>`SELECT COALESCE(SUM(octet_length(payload_json)),0) AS bytes FROM fork_library_source_outbox`.pipe(
    Effect.map((rows) => rows[0]?.bytes ?? 0),
  );
  const readState = sql<{
    journal_id: string;
    environment_id: string;
    authority_id: string;
    authority_epoch: number;
    scan_sequence: number;
    acknowledged_sequence: number;
  }>`SELECT journal_id,environment_id,authority_id,authority_epoch,scan_sequence,acknowledged_sequence FROM fork_library_source_state WHERE key='host'`;
  const state = mapIo(
    Effect.gen(function* () {
      const current = (yield* readState)[0];
      if (current === undefined) return yield* new LibraryError({ reason: "blocked" });
      return current;
    }),
  );
  const ensureAuthority = (authority: LibraryInfo) =>
    mapIo(
      sql.withTransaction(
        Effect.gen(function* () {
          const current = (yield* readState)[0];
          if (current !== undefined) {
            if (
              current.environment_id !== environmentId ||
              current.authority_id !== authority.authorityId ||
              current.authority_epoch !== authority.authorityEpoch
            )
              return yield* new LibraryError({ reason: "blocked" });
            return;
          }
          const journalId = yield* randomUuidV4;
          const bindings = yield* workspaces.bindings;
          const imported = bindings.map((entry) => entry.importedHistory);
          const scanSequence =
            imported.length > 0 &&
            imported.every(
              (entry) =>
                entry &&
                entry.authorityId === authority.authorityId &&
                entry.authorityEpoch === authority.authorityEpoch,
            )
              ? Math.min(...imported.map((entry) => entry!.sourceEventSequence))
              : 0;
          yield* sql`INSERT INTO fork_library_source_state (key,journal_id,environment_id,authority_id,authority_epoch,scan_sequence) VALUES ('host',${journalId},${environmentId},${authority.authorityId},${authority.authorityEpoch},${scanSequence})`;
        }),
      ),
    );
  const queueThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    const current = yield* sql<{
      queued_sequence: number;
    }>`SELECT queued_sequence FROM fork_library_source_threads WHERE thread_id=${threadId}`;
    const snapshot = yield* source.snapshotThread({ threadId });
    if (current[0] !== undefined && current[0].queued_sequence >= snapshot.summary.sequence) {
      oversized.delete(threadId);
      return "current" as const;
    }
    const json = yield* encodeArchiveJson(snapshot);
    // A history longer than V8 can hold in one string is larger than any outbox.
    const payload = yield* Effect.try({
      // @effect-diagnostics-next-line preferSchemaOverJson:off - The schema's JSON step hides V8's string limit; see encodeArchiveJson.
      try: () => JSON.stringify(json),
      catch: (cause) =>
        new LibraryError({ reason: cause instanceof RangeError ? "storage-limit" : "io", cause }),
    }).pipe(
      Effect.catchIf(
        (error) => error.reason === "storage-limit",
        () => Effect.succeed(null),
      ),
    );
    const bytes =
      payload === null ? Number.POSITIVE_INFINITY : NodeBuffer.Buffer.byteLength(payload);
    // Spacing also follows a snapshot that did not fit, so an oversized one is not encoded again
    // on every drain.
    spacedUntil.set(
      threadId,
      (yield* Clock.currentTimeMillis) +
        Math.floor(
          Math.min(bytes, NodeBuffer.constants.MAX_STRING_LENGTH) /
            SNAPSHOT_SPACING_BYTES_PER_SECOND,
        ) *
          1000,
    );
    if (payload === null || (yield* outboxBytes) + bytes > maxPendingBytes) {
      oversized.set(threadId, bytes);
      return "waiting" as const;
    }
    oversized.delete(threadId);
    yield* sql`INSERT INTO fork_library_source_outbox (thread_id,source_sequence,payload_json) VALUES (${threadId},${snapshot.summary.sequence},${payload})`;
    yield* sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence) VALUES (${threadId},${snapshot.summary.sequence}) ON CONFLICT(thread_id) DO UPDATE SET queued_sequence=excluded.queued_sequence`;
    return "queued" as const;
  });
  // Untraced like queueThread: the background drain captures every five seconds. A flush passes
  // the threads it has already snapshotted.
  const capture = Effect.fnUntraced(function* (flushed: Set<ThreadId> | undefined) {
    const current = yield* state;
    const bindings = yield* workspaces.bindings;
    const bound = new Set(bindings.map((entry) => entry.threadId));
    const queued = new Set(
      (yield* sql<{
        thread_id: string;
      }>`SELECT thread_id FROM fork_library_source_threads`).map((entry) => entry.thread_id),
    );
    // A new binding needs an initial snapshot even when no later execution event arrives.
    for (const entry of bindings) {
      if (queued.has(entry.threadId)) continue;
      const imported = entry.importedHistory;
      if (
        imported &&
        imported.authorityId === current.authority_id &&
        imported.authorityEpoch === current.authority_epoch
      ) {
        // Activation verified these exact bytes against this authority before staging the
        // host binding. Seed acknowledgements without replaying the entire source history.
        yield* sql`INSERT INTO fork_library_source_threads(thread_id,queued_sequence,acknowledged_sequence) VALUES (${entry.threadId},${imported.sequence},${imported.sequence})`;
      } else deferred.add(entry.threadId);
    }
    if (!reconciled) {
      // Compaction keeps only a thread's newest whole-thread event, so a later reorder can
      // replace the milestone that made it dirty. A reorder after the queued snapshot therefore
      // counts too, at the cost of one extra snapshot per restart.
      const unsnapshotted = yield* sql<{ thread_id: string }>`
        SELECT thread_id FROM fork_library_source_threads t WHERE EXISTS (
          SELECT 1 FROM orchestration_events
          WHERE application_event_version=2 AND aggregate_kind='thread' AND stream_id=t.thread_id
            AND sequence>t.queued_sequence
            AND ((${milestone}) OR event_type IN ('thread.pin-reordered','thread.active-reordered')))`;
      for (const row of unsnapshotted) {
        const threadId = ThreadId.make(row.thread_id);
        if (bound.has(threadId)) deferred.add(threadId);
      }
      reconciled = true;
    }
    if (flushed !== undefined) {
      // A flush uploads every newer event a reader would see, not only milestones.
      const behind = yield* sql<{ thread_id: string }>`
        SELECT thread_id FROM fork_library_source_threads t WHERE EXISTS (
          SELECT 1 FROM orchestration_events
          WHERE application_event_version=2 AND aggregate_kind='thread' AND stream_id=t.thread_id
            AND sequence>t.queued_sequence AND NOT (${navigation}))`;
      for (const row of behind) {
        const threadId = ThreadId.make(row.thread_id);
        if (bound.has(threadId) && !flushed.has(threadId)) deferred.add(threadId);
      }
    }
    const events = yield* sql<{ sequence: number; stream_id: string; milestone: number }>`
      SELECT sequence,stream_id,CASE WHEN ${milestone} THEN 1 ELSE 0 END AS milestone
      FROM orchestration_events
      WHERE application_event_version=2 AND aggregate_kind='thread' AND sequence>${current.scan_sequence}
      ORDER BY sequence LIMIT ${EVENT_SCAN_LIMIT}`;
    const dirty = new Map<ThreadId, number>();
    for (const event of events) {
      const threadId = ThreadId.make(event.stream_id);
      if (event.milestone === 1 && bound.has(threadId)) dirty.set(threadId, event.sequence);
    }
    for (const [threadId, sequence] of dirty) {
      const rows = yield* sql<{
        queued_sequence: number;
      }>`SELECT queued_sequence FROM fork_library_source_threads WHERE thread_id=${threadId}`;
      if ((rows[0]?.queued_sequence ?? -1) < sequence) deferred.add(threadId);
    }
    const last = events.at(-1);
    if (last !== undefined)
      yield* sql`UPDATE fork_library_source_state SET scan_sequence=${last.sequence} WHERE key='host'`;
    const now = yield* Clock.currentTimeMillis;
    let added = false;
    for (const threadId of deferred) {
      if (!bound.has(threadId)) {
        deferred.delete(threadId);
        oversized.delete(threadId);
        continue;
      }
      if (flushed?.has(threadId)) continue;
      if ((spacedUntil.get(threadId) ?? 0) > now) {
        const waiting = oversized.get(threadId);
        // A flush ignores spacing. A snapshot that did not fit retries before its spacing ends
        // only once the outbox has room for its last size.
        if (
          waiting === undefined
            ? flushed === undefined
            : waiting > maxPendingBytes - (yield* outboxBytes)
        )
          continue;
      }
      // The Library accepts a journal only in order, so a queued snapshot is never replaced.
      // Later milestones wait for its acknowledgement and then share one fresh snapshot.
      const outstanding =
        (yield* sql<{
          count: number;
        }>`SELECT COUNT(*) AS count FROM fork_library_source_outbox WHERE thread_id=${threadId}`)[0]
          ?.count ?? 0;
      if (outstanding > 0) continue;
      // A snapshot that does not fit stays deferred without holding back smaller ones. Any
      // other failure ends this pass and keeps the conversation deferred.
      const result = yield* sql.withTransaction(queueThread(threadId));
      if (result === "waiting") continue;
      deferred.delete(threadId);
      flushed?.add(threadId);
      if (result === "queued") added = true;
    }
    return { queued: added, waiting: [...deferred].some((threadId) => oversized.has(threadId)) };
  }, mapIo);
  const publish = mapIo(
    Effect.gen(function* () {
      const current = yield* state;
      const rows = yield* sql<{
        sequence: number;
        thread_id: string;
        source_sequence: number;
        payload_json: string;
      }>`SELECT sequence,thread_id,source_sequence,payload_json FROM fork_library_source_outbox WHERE sequence>${current.acknowledged_sequence} ORDER BY sequence LIMIT ${PUBLISH_BATCH_LIMIT}`;
      const batch: (typeof rows)[number][] = [];
      let bytes = 0;
      for (const row of rows) {
        const size = NodeBuffer.Buffer.byteLength(row.payload_json);
        if (batch.length > 0 && bytes + size > PUBLISH_BATCH_BYTES) break;
        batch.push(row);
        bytes += size;
      }
      if (batch.length === 0) return false;
      const entries = yield* Effect.forEach(batch, (row) =>
        decodeArchive(row.payload_json).pipe(
          Effect.map((thread) => ({ sequence: row.sequence, thread })),
        ),
      );
      const copies = new Set<string>();
      for (const entry of entries) {
        const copyId = entry.thread.summary.workingCopyId;
        if (copyId !== null && !copies.has(copyId)) {
          const { copy } = yield* workspaces.get(copyId);
          const fingerprint = Hex.encode(
            yield* crypto.digest("SHA-256", new TextEncoder().encode(yield* encodeCopy(copy))),
          );
          yield* publisher.registerCopy({
            requestId: `${current.journal_id}:copy:${fingerprint}`,
            authorityId: current.authority_id,
            authorityEpoch: current.authority_epoch,
            copy,
          });
          copies.add(copyId);
        }
        // History is acknowledged only after every referenced attachment has verified storage.
        yield* publisher.publishAttachments(entry.thread);
      }
      const through = batch.at(-1)!.sequence;
      const request: LibraryIngestHistoryRequest = {
        requestId: `${current.journal_id}:${current.acknowledged_sequence}:${through}`,
        sourceEnvironmentId: environmentId,
        journalId: current.journal_id,
        authorityId: current.authority_id,
        authorityEpoch: current.authority_epoch,
        fromSequence: current.acknowledged_sequence,
        entries,
      };
      const response = yield* publisher.ingest(request);
      if (
        response.sourceEnvironmentId !== environmentId ||
        response.journalId !== current.journal_id ||
        response.lastSequence < through
      )
        return yield* new LibraryError({ reason: "sequence-conflict" });
      // A cursor beyond this batch does not prove any later local entry was uploaded.
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const row of batch)
            yield* sql`UPDATE fork_library_source_threads SET acknowledged_sequence=MAX(acknowledged_sequence,${row.source_sequence}) WHERE thread_id=${row.thread_id}`;
          yield* sql`UPDATE fork_library_source_state SET acknowledged_sequence=${through} WHERE key='host'`;
          yield* sql`DELETE FROM fork_library_source_outbox WHERE sequence<=${through}`;
        }),
      );
      return true;
    }),
  );
  const publishedCopies = new Map<string, string>();
  const publishCopyChanges = Effect.fn("LibraryReplication.publishCopyChanges")(function* () {
    if (Option.isNone(workspace)) return;
    const current = yield* state;
    for (const { copy } of yield* workspaces.receipts) {
      if (
        copy.environmentId !== environmentId ||
        copy.state === "preparing" ||
        copy.state === "failed"
      )
        continue;
      const fingerprint = Hex.encode(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(yield* encodeCopy(copy))),
      );
      if (publishedCopies.get(copy.id) === fingerprint) continue;
      yield* publisher.registerCopy({
        requestId: `${current.journal_id}:copy:${fingerprint}`,
        authorityId: current.authority_id,
        authorityEpoch: current.authority_epoch,
        copy,
      });
      publishedCopies.set(copy.id, fingerprint);
    }
  }, mapIo);

  // Status checks every bound conversation, so keep its per-thread reads untraced.
  const threadStatus = Effect.fnUntraced(function* (threadId: ThreadId) {
    const row = (yield* sql<{
      queued_sequence: number;
      acknowledged_sequence: number;
    }>`SELECT queued_sequence,acknowledged_sequence FROM fork_library_source_threads WHERE thread_id=${threadId}`)[0];
    const eventTail =
      (yield* sql<{
        sequence: number;
      }>`SELECT COALESCE(MAX(sequence),0) AS sequence FROM orchestration_events WHERE application_event_version=2 AND aggregate_kind='thread' AND stream_id=${threadId} AND NOT (${navigation})`)[0]
        ?.sequence ?? 0;
    const latest = Math.max(eventTail, row?.queued_sequence ?? 0);
    const pending =
      (yield* sql<{
        count: number;
      }>`SELECT COUNT(*) AS count FROM fork_library_source_outbox WHERE thread_id=${threadId}`)[0]
        ?.count ?? 0;
    return {
      threadId,
      queuedSequence: row?.queued_sequence ?? 0,
      acknowledgedSequence: row?.acknowledged_sequence ?? 0,
      currentSequence: latest,
      // Compaction can replace a deferred milestone with navigation the tail ignores.
      pending:
        row === undefined ||
        pending > 0 ||
        latest > row.acknowledged_sequence ||
        deferred.has(threadId),
    };
  }, mapIo);
  const isHistoryAcknowledged = Effect.fn("LibraryReplication.isHistoryAcknowledged")(function* (
    threadId: ThreadId,
  ) {
    // A previous watermark cannot prove an unbound conversation is still replicated.
    if ((yield* workspaces.getBinding(threadId)) === null) return false;
    return !(yield* threadStatus(threadId)).pending;
  });

  const pass = Effect.fnUntraced(function* (flushed: Set<ThreadId> | undefined) {
    const initialized = (yield* readState)[0] !== undefined;
    if (!initialized) yield* ensureAuthority(yield* publisher.info);
    const captured = yield* capture(flushed);
    // Keep capturing committed milestones during an outage once this journal is established.
    if (initialized) yield* ensureAuthority(yield* publisher.info);
    const published = yield* publish;
    yield* publishCopyChanges();
    if (Option.isSome(workspace)) {
      yield* workspace.value.cleanupTemporaryCopies(isHistoryAcknowledged);
      yield* publishCopyChanges();
    }
    return { progressed: captured.queued || published, waiting: captured.waiting };
  }, mapIo);
  const settle = (waiting: boolean) =>
    waiting ? Effect.fail(new LibraryError({ reason: "storage-limit" })) : Ref.set(failure, null);
  const drain = lock
    .withPermit(pass(undefined).pipe(Effect.flatMap((result) => settle(result.waiting))))
    .pipe(Effect.tapError((error) => Ref.set(failure, error.reason)));
  // One acknowledgement can let a conversation's next snapshot in, or free room for another's, so
  // a flush continues while it makes progress. It snapshots each conversation at most once, so
  // an active conversation cannot keep it running.
  const flush = lock
    .withPermit(
      Effect.gen(function* () {
        const flushed = new Set<ThreadId>();
        let result = yield* pass(flushed);
        while (result.progressed) result = yield* pass(flushed);
        return yield* settle(result.waiting);
      }),
    )
    .pipe(Effect.tapError((error) => Ref.set(failure, error.reason)));
  const status = mapIo(
    Effect.gen(function* () {
      const current = (yield* readState)[0];
      const outbox = (yield* sql<{
        count: number;
        bytes: number;
      }>`SELECT COUNT(*) AS count,COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))),0) AS bytes FROM fork_library_source_outbox`)[0];
      const count = outbox?.count ?? 0;
      const bindings = yield* workspaces.bindings;
      const threads = yield* Effect.forEach(bindings, (entry) => threadStatus(entry.threadId));
      return {
        enabled: true,
        journalId: current?.journal_id ?? null,
        acknowledgedSequence: current?.acknowledged_sequence ?? 0,
        pendingEntries: count,
        pendingBytes: outbox?.bytes ?? 0,
        maxPendingBytes,
        lastFailure: yield* Ref.get(failure),
        threads,
      };
    }),
  );
  yield* ServerActivation.forkParked(
    drain.pipe(Effect.ignore, Effect.repeat(Schedule.spaced("5 seconds"))),
  );
  // Copy health rides the same journal fence as history, but never waits on the history outbox.
  const copyHealth = yield* CopyHealthPublication.makeCopyHealthPublication({
    environmentId,
    publisher,
    workspaces,
    source: yield* CopyHealthPublication.LibraryCopyHealthSource,
    authority: lock.withPermit(
      mapIo(
        Effect.gen(function* () {
          if ((yield* readState)[0] === undefined) yield* ensureAuthority(yield* publisher.info);
          const current = yield* state;
          return {
            journalId: current.journal_id,
            authorityId: current.authority_id,
            authorityEpoch: current.authority_epoch,
          };
        }),
      ),
    ),
  });
  const documentSource = yield* Effect.serviceOption(DocumentPublication.LibraryDocumentSource);
  if (Option.isSome(documentSource)) {
    const documents = yield* DocumentPublication.makeDocumentPublication({
      environmentId,
      publisher,
      workspaces,
      source: documentSource.value,
    });
    yield* ServerActivation.forkParked(documents.run);
  }
  yield* ServerActivation.forkParked(copyHealth.run);
  return LibraryReplication.of({ drain, flush, status, reportCopyHealth: copyHealth.report });
});
export const layer = Layer.effect(LibraryReplication, make);
