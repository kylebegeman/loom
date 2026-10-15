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

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    readonly transaction: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | LibraryStoreError, R>;
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
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly threadSummary: (
      environmentId: string,
      threadId: string,
    ) => Effect.Effect<string | null, LibraryStoreError>;
    readonly threadIndex: (
      limit: number,
      offset: number,
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
      payload: string,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly threadVersion: (
      id: string,
      sourceSequence: number,
    ) => Effect.Effect<string | null, LibraryStoreError>;
    readonly putThreadVersion: (
      id: string,
      sourceSequence: number,
      payload: string,
    ) => Effect.Effect<void, LibraryStoreError>;
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
const HISTORY_PAGE_BYTES = 2 * 1024 * 1024;
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
  const pack = Effect.fnUntraced(function* (payload: string) {
    const digest = yield* hash(payload);
    const existing =
      yield* sql`SELECT digest FROM fork_library_history_blobs WHERE digest=${digest}`;
    if (existing.length === 0) {
      const bytes = yield* Effect.tryPromise(() => compress(payload));
      yield* sql`INSERT INTO fork_library_history_blobs(digest,bytes) VALUES (${digest},${new Uint8Array(bytes)}) ON CONFLICT(digest) DO NOTHING`;
    }
    return BLOB_PREFIX + digest;
  });
  const unpack = Effect.fnUntraced(function* (payload: string | null) {
    if (payload === null || !payload.startsWith(BLOB_PREFIX)) return payload;
    const digest = payload.slice(BLOB_PREFIX.length);
    const row = (yield* sql<{
      bytes: Uint8Array;
    }>`SELECT bytes FROM fork_library_history_blobs WHERE digest=${digest}`)[0];
    if (!row)
      return yield* new LibraryStoreError({ operation: "missing-history-blob", cause: null });
    const text = (yield* Effect.tryPromise(() => decompress(row.bytes))).toString("utf8");
    if ((yield* hash(text)) !== digest)
      return yield* new LibraryStoreError({ operation: "corrupt-history-blob", cause: null });
    return text;
  });
  const indexHistory = Effect.fnUntraced(function* (id: string, payload: string) {
    // The full compressed archive is retained. The independent visible index keeps a page
    // read from decoding hundreds of megabytes of unrelated execution history.
    const archive = yield* decodeArchiveJson(payload);
    const visible = archive.projection.visibleTurnItems;
    const field = Array.isArray(visible) && visible.length > 0 ? "visibleTurnItems" : "messages";
    const candidate = archive.projection[field];
    const items: readonly unknown[] = Array.isArray(candidate) ? candidate : [];
    const projection = Object.fromEntries(
      Object.entries(archive.projection).map(([key, value]) => [
        key,
        Array.isArray(value) ? [] : value,
      ]),
    );
    const header = yield* encodeJson({ ...archive, projection });
    yield* sql`INSERT INTO fork_library_history_headers(library_id,payload_json,field,total_items) VALUES (${id},${header},${field},${items.length}) ON CONFLICT(library_id) DO UPDATE SET payload_json=excluded.payload_json,field=excluded.field,total_items=excluded.total_items`;
    yield* sql`DELETE FROM fork_library_history_items WHERE library_id=${id}`;
    for (const [position, item] of items.entries()) {
      const full = yield* encodeJson(item);
      // Large displayed text is shortened only in the browsing index, never in retained history.
      const encoded =
        Buffer.byteLength(full) <= HISTORY_PAGE_BYTES
          ? full
          : yield* encodeJson(shortenDisplayText(item));
      if (Buffer.byteLength(encoded) > HISTORY_PAGE_BYTES)
        return yield* new LibraryStoreError({ operation: "history-item-too-large", cause: null });
      yield* sql`INSERT INTO fork_library_history_items(library_id,position,payload_json) VALUES (${id},${position},${encoded})`;
    }
  });
  return LibraryStore.of({
    transaction: (effect) =>
      sql
        .withTransaction(effect)
        .pipe(
          Effect.catchIf(isSqlError, (cause) =>
            Effect.fail(new LibraryStoreError({ operation: "transaction", cause })),
          ),
        ),
    authority: run(
      "authority",
      sql<{
        value_json: string;
      }>`SELECT value_json FROM fork_library_identity WHERE key = 'authority'`,
    ).pipe(Effect.map((rows) => first(rows)?.value_json ?? null)),
    putAuthority: (payload) =>
      run(
        "put-authority",
        sql`INSERT INTO fork_library_identity (key, value_json) VALUES ('authority', ${payload})`,
      ).pipe(Effect.asVoid),
    projectRevision: (id, revision) =>
      run(
        "project-revision",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_project_revisions WHERE project_id = ${id} AND revision = ${revision}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    project: (id) =>
      run(
        "project",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_projects WHERE id = ${id}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    projects: (includeArchived) =>
      run(
        "projects",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_projects WHERE (${includeArchived ? 1 : 0} = 1 OR archived = 0) ORDER BY updated_at DESC, id`,
      ).pipe(Effect.map(payloads)),
    putProject: (input) =>
      run(
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
      ),
    copy: (id) =>
      run(
        "copy",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_working_copies WHERE id = ${id}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    copies: (projectId) =>
      run(
        "copies",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_working_copies ${projectId ? sql`WHERE project_id = ${projectId}` : sql``} ORDER BY updated_at DESC, id`,
      ).pipe(Effect.map(payloads)),
    putCopy: (input) =>
      run(
        "put-copy",
        sql`INSERT INTO fork_library_working_copies (id, project_id, environment_id, root_path, state, payload_json, updated_at) VALUES (${input.id}, ${input.projectId}, ${input.environmentId}, ${input.rootPath}, ${input.state}, ${input.payload}, ${input.updatedAt}) ON CONFLICT(id) DO UPDATE SET state = excluded.state, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).pipe(Effect.asVoid),
    historyWindow: (id, offset, limit) =>
      run(
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
      ),
    history: (id) =>
      run(
        "history",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_threads WHERE library_id = ${id}`,
      ).pipe(
        Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)?.payload_json ?? null))),
      ),
    thread: (environmentId, threadId) =>
      run(
        "thread",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_threads WHERE source_environment_id = ${environmentId} AND source_thread_id = ${threadId}`,
      ).pipe(
        Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)?.payload_json ?? null))),
      ),
    threads: (projectId, limit, offset) =>
      run(
        "threads",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads WHERE project_id = ${projectId} ORDER BY updated_at DESC, source_environment_id, source_thread_id LIMIT ${limit} OFFSET ${offset}`,
      ).pipe(Effect.map(payloads)),
    threadSummary: (environmentId, threadId) =>
      run(
        "thread-summary",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads WHERE source_environment_id = ${environmentId} AND source_thread_id = ${threadId}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    threadIndex: (limit, offset) =>
      run(
        "thread-index",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads ORDER BY updated_at DESC, source_environment_id, source_thread_id LIMIT ${limit} OFFSET ${offset}`,
      ).pipe(Effect.map(payloads)),
    putThread: (input) =>
      run(
        "save-history",
        Effect.gen(function* () {
          const packed = yield* pack(input.payload);
          yield* indexHistory(input.id, input.payload);
          return yield* run(
            "put-thread",
            sql`INSERT INTO fork_library_threads (library_id, source_environment_id, source_thread_id, project_id, working_copy_id, source_sequence, summary_json, payload_json, updated_at) VALUES (${input.id}, ${input.environmentId}, ${input.threadId}, ${input.projectId}, ${input.workingCopyId}, ${input.sourceSequence}, ${input.summary}, ${packed}, ${input.updatedAt}) ON CONFLICT(source_environment_id, source_thread_id) DO UPDATE SET working_copy_id = excluded.working_copy_id, source_sequence = excluded.source_sequence, summary_json = excluded.summary_json, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
          ).pipe(Effect.asVoid);
        }),
      ),
    cursor: (environmentId, journalId) =>
      run(
        "cursor",
        sql<{
          last_sequence: number;
        }>`SELECT last_sequence FROM fork_library_host_cursors WHERE environment_id = ${environmentId} AND journal_id = ${journalId}`,
      ).pipe(Effect.map((rows) => first(rows)?.last_sequence ?? 0)),
    putCursor: (environmentId, journalId, sequence) =>
      run(
        "put-cursor",
        sql`INSERT INTO fork_library_host_cursors (environment_id, journal_id, last_sequence) VALUES (${environmentId}, ${journalId}, ${sequence}) ON CONFLICT(environment_id, journal_id) DO UPDATE SET last_sequence = excluded.last_sequence`,
      ).pipe(Effect.asVoid),
    ingestedDigest: (environmentId, journalId, sequence) =>
      run(
        "ingested-digest",
        sql<{
          payload_digest: string;
        }>`SELECT payload_digest FROM fork_library_ingested_entries WHERE environment_id = ${environmentId} AND journal_id = ${journalId} AND sequence = ${sequence}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_digest ?? null)),
    putIngestedDigest: (environmentId, journalId, sequence, digest, payload) =>
      run(
        "save-history",
        Effect.gen(function* () {
          const packed = yield* pack(payload);
          return yield* run(
            "put-ingested-digest",
            sql`INSERT INTO fork_library_ingested_entries (environment_id, journal_id, sequence, payload_digest, payload_json) VALUES (${environmentId}, ${journalId}, ${sequence}, ${digest}, ${packed})`,
          ).pipe(Effect.asVoid);
        }),
      ),
    threadVersion: (id, sourceSequence) =>
      run(
        "thread-version",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_thread_versions WHERE library_id = ${id} AND source_sequence = ${sourceSequence}`,
      ).pipe(
        Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)?.payload_json ?? null))),
      ),
    putThreadVersion: (id, sourceSequence, payload) =>
      run(
        "save-history",
        Effect.gen(function* () {
          const packed = yield* pack(payload);
          return yield* run(
            "put-thread-version",
            sql`INSERT INTO fork_library_thread_versions (library_id, source_sequence, payload_json) VALUES (${id}, ${sourceSequence}, ${packed})`,
          ).pipe(Effect.asVoid);
        }),
      ),
    importProof: (requestId) =>
      run(
        "import-proof",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_import_proofs WHERE request_id = ${requestId}`,
      ).pipe(
        Effect.flatMap((rows) => run("unpack-history", unpack(first(rows)?.payload_json ?? null))),
      ),
    putImportProof: (requestId, payload) =>
      run(
        "save-history",
        Effect.gen(function* () {
          const packed = yield* pack(payload);
          return yield* run(
            "put-import-proof",
            sql`INSERT INTO fork_library_import_proofs (request_id, payload_json) VALUES (${requestId}, ${packed})`,
          ).pipe(Effect.asVoid);
        }),
      ),
    receipt: (requestId) =>
      run(
        "receipt",
        sql<{
          operation: string;
          fingerprint: string;
          result_json: string;
        }>`SELECT operation, fingerprint, result_json FROM fork_library_commands WHERE request_id = ${requestId}`,
      ).pipe(Effect.map(first)),
    putReceipt: (requestId, operation, fingerprint, result) =>
      run(
        "put-receipt",
        sql`INSERT INTO fork_library_commands (request_id, operation, fingerprint, result_json) VALUES (${requestId}, ${operation}, ${fingerprint}, ${result})`,
      ).pipe(Effect.asVoid),
    appendEvent: (aggregateId, eventType, payload, createdAt) =>
      run(
        "append-event",
        sql`INSERT INTO fork_library_events (aggregate_id, event_type, payload_json, created_at) VALUES (${aggregateId}, ${eventType}, ${payload}, ${createdAt})`,
      ).pipe(Effect.asVoid),
  });
});
export const layer = Layer.effect(LibraryStore, make);
