import { ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryHistoryDelta,
  LIBRARY_HISTORY_DELTAS_FEATURE,
  LibraryThreadArchive,
  LibraryWorkingCopy,
  type LibraryInfo,
  type LibraryIngestHistoryRequest,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeBuffer from "node:buffer";
import * as NodeZlib from "node:zlib";
import * as NodeUtil from "node:util";
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
import { createHistoryDelta } from "./LibraryHistoryDelta.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import * as Workspace from "./LibraryWorkspace.ts";
import { isWithheldError } from "../deleted-history/deletedHistory.ts";

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
    readonly status: Effect.Effect<ReplicationStatus, LibraryError>;
    /** Lists only those of these conversations that are bound or saved, or all without a list. */
    readonly statusFor: (
      threadIds: ReadonlyArray<ThreadId> | undefined,
    ) => Effect.Effect<ReplicationStatus, LibraryError>;
  }
>()("t3/fork/project-library/LibraryReplication") {}
type ReplicationStatus = {
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
};

const archiveJson = Schema.toCodecJson(LibraryThreadArchive);
const wireCodec = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Struct({
      thread: LibraryThreadArchive,
      delta: Schema.optionalKey(LibraryHistoryDelta),
    }),
  ),
);
const encodeWire = Schema.encodeEffect(wireCodec);
const decodeWire = Schema.decodeEffect(wireCodec);
const compress = NodeUtil.promisify(NodeZlib.gzip);
const decompress = NodeUtil.promisify(NodeZlib.gunzip);
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
// Folders that save their conversations are checked again this often, so a newly registered one's
// existing conversations join the backfill.
const FOLDER_RECHECK_MS = 10 * 60 * 1000;

type TurnItem = LibraryThreadArchive["projection"]["turnItems"][number];
// Covers every place libraryAttachments reads, and keeps each collection's length so a delta's
// prefixes still line up.
const withoutAttachments = (
  thread: LibraryThreadArchive,
  ids: ReadonlySet<string>,
): LibraryThreadArchive => {
  const keep = <A extends { readonly id: string }>(attachments: ReadonlyArray<A>) =>
    attachments.filter((attachment) => !ids.has(attachment.id));
  const item = (turnItem: TurnItem): TurnItem =>
    (turnItem.type === "user_message" || turnItem.type === "assistant_message") &&
    turnItem.attachments !== undefined
      ? { ...turnItem, attachments: keep(turnItem.attachments) }
      : turnItem;
  return {
    ...thread,
    projection: {
      ...thread.projection,
      messages: thread.projection.messages.map((message) => ({
        ...message,
        attachments: keep(message.attachments),
      })),
      turnItems: thread.projection.turnItems.map(item),
      visibleTurnItems: thread.projection.visibleTurnItems.map((row) => ({
        ...row,
        item: item(row.item),
      })),
    },
  };
};

const disabledStatus = Effect.succeed<ReplicationStatus>({
  enabled: false,
  journalId: null,
  acknowledgedSequence: 0,
  pendingEntries: 0,
  pendingBytes: 0,
  maxPendingBytes: 0,
  lastFailure: null,
  threads: [],
});

const make = Effect.gen(function* () {
  const publisher = yield* Publisher.LibraryPublisher;
  if (!publisher.enabled)
    return LibraryReplication.of({
      drain: Effect.void,
      flush: Effect.void,
      reportCopyHealth: Effect.void,
      status: disabledStatus,
      statusFor: Effect.fn("LibraryReplication.statusFor")(() => disabledStatus),
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
  // Deleted conversations whose history the source refused: the Library already holds the
  // deletion, or the history was purged. Nothing more is sent for them while this service runs;
  // a restart refuses each one once more.
  const withheld = new Set<ThreadId>();
  // Saved conversations whose snapshot failed. Unlike a bound one, a failure here never holds back
  // the journal; the conversation is tried again at its next milestone or restart.
  const skipped = new Set<ThreadId>();
  let folders: Effect.Success<Workspace.LibraryWorkspace["Service"]["historyFolders"]> = [];
  let foldersCheckedAt: number | undefined;
  // Conversations seen at a milestone whose project saves nothing, until the folders change.
  const outside = new Set<ThreadId>();
  // Conversations from before saving began trickle in one at a time while nothing else waits to
  // upload, spaced by their size like any snapshot.
  let backfillAfter = 0;
  let reconciled = false;
  let prunedBaselines = false;
  let supportsDeltas = false;
  const readState = sql<{
    readonly journal_id: string;
    readonly environment_id: string;
    readonly authority_id: string;
    readonly authority_epoch: number;
    readonly scan_sequence: number;
    readonly acknowledged_sequence: number;
  }>`SELECT journal_id,environment_id,authority_id,authority_epoch,scan_sequence,acknowledged_sequence FROM fork_library_source_state WHERE key='host'`;
  const state = mapIo(
    Effect.gen(function* () {
      const current = (yield* readState)[0];
      if (current === undefined) return yield* new LibraryError({ reason: "blocked" });
      return current;
    }),
  );
  const ensureAuthority = (authority: LibraryInfo) => {
    const check = (current: Effect.Success<typeof state>) =>
      current.environment_id !== environmentId ||
      current.authority_id !== authority.authorityId ||
      current.authority_epoch !== authority.authorityEpoch
        ? Effect.fail(new LibraryError({ reason: "blocked" }))
        : Effect.void;
    return mapIo(
      Effect.gen(function* () {
        supportsDeltas = authority.features?.includes(LIBRARY_HISTORY_DELTAS_FEATURE) ?? false;
        // Every pass checks the authority but only the first ever writes this row, so the write
        // transaction opens only while it is missing.
        const existing = (yield* readState)[0];
        if (existing !== undefined) return yield* check(existing);
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const current = (yield* readState)[0];
            if (current !== undefined) return yield* check(current);
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
        );
      }),
    );
  };
  // Only capture writes the outbox and these rows, always under the drain lock, so the caller
  // passes the queued sequence and outbox size it read once for the whole pass.
  const queueThread = Effect.fnUntraced(function* (
    threadId: ThreadId,
    queuedSequence: number | undefined,
    pendingBytes: number,
  ) {
    // The reader takes the snapshot in one read transaction, so no write waits while a long
    // history is read; anything committed after it is a later event the next scan finds. The
    // reader is one shared connection, so other reads, Vault checks among them, still wait.
    const snapshot = yield* source.snapshotThread({ threadId }).pipe(
      NodeSqliteClient.readOnly,
      Effect.catchIf(isWithheldError, () => Effect.succeed(null)),
    );
    if (snapshot === null) {
      withheld.add(threadId);
      oversized.delete(threadId);
      spacedUntil.delete(threadId);
      return { result: "withheld" as const, bytes: 0 };
    }
    if (queuedSequence !== undefined && queuedSequence >= snapshot.summary.sequence) {
      oversized.delete(threadId);
      return { result: "current" as const, bytes: 0 };
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
    if (payload === null || pendingBytes + bytes > maxPendingBytes) {
      oversized.set(threadId, bytes);
      return { result: "waiting" as const, bytes: 0 };
    }
    let wire: string | null = null;
    if (supportsDeltas) {
      const baseline = (yield* sql<{
        bytes: Uint8Array;
      }>`SELECT bytes FROM fork_library_source_baselines WHERE thread_id=${threadId}`.pipe(
        NodeSqliteClient.readOnly,
      ))[0];
      if (baseline !== undefined) {
        const previous = yield* Effect.tryPromise(() => decompress(baseline.bytes)).pipe(
          Effect.flatMap((bytes) => decodeArchive(bytes.toString("utf8"))),
          Effect.orElseSucceed(() => null),
        );
        if (
          previous !== null &&
          previous.summary.id === snapshot.summary.id &&
          previous.summary.sequence < snapshot.summary.sequence
        )
          wire = yield* encodeWire(createHistoryDelta(previous, snapshot));
      }
    }
    let wireBytes = 0;
    if (wire !== null) {
      wireBytes = NodeBuffer.Buffer.byteLength(wire);
      if (wireBytes >= bytes || pendingBytes + bytes + wireBytes > maxPendingBytes) {
        wire = null;
        wireBytes = 0;
      }
    }
    oversized.delete(threadId);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT INTO fork_library_source_outbox (thread_id,source_sequence,payload_json,wire_json) VALUES (${threadId},${snapshot.summary.sequence},${payload},${wire})`;
        yield* sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence) VALUES (${threadId},${snapshot.summary.sequence}) ON CONFLICT(thread_id) DO UPDATE SET queued_sequence=excluded.queued_sequence`;
      }),
    );
    return { result: "queued" as const, bytes: bytes + wireBytes };
  });
  // A conversation is saved once it has a message: the Library's New conversation flow binds it
  // before then, and a binding replaces what a saved record would upload. Subagent conversations
  // stay on this computer; their parent's history carries the work.
  const withMessages = sql.literal(
    "EXISTS (SELECT 1 FROM orchestration_v2_projection_messages m WHERE m.thread_id=t.thread_id)",
  );
  const topLevel = sql.literal(
    "json_extract(t.payload_json, '$.lineage.relationshipToParent') IS NOT 'subagent'",
  );
  // Finds conversations in folders that save without a binding: all of them when the folders are
  // checked, and otherwise only unknown ones that just reached a milestone.
  const saveFolderHistory = Effect.fn("LibraryReplication.saveFolderHistory")(function* (
    active: ReadonlySet<ThreadId>,
  ) {
    if (Option.isNone(workspace)) return false;
    const now = yield* Clock.currentTimeMillis;
    let saved = false;
    if (foldersCheckedAt === undefined || now - foldersCheckedAt >= FOLDER_RECHECK_MS) {
      foldersCheckedAt = now;
      folders = yield* workspace.value.historyFolders;
      outside.clear();
      for (const { resolved, project } of folders) {
        // Newest first, so the backfill reaches recent work before old work.
        const rows = yield* sql<{ thread_id: string }>`
          SELECT thread_id FROM orchestration_v2_projection_threads t
          WHERE project_id=${resolved.localProjectId} AND deleted_at IS NULL AND ${topLevel}
            AND ${withMessages}
          ORDER BY updated_at DESC`;
        if (rows.length === 0) continue;
        yield* workspaces.saveHistory({
          project,
          threads: rows.map((row) => ({
            threadId: ThreadId.make(row.thread_id),
            localProjectId: resolved.localProjectId,
            binding: resolved.binding,
            backfill: true,
          })),
        });
        saved = true;
      }
    }
    const unknown = [...active].filter((threadId) => !outside.has(threadId));
    if (unknown.length === 0 || folders.length === 0) return saved;
    const rows = yield* sql<{
      thread_id: string;
      project_id: string;
      top: number;
      messages: number;
    }>`
      SELECT thread_id, project_id, ${topLevel} AS top, ${withMessages} AS messages
      FROM orchestration_v2_projection_threads t
      WHERE thread_id IN ${sql.in(unknown)} AND deleted_at IS NULL`;
    for (const row of rows) {
      const folder = folders.find(({ resolved }) => resolved.localProjectId === row.project_id);
      if (folder === undefined || row.top === 0) outside.add(ThreadId.make(row.thread_id));
      else if (row.messages === 1) {
        yield* workspaces.saveHistory({
          project: folder.project,
          threads: [
            {
              threadId: ThreadId.make(row.thread_id),
              localProjectId: folder.resolved.localProjectId,
              binding: folder.resolved.binding,
            },
          ],
        });
        saved = true;
      }
    }
    return saved;
  });
  const queueSaved = (threadId: ThreadId, queuedSequence: number | undefined, bytes: number) =>
    queueThread(threadId, queuedSequence, bytes).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("A saved conversation could not be snapshotted for the Library", {
          threadId,
          cause,
        }).pipe(
          Effect.andThen(Effect.sync(() => skipped.add(threadId))),
          Effect.as({ result: "skipped" as const, bytes: 0 }),
        ),
      ),
    );
  // The pass's own statements trace under the drain's span. Work repeated for every thread runs
  // with tracing off below: fnUntraced drops only its own span, not the statements inside. A
  // flush passes the threads it has already snapshotted.
  const capture = Effect.fnUntraced(function* (flushed: Set<ThreadId> | undefined) {
    const current = yield* state;
    const events = yield* sql<{ sequence: number; stream_id: string; milestone: number }>`
      SELECT sequence,stream_id,CASE WHEN ${milestone} THEN 1 ELSE 0 END AS milestone
      FROM orchestration_events
      WHERE application_event_version=2 AND aggregate_kind='thread' AND sequence>${current.scan_sequence}
      ORDER BY sequence LIMIT ${EVENT_SCAN_LIMIT}`;
    const bindings = yield* workspaces.bindings;
    let saved = yield* workspaces.savedThreads;
    const known = new Set([...bindings, ...saved].map((entry) => entry.threadId));
    const active = new Set(
      events
        .filter((event) => event.milestone === 1)
        .map((event) => ThreadId.make(event.stream_id))
        .filter((threadId) => !known.has(threadId)),
    );
    // Finding them must never hold back the history of conversations already saved.
    if (
      yield* saveFolderHistory(active).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Library folders could not be checked for conversations to save", {
            cause,
          }).pipe(Effect.as(false)),
        ),
      )
    )
      saved = yield* workspaces.savedThreads;
    const savedIds = new Set(saved.map((entry) => entry.threadId));
    const bound = new Set([...bindings.map((entry) => entry.threadId), ...savedIds]);
    const queued = new Map(
      (yield* sql<{
        thread_id: string;
        queued_sequence: number;
      }>`SELECT thread_id,queued_sequence FROM fork_library_source_threads`).map((entry) => [
        entry.thread_id,
        entry.queued_sequence,
      ]),
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
        queued.set(entry.threadId, imported.sequence);
      } else if (!withheld.has(entry.threadId)) deferred.add(entry.threadId);
    }
    for (const entry of saved)
      if (
        entry.backfill !== true &&
        !queued.has(entry.threadId) &&
        !withheld.has(entry.threadId) &&
        !skipped.has(entry.threadId)
      )
        deferred.add(entry.threadId);
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
    const dirty = new Map<ThreadId, number>();
    for (const event of events) {
      const threadId = ThreadId.make(event.stream_id);
      if (event.milestone === 1 && bound.has(threadId)) dirty.set(threadId, event.sequence);
    }
    for (const [threadId, sequence] of dirty) {
      skipped.delete(threadId);
      if ((queued.get(threadId) ?? -1) < sequence) deferred.add(threadId);
    }
    const last = events.at(-1);
    if (last !== undefined)
      yield* sql`UPDATE fork_library_source_state SET scan_sequence=${last.sequence} WHERE key='host'`;
    const now = yield* Clock.currentTimeMillis;
    let added = false;
    let snapshotsQueued = 0;
    const backlog =
      flushed === undefined && now >= backfillAfter
        ? saved.filter(
            (entry) =>
              entry.backfill === true &&
              !queued.has(entry.threadId) &&
              !withheld.has(entry.threadId) &&
              !skipped.has(entry.threadId),
          )
        : [];
    if (deferred.size > 0 || backlog.length > 0) {
      // octet_length reads each payload's size from its record header, not its pages.
      const outbox = yield* sql<{
        thread_id: string;
        bytes: number;
      }>`SELECT thread_id,octet_length(payload_json)+COALESCE(octet_length(wire_json),0) AS bytes FROM fork_library_source_outbox`;
      // The Library accepts a journal only in order, so a queued snapshot is never replaced.
      // Later milestones wait for its acknowledgement and then share one fresh snapshot.
      const outstanding = new Set(outbox.map((row) => row.thread_id));
      let pendingBytes = outbox.reduce((total, row) => total + row.bytes, 0);
      for (const threadId of deferred) {
        if (!bound.has(threadId) || withheld.has(threadId) || skipped.has(threadId)) {
          deferred.delete(threadId);
          oversized.delete(threadId);
          spacedUntil.delete(threadId);
          continue;
        }
        if (flushed?.has(threadId)) continue;
        const waiting = oversized.get(threadId);
        const spaced = (spacedUntil.get(threadId) ?? 0) > now;
        if (waiting !== undefined && waiting > maxPendingBytes - pendingBytes) {
          // Only acknowledgements free room, so a snapshot that fits an empty outbox waits for
          // them rather than being taken again every pass. One larger than the whole outbox can
          // fit only if its history shrank, which a new snapshot after its spacing finds out.
          if (waiting <= maxPendingBytes || spaced) continue;
        } else if (waiting === undefined && spaced && flushed === undefined) continue;
        if (outstanding.has(threadId)) continue;
        // A snapshot that does not fit stays deferred without holding back smaller ones. Any
        // other failure of a bound conversation ends this pass and keeps it deferred. A backlog
        // can defer hundreds of conversations, so their snapshots run with tracing off.
        const queuedThread = yield* (savedIds.has(threadId) ? queueSaved : queueThread)(
          threadId,
          queued.get(threadId),
          pendingBytes,
        ).pipe(Effect.withTracerEnabled(false));
        if (queuedThread.result === "waiting") continue;
        deferred.delete(threadId);
        flushed?.add(threadId);
        if (queuedThread.result === "queued") {
          added = true;
          snapshotsQueued += 1;
          pendingBytes += queuedThread.bytes;
        }
      }
      const next = backlog.find((entry) => !deferred.has(entry.threadId));
      if (next !== undefined && !added && outstanding.size === 0) {
        const backfilled = yield* queueSaved(next.threadId, undefined, pendingBytes).pipe(
          Effect.withTracerEnabled(false),
        );
        if (backfilled.result === "waiting") deferred.add(next.threadId);
        if (backfilled.result === "queued") {
          added = true;
          snapshotsQueued += 1;
          backfillAfter =
            now + Math.floor(backfilled.bytes / SNAPSHOT_SPACING_BYTES_PER_SECOND) * 1000;
        }
      }
    }
    const waiting = [...deferred].filter((threadId) => oversized.has(threadId)).length;
    yield* Effect.annotateCurrentSpan({
      "library.deferred": deferred.size,
      "library.queued": snapshotsQueued,
      "library.waiting": waiting,
    });
    return { queued: added, waiting: waiting > 0, bound };
  }, mapIo);
  const publish = mapIo(
    Effect.gen(function* () {
      const current = yield* state;
      // octet_length reads sizes from record headers, so only the payloads this batch sends are
      // read, and the rest of a large backlog is not loaded again on every pass.
      const rows = yield* sql<{
        sequence: number;
        thread_id: string;
        source_sequence: number;
        payload_bytes: number;
        wire_bytes: number | null;
      }>`SELECT sequence,thread_id,source_sequence,octet_length(payload_json) AS payload_bytes,octet_length(wire_json) AS wire_bytes FROM fork_library_source_outbox WHERE sequence>${current.acknowledged_sequence} ORDER BY sequence LIMIT ${PUBLISH_BATCH_LIMIT}`;
      // A previous attempt may already be committed. Preserve its exact fingerprint even if
      // the Library is temporarily downgraded; an older reader would treat tails as full history.
      if (!supportsDeltas && rows.some((row) => row.wire_bytes !== null))
        return yield* new LibraryError({ reason: "publisher-unavailable" });
      const batch: (typeof rows)[number][] = [];
      let bytes = 0;
      for (const row of rows) {
        const size = row.wire_bytes ?? row.payload_bytes;
        if (batch.length > 0 && bytes + size > PUBLISH_BATCH_BYTES) break;
        batch.push(row);
        bytes += size;
      }
      if (batch.length === 0) return false;
      const through = batch.at(-1)!.sequence;
      // The drain lock keeps these rows unchanged, and the reader sees every committed one.
      const payloads = yield* sql<{
        payload_json: string;
        wire_json: string | null;
      }>`SELECT payload_json,wire_json FROM fork_library_source_outbox WHERE sequence>${current.acknowledged_sequence} AND sequence<=${through} ORDER BY sequence`.pipe(
        NodeSqliteClient.readOnly,
      );
      if (payloads.length !== batch.length) return yield* new LibraryError({ reason: "io" });
      const fullEntries = yield* Effect.forEach(batch, (row, index) =>
        decodeArchive(payloads[index]!.payload_json).pipe(
          Effect.map((thread) => ({ sequence: row.sequence, thread })),
        ),
      );
      const entries = yield* Effect.forEach(batch, (row, index) => {
        const wire = payloads[index]!.wire_json;
        return wire === null
          ? Effect.succeed(fullEntries[index]!)
          : decodeWire(wire).pipe(Effect.map((sent) => ({ sequence: row.sequence, ...sent })));
      });
      const copies = new Set<string>();
      for (const [index, entry] of fullEntries.entries()) {
        const copyId = entry.thread.summary.workingCopyId;
        if (copyId !== null && !copies.has(copyId)) {
          yield* registerChangedCopy(current, yield* workspaces.get(copyId));
          copies.add(copyId);
        }
        // History is acknowledged only after every referenced attachment has verified storage.
        // The same attachments are gone on every retry, so a resent batch keeps its fingerprint.
        const gone = yield* publisher.publishAttachments(entry.thread);
        if (gone.size > 0) {
          const sent = entries[index]!;
          entries[index] = { ...sent, thread: withoutAttachments(sent.thread, gone) };
        }
      }
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
      // A baseline only lets the next snapshot go up as a delta. The Library already holds a
      // deleted conversation's last history, so it keeps none; a later snapshot goes up whole.
      const baselines = yield* Effect.forEach(payloads, (row, index) =>
        fullEntries[index]!.thread.summary.deleted === true
          ? Effect.succeed(null)
          : Effect.tryPromise(() => compress(row.payload_json)),
      );
      // A cursor beyond this batch does not prove any later local entry was uploaded.
      yield* sql.withTransaction(
        Effect.gen(function* () {
          for (const [index, row] of batch.entries()) {
            yield* sql`UPDATE fork_library_source_threads SET acknowledged_sequence=MAX(acknowledged_sequence,${row.source_sequence}) WHERE thread_id=${row.thread_id}`;
            const baseline = baselines[index];
            if (baseline === null || baseline === undefined)
              yield* sql`DELETE FROM fork_library_source_baselines WHERE thread_id=${row.thread_id}`;
            else
              yield* sql`INSERT INTO fork_library_source_baselines(thread_id,bytes) VALUES (${row.thread_id},${new Uint8Array(baseline)}) ON CONFLICT(thread_id) DO UPDATE SET bytes=excluded.bytes`;
          }
          yield* sql`UPDATE fork_library_source_state SET acknowledged_sequence=${through} WHERE key='host'`;
          yield* sql`DELETE FROM fork_library_source_outbox WHERE sequence<=${through}`;
        }),
      );
      return true;
    }),
  );
  // Baselines can hold tens of megabytes each. An unbound conversation sends no more snapshots,
  // and a deleted one whose final history the Library holds has nothing left to send as a delta.
  const pruneBaselines = Effect.fn("LibraryReplication.pruneBaselines")(function* (
    bound: ReadonlySet<ThreadId>,
    includeDeleted: boolean,
  ) {
    const stale = new Set(
      (yield* sql<{ thread_id: string }>`SELECT thread_id FROM fork_library_source_baselines`)
        .map((row) => row.thread_id)
        .filter((threadId) => !bound.has(ThreadId.make(threadId))),
    );
    if (includeDeleted)
      for (const row of yield* sql<{ thread_id: string }>`
        SELECT b.thread_id FROM fork_library_source_baselines b
        JOIN fork_library_source_threads t ON t.thread_id=b.thread_id
        JOIN orchestration_v2_projection_threads p ON p.thread_id=b.thread_id
        WHERE p.deleted_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM fork_library_source_outbox o WHERE o.thread_id=b.thread_id)
          AND NOT EXISTS (
            SELECT 1 FROM orchestration_events
            WHERE application_event_version=2 AND aggregate_kind='thread' AND stream_id=b.thread_id
              AND sequence>t.acknowledged_sequence AND NOT (${navigation}))`)
        stale.add(row.thread_id);
    yield* Effect.annotateCurrentSpan({ "library.baselines_removed": stale.size });
    // One statement per row keeps each overflow-chain release a short write.
    yield* Effect.forEach(
      stale,
      (threadId) => sql`DELETE FROM fork_library_source_baselines WHERE thread_id=${threadId}`,
      { discard: true },
    ).pipe(Effect.withTracerEnabled(false));
  }, mapIo);
  // Registering a copy also triggers a document report of its repositories, so it is sent again
  // only once the copy or the authority holding it changed.
  const publishedCopies = new Map<string, string>();
  const registerChangedCopy = Effect.fnUntraced(function* (
    current: {
      readonly journal_id: string;
      readonly authority_id: string;
      readonly authority_epoch: number;
    },
    receipt: WorkspaceStore.WorkspaceReceipt,
  ) {
    const copy = WorkspaceStore.placedCopy(receipt.copy, receipt.project);
    const fingerprint = Hex.encode(
      yield* crypto.digest("SHA-256", new TextEncoder().encode(yield* encodeCopy(copy))),
    );
    const requestId = `${current.journal_id}:copy:${fingerprint}`;
    const published = `${current.authority_id}:${current.authority_epoch}:${requestId}`;
    if (publishedCopies.get(copy.id) === published) return;
    yield* publisher.registerCopy({
      requestId,
      authorityId: current.authority_id,
      authorityEpoch: current.authority_epoch,
      copy,
    });
    publishedCopies.set(copy.id, published);
  });
  const publishCopyChanges = Effect.fn("LibraryReplication.publishCopyChanges")(function* () {
    if (Option.isNone(workspace)) return;
    const current = yield* state;
    for (const receipt of yield* workspaces.receipts) {
      const { copy } = receipt;
      if (
        copy.environmentId !== environmentId ||
        copy.state === "preparing" ||
        copy.state === "failed"
      )
        continue;
      yield* registerChangedCopy(current, receipt).pipe(
        // The Library cannot record a copy of a project it no longer has. Skipping it keeps one
        // such copy from failing every later copy and the cleanup that follows.
        Effect.catchIf(
          (error) => isLibraryError(error) && error.reason === "not-found",
          () =>
            Effect.logDebug("The Library no longer has this copy's project.", {
              copyId: copy.id,
            }),
        ),
      );
    }
  }, mapIo);

  // Status checks every bound conversation, so its reads run with tracing off; fnUntraced alone
  // would still trace each statement.
  const threadStatus = Effect.fnUntraced(
    function* (threadId: ThreadId) {
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
          !withheld.has(threadId) &&
          (row === undefined ||
            pending > 0 ||
            latest > row.acknowledged_sequence ||
            deferred.has(threadId)),
      };
    },
    mapIo,
    Effect.withTracerEnabled(false),
  );
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
    // The first pass also clears baselines left from before this process, even while the
    // Library is out of reach.
    if (!prunedBaselines) {
      yield* pruneBaselines(captured.bound, true);
      prunedBaselines = true;
    }
    // Keep capturing committed milestones during an outage once this journal is established.
    if (initialized) yield* ensureAuthority(yield* publisher.info);
    // Copies go first, so a large history backlog never delays a new copy reaching the Library.
    yield* publishCopyChanges();
    const published = yield* publish;
    if (published) yield* pruneBaselines(captured.bound, false);
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
    .pipe(
      Effect.tapError((error) => Ref.set(failure, error.reason)),
      Effect.withSpan("LibraryReplication.flush"),
    );
  // Without a filter, every bound or saved conversation is checked; a client showing one
  // conversation asks for it alone.
  const statusOf = (threadIds: ReadonlyArray<ThreadId> | undefined) =>
    mapIo(
      Effect.gen(function* () {
        const current = (yield* readState)[0];
        const outbox = (yield* sql<{
          count: number;
          bytes: number;
        }>`SELECT COUNT(*) AS count,COALESCE(SUM(octet_length(payload_json)),0) AS bytes FROM fork_library_source_outbox`)[0];
        const count = outbox?.count ?? 0;
        const requested = threadIds === undefined ? undefined : new Set(threadIds);
        const history = [
          ...new Set(
            [...(yield* workspaces.bindings), ...(yield* workspaces.savedThreads)].map(
              (entry) => entry.threadId,
            ),
          ),
        ].filter((threadId) => requested === undefined || requested.has(threadId));
        const threads = yield* Effect.forEach(history, threadStatus);
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
  // A stuck journal fails the same way every five seconds, so only a new failure is logged.
  let loggedFailure: string | null = null;
  yield* ServerActivation.forkParked(
    drain.pipe(
      // Each pass is its own trace; the parked fiber has no parent span to group its statements.
      Effect.withSpan("LibraryReplication.drain", { root: true }),
      Effect.matchEffect({
        onFailure: (error) => {
          const key = `${error.reason}:${error.detail ?? ""}`;
          if (key === loggedFailure) return Effect.void;
          loggedFailure = key;
          return Effect.logWarning("Library history replication failed", {
            reason: error.reason,
            detail: error.detail,
            cause: error.cause,
          });
        },
        onSuccess: () =>
          Effect.sync(() => {
            loggedFailure = null;
          }),
      }),
      Effect.repeat(Schedule.spaced("5 seconds")),
    ),
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
  return LibraryReplication.of({
    drain,
    flush,
    status: statusOf(undefined),
    statusFor: statusOf,
    reportCopyHealth: copyHealth.report,
  });
});
export const layer = Layer.effect(LibraryReplication, make);
