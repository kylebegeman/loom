import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  LibraryError,
  LibraryImportShadowRequest,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { validLibraryResources } from "./policy.ts";

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
      FROM orchestration_v2_projection_threads t ORDER BY t.project_id,t.created_at,t.thread_id`;
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
        if (bound === undefined) return yield* new LibraryError({ reason: "blocked" });
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
  return LibraryMigration.of({ inventory, exportShadow });
});
export const layer = Layer.effect(LibraryMigration, make);
