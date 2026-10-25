import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EventId } from "@t3tools/contracts";
import type { LibraryProject } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as Migration from "./LibraryMigration.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";
import {
  source,
  localProjectId,
  threadId,
  resource,
  archiveFor,
  copyFor,
} from "./Library.testkit.ts";
const project: LibraryProject = {
  id: "aspectavy",
  title: "AspectAvy",
  brief: "Four repositories, one project.",
  revision: 1,
  resources: [
    resource,
    ...["web", "ios", "android"].map((id) => ({
      ...resource,
      id,
      title: id,
      relativePath: id,
      remoteUrl: `https://github.com/example/${id}.git`,
    })),
  ],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const copy = copyFor(project);
const plan: Migration.LibraryMigrationPlan = {
  sourceEnvironmentId: source,
  projects: [project],
  copies: [
    {
      copy,
      localProjects: [
        { localProjectId, cwd: copy.repositories[0]!.path, resourceIds: [resource.id] },
      ],
    },
  ],
  excludedThreadIds: [],
};
const fixture = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const original = yield* archiveFor(project);
  yield* projections.apply({
    id: EventId.make("thread-created"),
    threadId,
    type: "thread.created",
    payload: original.projection.thread,
    occurredAt: original.projection.updatedAt,
  });
  yield* projections.apply({
    id: EventId.make("message"),
    threadId,
    type: "message.updated",
    payload: original.projection.messages[0]!,
    occurredAt: original.projection.updatedAt,
  });
  yield* sql`INSERT INTO orchestration_events(event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,actor_kind,payload_json,metadata_json,application_event_version) VALUES ('created','thread',${threadId},1,'thread.created','2026-10-15T00:00:00.000Z','server','{}','{}',2)`;
  const projects = Layer.mock(ProjectStore.ProjectStoreV2)({
    list: () =>
      Effect.succeed([
        {
          projectId: localProjectId,
          title: "Original source folder",
          workspaceRoot: copy.repositories[0]!.path,
          defaultModelSelection: null,
          defaultThreadEnvMode: null,
          autoPull: false,
          faviconPath: null,
          projectIcon: null,
          scripts: [],
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          deletedAt: null,
        },
      ]),
  });
  const migration = yield* Migration.LibraryMigration.pipe(
    Effect.provide(Migration.layer.pipe(Layer.provide(projects))),
  );
  return { migration, original, sql };
});
const run = <A, E, R>(use: (f: Effect.Success<typeof fixture>) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(
    Effect.provide(
      ProjectionStore.layer.pipe(
        Layer.provideMerge(layerMemory),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
    Effect.scoped,
  );
describe("explicit Library shadow migration", () => {
  it.effect("preserves missing borrowed folders as unavailable while retaining all history", () =>
    run((f) =>
      Effect.gen(function* () {
        const exported = yield* f.migration.exportShadow({
          requestId: "missing-copy",
          journalId: "migration",
          plan: { ...plan, copies: [{ ...plan.copies[0]!, copy: { ...copy, state: "missing" } }] },
        });
        expect(exported.copies[0]?.state).toBe("missing");
        expect(exported.threads[0]?.projection.messages).toEqual(f.original.projection.messages);
      }),
    ),
  );
  it.effect(
    "groups multiple resources under one independent project without changing source IDs or bodies",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const exported = yield* f.migration.exportShadow({
            requestId: "shadow",
            journalId: "migration",
            plan,
          });
          expect(exported.projects).toHaveLength(1);
          expect(exported.projects[0]?.resources).toHaveLength(4);
          expect(exported.copies[0]?.ownership).toBe("borrowed");
          expect(exported.threads[0]?.projection.messages).toEqual(f.original.projection.messages);
          expect(exported.threads[0]?.summary).toMatchObject({
            threadId,
            localProjectId,
            projectId: project.id,
            resourceIds: [resource.id],
            sequence: 1,
            projectRevision: 1,
          });
          expect(exported.threads[0]?.context).toEqual(project);
          expect(exported.throughSequence).toBe(0);
          expect(
            yield* f.sql`SELECT thread_id FROM orchestration_v2_projection_threads`,
          ).toHaveLength(1);
        }),
      ),
  );
  it.effect(
    "requires explicit mapping or exclusion instead of guessing from folder titles or repository URLs",
    () =>
      run((f) =>
        Effect.gen(function* () {
          expect(
            (yield* f.migration
              .exportShadow({
                requestId: "unmapped",
                journalId: "migration",
                plan: { ...plan, copies: [] },
              })
              .pipe(Effect.flip)).reason,
          ).toBe("blocked");
          expect(
            (yield* f.migration.exportShadow({
              requestId: "excluded",
              journalId: "migration",
              plan: { ...plan, copies: [], excludedThreadIds: [threadId] },
            })).threads,
          ).toEqual([]);
          const mismatched = {
            ...plan,
            copies: [
              {
                copy,
                localProjects: [
                  { localProjectId, cwd: "/another/source", resourceIds: [resource.id] },
                ],
              },
            ],
          };
          expect(
            (yield* f.migration
              .exportShadow({ requestId: "mismatch", journalId: "migration", plan: mismatched })
              .pipe(Effect.flip)).reason,
          ).toBe("invalid");
        }),
      ),
  );
  it.effect("leaves out a deleted conversation once its history was purged", () =>
    run((f) =>
      Effect.gen(function* () {
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const thread = f.original.projection.thread;
        yield* projections.apply({
          id: EventId.make("deleted"),
          threadId,
          type: "thread.deleted",
          payload: { ...thread, deletedAt: thread.createdAt },
          occurredAt: thread.createdAt,
        });
        yield* f.sql`INSERT INTO orchestration_events(event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,actor_kind,payload_json,metadata_json,application_event_version) VALUES
          ('message','thread',${threadId},2,'message.updated','2026-10-15T00:00:00.000Z','server','{}','{}',2),
          ('deleted','thread',${threadId},3,'thread.deleted','2026-10-15T00:00:00.000Z','server','{}','{}',2)`;
        const exported = (requestId: string) =>
          f.migration
            .exportShadow({ requestId, journalId: "migration", plan })
            .pipe(Effect.map((result) => result.threads.map((entry) => entry.summary.deleted)));
        expect(yield* exported("deleted")).toEqual([true]);
        // A purge leaves only the creation and the deletion.
        yield* f.sql`DELETE FROM orchestration_events WHERE event_id = 'message'`;
        expect(yield* exported("purged")).toEqual([]);
      }),
    ),
  );
  it.effect("leaves out a deleted conversation once the Library holds its deletion", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        const projections = yield* ProjectionStore.ProjectionStoreV2;
        const thread = f.original.projection.thread;
        yield* projections.apply({
          id: EventId.make("deleted"),
          threadId,
          type: "thread.deleted",
          payload: { ...thread, deletedAt: thread.createdAt },
          occurredAt: thread.createdAt,
        });
        yield* f.sql`INSERT INTO orchestration_events(sequence,event_id,aggregate_kind,stream_id,stream_version,event_type,occurred_at,actor_kind,payload_json,metadata_json,application_event_version) VALUES
          (2,'message','thread',${threadId},2,'message.updated','2026-10-15T00:00:00.000Z','server','{}','{}',2),
          (3,'deleted','thread',${threadId},3,'thread.deleted','2026-10-15T00:00:00.000Z','server','{}','{}',2)`;
        const exported = (requestId: string) =>
          f.migration
            .exportShadow({ requestId, journalId: "migration", plan })
            .pipe(Effect.map((result) => result.threads.map((entry) => entry.summary.deleted)));
        // Saved to the Library only while it was live.
        yield* f.sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence,acknowledged_sequence) VALUES (${threadId},2,2)`;
        expect(yield* exported("live-copy")).toEqual([true]);
        yield* f.sql`UPDATE fork_library_source_threads SET acknowledged_sequence=3`;
        expect(yield* exported("deletion-held")).toEqual([]);
      }),
    ),
  );
});
