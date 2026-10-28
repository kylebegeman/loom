import type { LibraryThreadIndex } from "@t3tools/contracts/fork";
import * as NodeZlib from "node:zlib";
import * as NodeUtil from "node:util";
import * as Crypto from "effect/Crypto";
import * as Hex from "effect/encoding/Hex";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { isSqlError } from "effect/sql/SqlError";
import * as SqlClient from "effect/sql/SqlClient";
import type { Fragment } from "effect/sql/Statement";

export class LibraryStoreError extends Schema.TaggedError<LibraryStoreError>()(
  "LibraryStoreError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Loom Library could not read or save its durable records.";
  }
}

/** Which saved conversations a page leaves out. Catalog reads keep them all. */
export interface ConversationFilter {
  readonly omitDeleted: boolean;
  readonly onlyDeleted?: boolean;
  readonly omitArchivedProjects: boolean;
}
const EVERY_CONVERSATION: ConversationFilter = { omitDeleted: false, omitArchivedProjects: false };

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    readonly transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | LibraryStoreError, R>;
    readonly computers: Effect.Effect<readonly string[], LibraryStoreError>;
    readonly putComputer: (
      environmentId: string,
      payload: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly authority: Effect.Effect<string | null, LibraryStoreError>;
    readonly putAuthority: (payload: string) => Effect.Effect<void, LibraryStoreError>;
    readonly projectRevision: (
      id: string,
      revision: number,
    ) => Effect.Effect<string | null, LibraryStoreError>;
    readonly project: (id: string) => Effect.Effect<string | null, LibraryStoreError>;
    readonly projects: (
      includeArchived: boolean,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly putProject: (input: {
      id: string;
      revision: number;
      archived: boolean;
      payload: string;
      createdAt: string;
      updatedAt: string;
    }) => Effect.Effect<void, LibraryStoreError>;
    readonly copy: (id: string) => Effect.Effect<string | null, LibraryStoreError>;
    readonly copies: (projectId?: string) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly putCopy: (input: {
      id: string;
      projectId: string;
      environmentId: string;
      rootPath: string;
      state: string;
      payload: string;
      updatedAt: string;
    }) => Effect.Effect<void, LibraryStoreError>;
    readonly historyWindow: (
      id: string,
      offset: number,
      limit: number,
    ) => Effect.Effect<
      { payload: string; totalItems: number; itemCount?: number } | null,
      LibraryStoreError
    >;
    readonly history: (id: string) => Effect.Effect<string | null, LibraryStoreError>;
    readonly thread: (
      environmentId: string,
      threadId: string,
    ) => Effect.Effect<string | null, LibraryStoreError>;
    readonly threads: (
      projectId: string,
      limit: number,
      offset: number,
      filter?: ConversationFilter,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly threadSummary: (
      environmentId: string,
      threadId: string,
    ) => Effect.Effect<string | null, LibraryStoreError>;
    readonly projectActivity: (
      omitArchivedProjects: boolean,
    ) => Effect.Effect<NonNullable<LibraryThreadIndex["projectActivity"]>, LibraryStoreError>;
    readonly threadIndex: (
      limit: number,
      offset: number,
      filter?: ConversationFilter,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly putThread: (input: {
      id: string;
      environmentId: string;
      threadId: string;
      projectId: string;
      workingCopyId: string | null;
      sourceSequence: number;
      summary: string;
      payload: string;
      updatedAt: string;
    }) => Effect.Effect<void, LibraryStoreError>;
    readonly cursor: (
      environmentId: string,
      journalId: string,
    ) => Effect.Effect<number, LibraryStoreError>;
    readonly putCursor: (
      environmentId: string,
      journalId: string,
      sequence: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly ingestedDigest: (
      environmentId: string,
      journalId: string,
      sequence: number,
    ) => Effect.Effect<string | null, LibraryStoreError>;
    readonly putIngestedDigest: (
      environmentId: string,
      journalId: string,
      sequence: number,
      digest: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Versions record a digest. Ones saved by earlier releases still return their archive. */
    readonly threadVersion: (
      id: string,
      sourceSequence: number,
    ) => Effect.Effect<
      { readonly digest: string } | { readonly payload: string } | null,
      LibraryStoreError
    >;
    readonly putThreadVersion: (
      id: string,
      sourceSequence: number,
      digest: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Replaces an earlier release's retained version archive with its digest and frees the archive. */
    readonly compactThreadVersion: (
      id: string,
      sourceSequence: number,
      digest: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly eraseThread: (id: string) => Effect.Effect<void, LibraryStoreError>;
    readonly importProof: (requestId: string) => Effect.Effect<string | null, LibraryStoreError>;
    readonly putImportProof: (
      requestId: string,
      payload: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly receipt: (
      requestId: string,
    ) => Effect.Effect<
      { operation: string; fingerprint: string; result_json: string } | null,
      LibraryStoreError
    >;
    readonly putReceipt: (
      requestId: string,
      operation: string,
      fingerprint: string,
      result: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Deletes the receipts whose request id starts with `prefix`. */
    readonly deleteReceipts: (prefix: string) => Effect.Effect<void, LibraryStoreError>;
    readonly appendEvent: (
      aggregateId: string,
      eventType: string,
      payload: string,
      createdAt: string,
    ) => Effect.Effect<void, LibraryStoreError>;
  }
>()("t3/fork/project-library/LibraryStore") {}

const compress = NodeUtil.promisify(NodeZlib.gzip);
const decompress = NodeUtil.promisify(NodeZlib.gunzip);
const BLOB_PREFIX = "loom:gzip:";
type PackedRow = { readonly payload_json: string; readonly bytes: Uint8Array | null };
const VERSION_DIGEST_PREFIX = "loom:sha256:";
const HISTORY_PAGE_BYTES = 2 * 1024 * 1024;
// Three bindings per row keep each insert below SQLite's conservative 999-variable limit.
const HISTORY_INSERT_BATCH_ROWS = 256;
const ArchiveJson = Schema.fromJsonString(
  Schema.Struct({
    summary: Schema.Unknown,
    context: Schema.optional(Schema.Unknown),
    projection: Schema.Record(Schema.String, Schema.Unknown),
  }),
);
const decodeArchiveJson = Schema.decodeEffect(ArchiveJson);
const unknownJson = Schema.fromJsonString(Schema.Unknown);
const encodeJson = Schema.encodeEffect(unknownJson);
const decodeJson = Schema.decodeEffect(unknownJson);
function shortenDisplayText(value: unknown): unknown {
  if (typeof value === "string" && value.length > 8192)
    return (
      value.slice(0, 8192) +
      "\n[Long content shortened for browsing. Full content remains in saved history.]"
    );
  if (Array.isArray(value)) return value.map(shortenDisplayText);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, shortenDisplayText(entry)]),
    );
  return value;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const hash = (payload: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(payload)).pipe(Effect.map(Hex.encode));
  const run = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((cause) => new LibraryStoreError({ operation, cause })));
  const first = <T>(rows: readonly T[]) => rows[0] ?? null;
  const payloads = (rows: readonly { payload_json: string }[]) =>
    rows.map((row) => row.payload_json);
  const pack = Effect.fn("LibraryStore.pack")(function* (payload: string) {
    yield* Effect.annotateCurrentSpan({ "library.payloadChars": payload.length });
    const digest = yield* hash(payload);
    const existing =
      yield* sql`SELECT digest FROM fork_library_history_blobs WHERE digest=${digest}`;
    if (existing.length === 0) {
      const bytes = yield* Effect.tryPromise(() => compress(payload));
      yield* sql`INSERT INTO fork_library_history_blobs(digest,bytes) VALUES (${digest},${new Uint8Array(bytes)}) ON CONFLICT(digest) DO NOTHING`;
    }
    return BLOB_PREFIX + digest;
  });
  // Blob content embeds its conversation's Library id, so only that conversation's versions can
  // share an archive with it. Ingested entries no longer reference archives.
  const release = (payload: string, libraryId: string) =>
    payload.startsWith(BLOB_PREFIX)
      ? sql`DELETE FROM fork_library_history_blobs WHERE digest=${payload.slice(BLOB_PREFIX.length)} AND NOT EXISTS (SELECT 1 FROM fork_library_threads WHERE library_id=${libraryId} AND payload_json=${payload}) AND NOT EXISTS (SELECT 1 FROM fork_library_thread_versions WHERE library_id=${libraryId} AND payload_json=${payload}) AND NOT EXISTS (SELECT 1 FROM fork_library_import_proofs WHERE payload_json=${payload})`.pipe(
          Effect.asVoid,
          Effect.withSpan("LibraryStore.release"),
        )
      : Effect.void;
  // Saves free superseded blobs, so a row and its blob are read in one statement. Two reads could
  // straddle a save that commits in between and find the blob already gone.
  const packed = (table: string, where: Fragment) =>
    sql<PackedRow>`SELECT r.payload_json, b.bytes FROM ${sql(table)} r LEFT JOIN fork_library_history_blobs b ON b.digest = substr(r.payload_json, ${BLOB_PREFIX.length + 1}) WHERE ${where}`;
  const outsideArchivedProjects = sql`project_id NOT IN (SELECT id FROM fork_library_projects WHERE archived = 1)`;
  const shownConversations = (filter: ConversationFilter, ...clauses: Fragment[]) =>
    sql.and([
      ...clauses,
      ...(filter.omitDeleted
        ? [sql`COALESCE(json_extract(summary_json, '$.deleted'), 0) = 0`]
        : []),
      ...(filter.onlyDeleted ? [sql`json_extract(summary_json, '$.deleted') = 1`] : []),
      ...(filter.omitArchivedProjects ? [outsideArchivedProjects] : []),
    ]);
  const unpack = Effect.fn("LibraryStore.unpack")(function* (row: PackedRow | null) {
    if (row === null || !row.payload_json.startsWith(BLOB_PREFIX)) return row?.payload_json ?? null;
    const { bytes } = row;
    if (bytes === null)
      return yield* new LibraryStoreError({ operation: "missing-history-blob", cause: null });
    yield* Effect.annotateCurrentSpan({ "library.blobBytes": bytes.byteLength });
    const text = (yield* Effect.tryPromise(() => decompress(bytes))).toString("utf8");
    if ((yield* hash(text)) !== row.payload_json.slice(BLOB_PREFIX.length))
      return yield* new LibraryStoreError({ operation: "corrupt-history-blob", cause: null });
    return text;
  });
  const indexHistory = Effect.fn("LibraryStore.indexHistory")(function* (
    id: string,
    payload: string,
  ) {
    // The full compressed archive is retained. The independent visible index keeps a page
    // read from decoding hundreds of megabytes of unrelated execution history.
    const archive = yield* decodeArchiveJson(payload);
    const visible = archive.projection.visibleTurnItems;
    const field = Array.isArray(visible) && visible.length > 0 ? "visibleTurnItems" : "messages";
    const candidate = archive.projection[field];
    const items: readonly unknown[] = Array.isArray(candidate) ? candidate : [];
    yield* Effect.annotateCurrentSpan({ "library.items": items.length });
    const projection = Object.fromEntries(
      Object.entries(archive.projection).map(([key, value]) => [
        key,
        Array.isArray(value) ? [] : value,
      ]),
    );
    const header = yield* encodeJson({ ...archive, projection });
    yield* sql`INSERT INTO fork_library_history_headers(library_id,payload_json,field,total_items) VALUES (${id},${header},${field},${items.length}) ON CONFLICT(library_id) DO UPDATE SET payload_json=excluded.payload_json,field=excluded.field,total_items=excluded.total_items`;
    yield* sql`DELETE FROM fork_library_history_items WHERE library_id=${id} AND position>=${items.length}`;
    const batch: { library_id: string; position: number; payload_json: string }[] = [];
    let batchBytes = 0;
    for (const [position, item] of items.entries()) {
      const full = yield* encodeJson(item);
      const fullBytes = Buffer.byteLength(full);
      // Large displayed text is shortened only in the browsing index, never in retained history.
      const encoded =
        fullBytes <= HISTORY_PAGE_BYTES ? full : yield* encodeJson(shortenDisplayText(item));
      const encodedBytes = encoded === full ? fullBytes : Buffer.byteLength(encoded);
      if (encodedBytes > HISTORY_PAGE_BYTES)
        return yield* new LibraryStoreError({ operation: "history-item-too-large", cause: null });
      if (
        batch.length > 0 &&
        (batch.length === HISTORY_INSERT_BATCH_ROWS ||
          batchBytes + encodedBytes > HISTORY_PAGE_BYTES)
      ) {
        yield* sql`INSERT INTO fork_library_history_items ${sql.insert(batch)}
          ON CONFLICT(library_id,position) DO UPDATE SET payload_json=excluded.payload_json
          WHERE fork_library_history_items.payload_json IS NOT excluded.payload_json`;
        batch.length = 0;
        batchBytes = 0;
      }
      batch.push({ library_id: id, position, payload_json: encoded });
      batchBytes += encodedBytes;
    }
    if (batch.length > 0)
      yield* sql`INSERT INTO fork_library_history_items ${sql.insert(batch)}
          ON CONFLICT(library_id,position) DO UPDATE SET payload_json=excluded.payload_json
          WHERE fork_library_history_items.payload_json IS NOT excluded.payload_json`;
  });
  // Per-query accessors stay untraced; the Library operation that calls them owns the span.
  return LibraryStore.of({
    transaction: Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>) {
      return yield* sql
        .withTransaction(effect)
        .pipe(
          Effect.catchIf(isSqlError, (cause) =>
            Effect.fail(new LibraryStoreError({ operation: "transaction", cause })),
          ),
        );
    }),
    computers: run(
      "computers",
      sql<{
        payload_json: string;
      }>`SELECT payload_json FROM fork_library_computers ORDER BY environment_id`,
    ).pipe(Effect.map(payloads)),
    putComputer: Effect.fnUntraced(function* (environmentId, payload) {
      return yield* run(
        "computer",
        sql`INSERT INTO fork_library_computers(environment_id,payload_json) VALUES (${environmentId},${payload}) ON CONFLICT(environment_id) DO UPDATE SET payload_json=excluded.payload_json`,
      ).pipe(Effect.asVoid);
    }),
    authority: run(
      "authority",
      sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_library_identity WHERE key = 'authority'`,
    ).pipe(Effect.map((rows) => first(rows)?.value_json ?? null)),
    putAuthority: Effect.fnUntraced(function* (payload) {
      return yield* run(
        "put-authority",
        sql`INSERT INTO fork_library_identity (key, value_json) VALUES ('authority', ${payload})`,
      ).pipe(Effect.asVoid);
    }),
    projectRevision: Effect.fnUntraced(function* (id, revision) {
      return yield* run(
        "project-revision",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_project_revisions WHERE project_id = ${id} AND revision = ${revision}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null));
    }),
    project: Effect.fnUntraced(function* (id) {
      return yield* run(
        "project",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_projects WHERE id = ${id}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null));
    }),
    projects: Effect.fnUntraced(function* (includeArchived) {
      return yield* run(
        "projects",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_projects WHERE (${includeArchived ? 1 : 0} = 1 OR archived = 0) ORDER BY updated_at DESC, id`,
      ).pipe(Effect.map(payloads));
    }),
    putProject: Effect.fnUntraced(function* (input) {
      return yield* run(
        "put-project",
        sql`INSERT INTO fork_library_projects (id, revision, archived, payload_json, created_at, updated_at) VALUES (${input.id}, ${input.revision}, ${input.archived ? 1 : 0}, ${input.payload}, ${input.createdAt}, ${input.updatedAt}) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, archived = excluded.archived, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).pipe(
        Effect.andThen(
          run(
            "put-project-revision",
            sql`INSERT INTO fork_library_project_revisions (project_id, revision, payload_json) VALUES (${input.id}, ${input.revision}, ${input.payload}) ON CONFLICT(project_id, revision) DO NOTHING`,
          ),
        ),
        Effect.asVoid,
      );
    }),
    copy: Effect.fnUntraced(function* (id) {
      return yield* run(
        "copy",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_working_copies WHERE id = ${id}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null));
    }),
    copies: Effect.fnUntraced(function* (projectId) {
      return yield* run(
        "copies",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_working_copies ${projectId ? sql`WHERE project_id = ${projectId}` : sql``} ORDER BY updated_at DESC, id`,
      ).pipe(Effect.map(payloads));
    }),
    putCopy: Effect.fnUntraced(function* (input) {
      return yield* run(
        "put-copy",
        sql`INSERT INTO fork_library_working_copies (id, project_id, environment_id, root_path, state, payload_json, updated_at) VALUES (${input.id}, ${input.projectId}, ${input.environmentId}, ${input.rootPath}, ${input.state}, ${input.payload}, ${input.updatedAt}) ON CONFLICT(id) DO UPDATE SET state = excluded.state, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).pipe(Effect.asVoid);
    }),
    historyWindow: Effect.fnUntraced(function* (id, offset, limit) {
      return yield* run(
        "history-window",
        Effect.gen(function* () {
          const header = (yield* sql<{
            payload_json: string;
            field: string;
            total_items: number;
          }>`SELECT * FROM fork_library_history_headers WHERE library_id=${id}`)[0];
          if (!header) {
            return yield* run(
              "history-window",
              sql<{ payload: string; totalItems: number }>`
      WITH original AS (SELECT payload_json AS archive FROM fork_library_threads WHERE library_id=${id}),
      fields AS (SELECT archive, CASE WHEN json_array_length(archive,'$.projection.visibleTurnItems')>0 THEN 'visibleTurnItems' ELSE 'messages' END AS field FROM original),
      item_count AS (SELECT archive, field, json_array_length(archive,'$.projection.' || field) AS total FROM fields)
      SELECT json_set(archive,
        '$.projection.runs',json('[]'),'$.projection.attempts',json('[]'),'$.projection.nodes',json('[]'),
        '$.projection.subagents',json('[]'),'$.projection.providerSessions',json('[]'),'$.projection.providerThreads',json('[]'),
        '$.projection.providerTurns',json('[]'),'$.projection.runtimeRequests',json('[]'),'$.projection.plans',json('[]'),
        '$.projection.turnItems',json('[]'),'$.projection.checkpointScopes',json('[]'),'$.projection.checkpoints',json('[]'),
        '$.projection.contextHandoffs',json('[]'),'$.projection.contextTransfers',json('[]'),
        '$.projection.visibleTurnItems',CASE WHEN field='visibleTurnItems' THEN json((SELECT json_group_array(json(value)) FROM (SELECT value FROM (SELECT key,value FROM json_each(archive,'$.projection.visibleTurnItems') ORDER BY CAST(key AS INTEGER) DESC LIMIT ${limit} OFFSET ${offset}) ORDER BY CAST(key AS INTEGER)))) ELSE json('[]') END,
        '$.projection.messages',CASE WHEN field='messages' THEN json((SELECT json_group_array(json(value)) FROM (SELECT value FROM (SELECT key,value FROM json_each(archive,'$.projection.messages') ORDER BY CAST(key AS INTEGER) DESC LIMIT ${limit} OFFSET ${offset}) ORDER BY CAST(key AS INTEGER)))) ELSE json('[]') END
      ) AS payload,total AS totalItems FROM item_count
    `,
            ).pipe(Effect.map((rows) => first(rows) ?? null));
          }
          const rows = yield* sql<{ payload_json: string; position: number }>`
        WITH candidates AS (
          SELECT position,payload_json,length(CAST(payload_json AS BLOB)) AS bytes
          FROM fork_library_history_items WHERE library_id=${id} ORDER BY position DESC LIMIT ${limit} OFFSET ${offset}
        ), bounded AS (
          SELECT *,SUM(bytes) OVER (ORDER BY position DESC) AS cumulative,ROW_NUMBER() OVER (ORDER BY position DESC) AS ordinal FROM candidates
        ) SELECT payload_json,position FROM bounded WHERE cumulative<=${HISTORY_PAGE_BYTES} OR ordinal=1 ORDER BY position`;
          const archive = yield* decodeArchiveJson(header.payload_json);
          const items = yield* Effect.forEach(rows, (row) => decodeJson(row.payload_json));
          const projection = { ...archive.projection, [header.field]: items };
          return {
            payload: yield* encodeJson({ ...archive, projection }),
            totalItems: header.total_items,
            itemCount: rows.length,
          };
        }),
      );
    }),
    history: Effect.fnUntraced(function* (id) {
      return yield* run("history", packed("fork_library_threads", sql`r.library_id = ${id}`)).pipe(
        Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)))),
      );
    }),
    thread: Effect.fnUntraced(function* (environmentId, threadId) {
      return yield* run(
        "thread",
        packed(
          "fork_library_threads",
          sql`r.source_environment_id = ${environmentId} AND r.source_thread_id = ${threadId}`,
        ),
      ).pipe(Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)))));
    }),
    threads: Effect.fnUntraced(function* (projectId, limit, offset, filter = EVERY_CONVERSATION) {
      return yield* run(
        "threads",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads WHERE ${shownConversations(filter, sql`project_id = ${projectId}`)} ORDER BY updated_at DESC, source_environment_id, source_thread_id LIMIT ${limit} OFFSET ${offset}`,
      ).pipe(Effect.map(payloads));
    }),
    threadSummary: Effect.fnUntraced(function* (environmentId, threadId) {
      return yield* run(
        "thread-summary",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads WHERE source_environment_id = ${environmentId} AND source_thread_id = ${threadId}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null));
    }),
    projectActivity: Effect.fnUntraced(function* (omitArchivedProjects) {
      return yield* run(
        "project-activity",
        sql<NonNullable<LibraryThreadIndex["projectActivity"]>[number]>`
        SELECT project_id AS "projectId", COUNT(*) AS conversations, MAX(updated_at) AS "latestAt"
        FROM fork_library_threads
        WHERE COALESCE(json_extract(summary_json, '$.deleted'), 0) = 0
          AND COALESCE(json_extract(summary_json, '$.archived'), 0) = 0
          ${omitArchivedProjects ? sql`AND ${outsideArchivedProjects}` : sql``}
        GROUP BY project_id`,
      );
    }),
    threadIndex: Effect.fnUntraced(function* (limit, offset, filter = EVERY_CONVERSATION) {
      return yield* run(
        "thread-index",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads WHERE ${shownConversations(filter)} ORDER BY updated_at DESC, source_environment_id, source_thread_id LIMIT ${limit} OFFSET ${offset}`,
      ).pipe(Effect.map(payloads));
    }),
    putThread: Effect.fnUntraced(function* (input) {
      return yield* run(
        "save-history",
        Effect.gen(function* () {
          const packed = yield* pack(input.payload);
          yield* indexHistory(input.id, input.payload);
          const previous = first(
            yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM fork_library_threads WHERE source_environment_id = ${input.environmentId} AND source_thread_id = ${input.threadId}`,
          )?.payload_json;
          yield* run(
            "put-thread",
            sql`INSERT INTO fork_library_threads (library_id, source_environment_id, source_thread_id, project_id, working_copy_id, source_sequence, summary_json, payload_json, updated_at) VALUES (${input.id}, ${input.environmentId}, ${input.threadId}, ${input.projectId}, ${input.workingCopyId}, ${input.sourceSequence}, ${input.summary}, ${packed}, ${input.updatedAt}) ON CONFLICT(source_environment_id, source_thread_id) DO UPDATE SET working_copy_id = excluded.working_copy_id, source_sequence = excluded.source_sequence, summary_json = excluded.summary_json, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
          );
          if (previous !== undefined && previous !== packed) yield* release(previous, input.id);
        }),
      );
    }),
    cursor: Effect.fnUntraced(function* (environmentId, journalId) {
      return yield* run(
        "cursor",
        sql<{
          last_sequence: number;
        }>`SELECT last_sequence FROM fork_library_host_cursors WHERE environment_id = ${environmentId} AND journal_id = ${journalId}`,
      ).pipe(Effect.map((rows) => first(rows)?.last_sequence ?? 0));
    }),
    putCursor: Effect.fnUntraced(function* (environmentId, journalId, sequence) {
      return yield* run(
        "put-cursor",
        sql`INSERT INTO fork_library_host_cursors (environment_id, journal_id, last_sequence) VALUES (${environmentId}, ${journalId}, ${sequence}) ON CONFLICT(environment_id, journal_id) DO UPDATE SET last_sequence = excluded.last_sequence`,
      ).pipe(Effect.asVoid);
    }),
    ingestedDigest: Effect.fnUntraced(function* (environmentId, journalId, sequence) {
      return yield* run(
        "ingested-digest",
        sql<{
          payload_digest: string;
        }>`SELECT payload_digest FROM fork_library_ingested_entries WHERE environment_id = ${environmentId} AND journal_id = ${journalId} AND sequence = ${sequence}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_digest ?? null));
    }),
    // Replays are checked against the digest alone, so the archive is never kept for them.
    putIngestedDigest: Effect.fnUntraced(function* (environmentId, journalId, sequence, digest) {
      return yield* run(
        "put-ingested-digest",
        sql`INSERT INTO fork_library_ingested_entries (environment_id, journal_id, sequence, payload_digest, payload_json) VALUES (${environmentId}, ${journalId}, ${sequence}, ${digest}, '')`,
      ).pipe(Effect.asVoid);
    }),
    threadVersion: Effect.fnUntraced(function* (id, sourceSequence) {
      return yield* run(
        "thread-version",
        packed(
          "fork_library_thread_versions",
          sql`r.library_id = ${id} AND r.source_sequence = ${sourceSequence}`,
        ),
      ).pipe(
        Effect.flatMap(
          Effect.fnUntraced(function* (rows) {
            const saved = first(rows);
            if (saved === null) return null;
            if (saved.payload_json.startsWith(VERSION_DIGEST_PREFIX))
              return { digest: saved.payload_json.slice(VERSION_DIGEST_PREFIX.length) };
            return { payload: (yield* run("unpack-history", unpack(saved))) ?? saved.payload_json };
          }),
        ),
      );
    }),
    putThreadVersion: Effect.fnUntraced(function* (id, sourceSequence, digest) {
      return yield* run(
        "put-thread-version",
        sql`INSERT INTO fork_library_thread_versions (library_id, source_sequence, payload_json) VALUES (${id}, ${sourceSequence}, ${VERSION_DIGEST_PREFIX + digest})`,
      ).pipe(Effect.asVoid);
    }),
    compactThreadVersion: Effect.fnUntraced(function* (id, sourceSequence, digest) {
      return yield* run(
        "compact-thread-version",
        Effect.gen(function* () {
          const saved = first(
            yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM fork_library_thread_versions WHERE library_id = ${id} AND source_sequence = ${sourceSequence}`,
          )?.payload_json;
          if (saved === undefined || saved.startsWith(VERSION_DIGEST_PREFIX)) return;
          yield* sql`UPDATE fork_library_thread_versions SET payload_json = ${VERSION_DIGEST_PREFIX + digest} WHERE library_id = ${id} AND source_sequence = ${sourceSequence}`;
          yield* release(saved, id);
        }),
      );
    }),
    eraseThread: Effect.fnUntraced(
      function* (id) {
        const pointers = yield* sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_threads WHERE library_id=${id} UNION SELECT payload_json FROM fork_library_thread_versions WHERE library_id=${id}`;
        yield* sql`DELETE FROM fork_library_search_items WHERE library_id=${id}`;
        yield* sql`DELETE FROM fork_library_history_items WHERE library_id=${id}`;
        yield* sql`DELETE FROM fork_library_history_headers WHERE library_id=${id}`;
        yield* sql`DELETE FROM fork_library_thread_versions WHERE library_id=${id}`;
        yield* sql`DELETE FROM fork_library_threads WHERE library_id=${id}`;
        yield* sql`DELETE FROM fork_library_commands WHERE operation='register-thread' AND json_extract(result_json, '$.id')=${id}`;
        yield* sql`DELETE FROM fork_library_events WHERE json_extract(payload_json, '$.conversation.id')=${id}`;
        for (const pointer of pointers) yield* release(pointer.payload_json, id);
      },
      Effect.mapError((cause) => new LibraryStoreError({ operation: "erase", cause })),
    ),
    importProof: Effect.fnUntraced(function* (requestId) {
      return yield* run(
        "import-proof",
        packed("fork_library_import_proofs", sql`r.request_id = ${requestId}`),
      ).pipe(Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)))));
    }),
    putImportProof: Effect.fnUntraced(function* (requestId, payload) {
      return yield* run(
        "save-history",
        Effect.gen(function* () {
          const previous = first(
            yield* sql<{
              payload_json: string;
            }>`SELECT payload_json FROM fork_library_import_proofs WHERE request_id=${requestId}`,
          )?.payload_json;
          const packed = yield* pack(payload);
          yield* run(
            "put-import-proof",
            sql`INSERT INTO fork_library_import_proofs (request_id, payload_json) VALUES (${requestId}, ${packed}) ON CONFLICT(request_id) DO UPDATE SET payload_json=excluded.payload_json`,
          );
          if (previous !== undefined && previous !== packed) yield* release(previous, "");
        }),
      );
    }),
    receipt: Effect.fnUntraced(function* (requestId) {
      return yield* run(
        "receipt",
        sql<{
          operation: string;
          fingerprint: string;
          result_json: string;
        }>`SELECT operation, fingerprint, result_json FROM fork_library_commands WHERE request_id = ${requestId}`,
      ).pipe(Effect.map(first));
    }),
    putReceipt: Effect.fnUntraced(function* (requestId, operation, fingerprint, result) {
      return yield* run(
        "put-receipt",
        sql`INSERT INTO fork_library_commands (request_id, operation, fingerprint, result_json) VALUES (${requestId}, ${operation}, ${fingerprint}, ${result})`,
      ).pipe(Effect.asVoid);
    }),
    deleteReceipts: Effect.fnUntraced(function* (prefix) {
      return yield* run(
        "delete-receipts",
        sql`DELETE FROM fork_library_commands WHERE substr(request_id, 1, ${prefix.length}) = ${prefix}`,
      ).pipe(Effect.asVoid);
    }),
    appendEvent: Effect.fnUntraced(function* (aggregateId, eventType, payload, createdAt) {
      return yield* run(
        "append-event",
        sql`INSERT INTO fork_library_events (aggregate_id, event_type, payload_json, created_at) VALUES (${aggregateId}, ${eventType}, ${payload}, ${createdAt})`,
      ).pipe(Effect.asVoid);
    }),
  });
});
export const layer = Layer.effect(LibraryStore, make);
