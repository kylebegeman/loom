import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryImportShadowRequest,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { withheldCondition } from "../deleted-history/deletedHistory.ts";
import { validLibraryResources } from "./policy.ts";

/**
 * The conversations of an export that `activate` has not bound yet. The Library may already hold
 * them live, and only a binding lets a later deletion reach it, so the deleted history purge
 * keeps them while their export is recorded here. Each export records itself before its archive
 * can be uploaded; its activation removes the record.
 */
const PendingImport = Schema.fromJsonString(
  Schema.Struct({
    version: Schema.Literal(1),
    requestId: Schema.String,
    threadIds: Schema.Array(ThreadId),
  }),
);
const decodePendingImport = Schema.decodeEffect(PendingImport);
const encodePendingImport = Schema.encodeEffect(PendingImport);
const pendingImportsDirectory = (path: Path.Path, stateDir: string) =>
  path.join(stateDir, "project-library", "host", "pending-imports");
const pendingImportFile = Effect.fnUntraced(function* (stateDir: string, requestId: string) {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const key = Hex.encode(yield* crypto.digest("SHA-256", new TextEncoder().encode(requestId)));
  return path.join(pendingImportsDirectory(path, stateDir), `${key}.json`);
});

export const recordPendingImport = Effect.fnUntraced(function* (input: {
  readonly stateDir: string;
  readonly requestId: string;
  readonly threadIds: ReadonlyArray<ThreadId>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* pendingImportFile(input.stateDir, input.requestId);
  // A repeated export under the same request id may differ; the Library holds one of them.
  const previous = (yield* fs.exists(file))
    ? (yield* decodePendingImport(yield* fs.readFileString(file))).threadIds
    : [];
  yield* fs.makeDirectory(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${yield* randomUuidV4}.pending`;
  yield* Effect.gen(function* () {
    yield* fs.writeFileString(
      temporary,
      yield* encodePendingImport({
        version: 1,
        requestId: input.requestId,
        threadIds: [...new Set([...previous, ...input.threadIds])],
      }),
      { flag: "wx", mode: 0o600 },
    );
    yield* fs.rename(temporary, file);
  }).pipe(Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)));
});

export const clearPendingImport = Effect.fnUntraced(function* (input: {
  readonly stateDir: string;
  readonly requestId: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(yield* pendingImportFile(input.stateDir, input.requestId), { force: true });
});

/** Fails on a record it cannot read, so a damaged one never lets the purge go ahead. */
export const pendingImportThreadIds = Effect.fnUntraced(function* (stateDir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = pendingImportsDirectory(path, stateDir);
  const threadIds = new Set<string>();
  if (!(yield* fs.exists(directory))) return threadIds;
  for (const name of yield* fs.readDirectory(directory)) {
    if (!name.endsWith(".json")) continue;
    // Activation removes its record only after binding the conversations it lists.
    const text = yield* fs
      .readFileString(path.join(directory, name))
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)));
    if (text === null) continue;
    const record = yield* decodePendingImport(text);
    for (const threadId of record.threadIds) threadIds.add(threadId);
  }
  return threadIds;
});

/** Grouping is explicit: source folders and copies never become projects by inference. */
export const LibraryMigrationPlan = Schema.Struct({
  sourceEnvironmentId: EnvironmentId,
  projects: Schema.Array(LibraryProject),
  copies: Schema.Array(
    Schema.Struct({
      copy: LibraryWorkingCopy,
      localProjects: Schema.Array(
        Schema.Struct({
          localProjectId: ProjectId,
          cwd: Schema.String,
          resourceIds: Schema.Array(Schema.String),
        }),
      ),
    }),
  ),
  excludedThreadIds: Schema.Array(ThreadId),
});
export type LibraryMigrationPlan = typeof LibraryMigrationPlan.Type;
export class LibraryMigration extends Context.Service<
  LibraryMigration,
  {
    readonly withSnapshot: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | LibraryError, R>;
    readonly inventory: Effect.Effect<
      {
        readonly projects: readonly ProjectStore.ProjectRow[];
        readonly threads: readonly {
          readonly threadId: ThreadId;
          readonly localProjectId: ProjectId;
          readonly title: string;
          readonly archived: boolean;
          readonly deleted: boolean;
          readonly sequence: number;
        }[];
        readonly eventSequence: number;
      },
      LibraryError
    >;
    readonly exportShadow: (input: {
      readonly requestId: string;
      readonly journalId: string;
      readonly plan: LibraryMigrationPlan;
    }) => Effect.Effect<LibraryImportShadowRequest, LibraryError>;
  }
>()("t3/fork/project-library/LibraryMigration") {}
const isLibraryError = Schema.is(LibraryError);
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const crypto = yield* Crypto.Crypto;
  const inventory = sql
    .withTransaction(
      Effect.gen(function* () {
        const projectRows = yield* projects.list({ includeDeleted: true });
        // A source without the Library tables, such as an upstream database, never purged history.
        const replicationRows =
          (yield* sql`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'fork_library_source_threads'`)
            .length > 0;
        const rows = yield* sql<{
          thread_id: string;
          project_id: string;
          title: string;
          archived_at: string | null;
          deleted_at: string | null;
          sequence: number;
        }>`
      SELECT t.thread_id,t.project_id,t.title,t.archived_at,t.deleted_at,
        COALESCE((SELECT MAX(e.sequence) FROM orchestration_events e WHERE e.application_event_version=2 AND e.aggregate_kind='thread' AND e.stream_id=t.thread_id),0) AS sequence
      FROM orchestration_v2_projection_threads t
      WHERE NOT (t.deleted_at IS NOT NULL AND ${withheldCondition(sql, sql`t.thread_id`, { replicationRows })})
      ORDER BY t.project_id,t.created_at,t.thread_id`;
        const latest =
          (yield* sql<{
            sequence: number;
          }>`SELECT COALESCE(MAX(sequence),0) AS sequence FROM orchestration_events WHERE application_event_version=2`)[0]
            ?.sequence ?? 0;
        return {
          projects: projectRows,
          threads: rows.map((row) => ({
            threadId: ThreadId.make(row.thread_id),
            localProjectId: ProjectId.make(row.project_id),
            title: row.title,
            archived: row.archived_at !== null,
            deleted: row.deleted_at !== null,
            sequence: row.sequence,
          })),
          eventSequence: latest,
        };
      }),
    )
    .pipe(Effect.mapError(() => new LibraryError({ reason: "io" })));
  const exportShadow = Effect.fnUntraced(
    function* (input: {
      readonly requestId: string;
      readonly journalId: string;
      readonly plan: LibraryMigrationPlan;
    }) {
      const { plan } = input;
      if (
        new Set(plan.projects.map((project) => project.id)).size !== plan.projects.length ||
        new Set(plan.copies.map((entry) => entry.copy.id)).size !== plan.copies.length ||
        plan.projects.some(
          (project) => !validLibraryResources(project.resources, { allowLocalRemotes: true }),
        )
      )
        return yield* new LibraryError({ reason: "invalid" });
      const mapping = new Map<
        ProjectId,
        { copy: LibraryWorkingCopy; resourceIds: readonly string[] }
      >();
      for (const entry of plan.copies) {
        const project = plan.projects.find((candidate) => candidate.id === entry.copy.projectId);
        if (
          project === undefined ||
          project.revision !== entry.copy.projectRevision ||
          entry.copy.environmentId !== plan.sourceEnvironmentId ||
          entry.copy.ownership !== "borrowed" ||
          !["ready", "missing"].includes(entry.copy.state) ||
          entry.copy.repositories.some(
            (repository) =>
              !project.resources.some(
                (resource) => resource.kind !== "link" && resource.id === repository.resourceId,
              ),
          )
        )
          return yield* new LibraryError({ reason: "invalid" });
        for (const local of entry.localProjects) {
          if (
            mapping.has(local.localProjectId) ||
            new Set(local.resourceIds).size !== local.resourceIds.length ||
            local.resourceIds.some(
              (id) => !entry.copy.repositories.some((repository) => repository.resourceId === id),
            )
          )
            return yield* new LibraryError({ reason: "invalid" });
          mapping.set(local.localProjectId, { copy: entry.copy, resourceIds: local.resourceIds });
        }
      }
      const records = yield* inventory;
      for (const entry of plan.copies)
        for (const local of entry.localProjects) {
          if (
            records.projects.find((project) => project.projectId === local.localProjectId)
              ?.workspaceRoot !== local.cwd
          )
            return yield* new LibraryError({ reason: "invalid" });
        }
      const excluded = new Set(plan.excludedThreadIds);
      if (
        plan.excludedThreadIds.some(
          (id) => !records.threads.some((thread) => thread.threadId === id),
        )
      )
        return yield* new LibraryError({ reason: "invalid" });
      const threads: (typeof LibraryImportShadowRequest.Type.threads)[number][] = [];
      for (const row of records.threads) {
        if (excluded.has(row.threadId)) continue;
        const bound = mapping.get(row.localProjectId);
        if (bound === undefined)
          return yield* new LibraryError({
            reason: "blocked",
            detail:
              "A conversation belongs to a project this plan does not include. Include its project or exclude the conversation, then try again.",
          });
        const snapshot = yield* projections.getThreadSnapshot(row.threadId);
        if (snapshot.projection.thread.projectId !== row.localProjectId)
          return yield* new LibraryError({ reason: "invalid" });
        const id = Hex.encode(
          yield* crypto.digest(
            "SHA-256",
            new TextEncoder().encode(`${plan.sourceEnvironmentId}\0${row.threadId}`),
          ),
        );
        const latestRun = snapshot.projection.runs.reduce<
          (typeof snapshot.projection.runs)[number] | undefined
        >(
          (latest, run) => (latest === undefined || run.ordinal > latest.ordinal ? run : latest),
          undefined,
        );
        const context = plan.projects.find((candidate) => candidate.id === bound.copy.projectId)!;
        threads.push({
          context,
          summary: {
            id,
            projectId: bound.copy.projectId,
            projectRevision: context.revision,
            environmentId: plan.sourceEnvironmentId,
            threadId: row.threadId,
            localProjectId: row.localProjectId,
            workingCopyId: bound.copy.id,
            resourceIds: bound.resourceIds,
            title: row.title,
            status: latestRun?.status ?? "idle",
            archived: row.archived,
            deleted: row.deleted,
            createdAt: DateTime.formatIso(snapshot.projection.thread.createdAt),
            updatedAt: DateTime.formatIso(snapshot.projection.updatedAt),
            syncedAt: DateTime.formatIso(yield* DateTime.now),
            sequence: snapshot.snapshotSequence,
          },
          projection: snapshot.projection,
        });
      }
      // Imported source watermarks are not host-outbox ordinals. A fresh journal starts at zero.
      return {
        requestId: input.requestId,
        sourceEnvironmentId: plan.sourceEnvironmentId,
        journalId: input.journalId,
        projects: plan.projects,
        copies: plan.copies.map((entry) => entry.copy),
        threads,
        throughSequence: 0,
      } satisfies LibraryImportShadowRequest;
    },
    (effect) => sql.withTransaction(effect),
    Effect.mapError((cause) =>
      isLibraryError(cause) ? cause : new LibraryError({ reason: "io" }),
    ),
  );
  return LibraryMigration.of({
    inventory,
    exportShadow,
    withSnapshot: Effect.fn("LibraryMigration.withSnapshot")(function* <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ): Effect.fn.Return<A, E | LibraryError, R> {
      return yield* sql
        .withTransaction(effect)
        .pipe(
          Effect.mapError((cause) =>
            isLibraryError(cause) ? cause : new LibraryError({ reason: "io" }),
          ),
        );
    }),
  });
});
export const layer = Layer.effect(LibraryMigration, make);
