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
    readonly copies: (projectId: string) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly putCopy: (input: {
      id: string;
      projectId: string;
      environmentId: string;
      rootPath: string;
      state: string;
      payload: string;
      updatedAt: string;
    }) => Effect.Effect<void, LibraryStoreError>;
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

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const run = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
    effect.pipe(Effect.mapError((cause) => new LibraryStoreError({ operation, cause })));
  const first = <T>(rows: readonly T[]) => rows[0] ?? null;
  const payloads = (rows: readonly { payload_json: string }[]) =>
    rows.map((row) => row.payload_json);
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
        }>`SELECT payload_json FROM fork_library_working_copies WHERE project_id = ${projectId} ORDER BY updated_at DESC, id`,
      ).pipe(Effect.map(payloads)),
    putCopy: (input) =>
      run(
        "put-copy",
        sql`INSERT INTO fork_library_working_copies (id, project_id, environment_id, root_path, state, payload_json, updated_at) VALUES (${input.id}, ${input.projectId}, ${input.environmentId}, ${input.rootPath}, ${input.state}, ${input.payload}, ${input.updatedAt}) ON CONFLICT(id) DO UPDATE SET state = excluded.state, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).pipe(Effect.asVoid),
    history: (id) =>
      run(
        "history",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_threads WHERE library_id = ${id}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    thread: (environmentId, threadId) =>
      run(
        "thread",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_threads WHERE source_environment_id = ${environmentId} AND source_thread_id = ${threadId}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    threads: (projectId, limit, offset) =>
      run(
        "threads",
        sql<{
          payload_json: string;
        }>`SELECT summary_json AS payload_json FROM fork_library_threads WHERE project_id = ${projectId} ORDER BY updated_at DESC, source_environment_id, source_thread_id LIMIT ${limit} OFFSET ${offset}`,
      ).pipe(Effect.map(payloads)),
    putThread: (input) =>
      run(
        "put-thread",
        sql`INSERT INTO fork_library_threads (library_id, source_environment_id, source_thread_id, project_id, working_copy_id, source_sequence, summary_json, payload_json, updated_at) VALUES (${input.id}, ${input.environmentId}, ${input.threadId}, ${input.projectId}, ${input.workingCopyId}, ${input.sourceSequence}, ${input.summary}, ${input.payload}, ${input.updatedAt}) ON CONFLICT(source_environment_id, source_thread_id) DO UPDATE SET working_copy_id = excluded.working_copy_id, source_sequence = excluded.source_sequence, summary_json = excluded.summary_json, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).pipe(Effect.asVoid),
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
        "put-ingested-digest",
        sql`INSERT INTO fork_library_ingested_entries (environment_id, journal_id, sequence, payload_digest, payload_json) VALUES (${environmentId}, ${journalId}, ${sequence}, ${digest}, ${payload})`,
      ).pipe(Effect.asVoid),
    threadVersion: (id, sourceSequence) =>
      run(
        "thread-version",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_thread_versions WHERE library_id = ${id} AND source_sequence = ${sourceSequence}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    putThreadVersion: (id, sourceSequence, payload) =>
      run(
        "put-thread-version",
        sql`INSERT INTO fork_library_thread_versions (library_id, source_sequence, payload_json) VALUES (${id}, ${sourceSequence}, ${payload})`,
      ).pipe(Effect.asVoid),
    importProof: (requestId) =>
      run(
        "import-proof",
        sql<{
          payload_json: string;
        }>`SELECT payload_json FROM fork_library_import_proofs WHERE request_id = ${requestId}`,
      ).pipe(Effect.map((rows) => first(rows)?.payload_json ?? null)),
    putImportProof: (requestId, payload) =>
      run(
        "put-import-proof",
        sql`INSERT INTO fork_library_import_proofs (request_id, payload_json) VALUES (${requestId}, ${payload})`,
      ).pipe(Effect.asVoid),
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
