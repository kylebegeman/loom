import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId, ThreadId } from "@t3tools/contracts";
import type { LibraryResolvedBinding } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type * as EffectOutbox from "../../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../../orchestration-v2/EffectWorker.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { ProjectLibraryMigrations } from "../project-library/migrations.ts";
import { localProjectId, resource, source } from "../project-library/Library.testkit.ts";
import * as WorkspaceStore from "../project-library/LibraryWorkspaceStore.ts";
import { layerHold } from "./AttachmentCleanupHold.ts";

const threadId = ThreadId.make("thread:deleted");
const cleanup: EffectOutbox.OrchestrationEffectV2["request"] = {
  type: "attachment.cleanup",
  attachmentIds: ["deleted-file"],
};
const resolved: LibraryResolvedBinding = {
  cwd: "/workspace",
  localProjectId,
  repositoryPaths: ["/workspace/api"],
  binding: {
    projectId: "project",
    projectRevision: 1,
    workingCopyId: "copy",
    environmentId: source,
    resourceIds: [resource.id],
  },
};
const effectFor = (
  request: EffectOutbox.OrchestrationEffectV2["request"],
): EffectOutbox.OrchestrationEffectV2 => ({
  id: "effect",
  commandId: CommandId.make("command"),
  threadId,
  request,
  status: "running",
  attemptCount: 1,
  availableAt: "2026-10-01T00:00:00.000Z",
  leaseOwner: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  completedAt: null,
  lastError: null,
});

const run = <A, E>(
  use: (f: {
    readonly sql: SqlClient.SqlClient;
    readonly delegated: Effect.Effect<ReadonlyArray<string>>;
    readonly bind: Effect.Effect<void>;
  }) => Effect.Effect<A, E, EffectWorker.OrchestrationEffectExecutorV2 | SqlClient.SqlClient>,
) => {
  const delegated: string[] = [];
  let bound = false;
  const inner = Layer.succeed(EffectWorker.OrchestrationEffectExecutorV2, {
    execute: (effect) => Effect.sync(() => void delegated.push(effect.request.type)),
  });
  const workspaces = Layer.mock(WorkspaceStore.LibraryWorkspaceStore)({
    getBinding: () => Effect.sync(() => (bound ? resolved : null)),
  });
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json) VALUES
      (1,'created',0,'2026-10-01T00:00:00.000Z','server','{}',2,'thread',${threadId},'thread.created','{}'),
      (2,'deleted',1,'2026-10-01T00:00:00.000Z','server','{}',2,'thread',${threadId},'thread.deleted','{}')`;
    return yield* use({
      sql,
      delegated: Effect.sync(() => [...delegated]),
      bind: Effect.sync(() => {
        bound = true;
      }),
    });
  }).pipe(
    Effect.provide(
      layerHold(inner).pipe(
        Layer.provide(workspaces),
        Layer.provideMerge(SqlitePersistence.layerMemory),
        Layer.provideMerge(NodeServices.layer),
      ),
    ),
  );
};

const execute = (request: EffectOutbox.OrchestrationEffectV2["request"]) =>
  EffectWorker.OrchestrationEffectExecutorV2.pipe(
    Effect.flatMap((executor) => executor.execute(effectFor(request))),
  );

describe("attachment cleanup for Library conversations", () => {
  it.effect("holds a replicated conversation's files until the Library has its deletion", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        yield* f.sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence,acknowledged_sequence)
          VALUES (${threadId},1,1)`;
        yield* execute(cleanup);
        // Everything else a deletion runs still goes through.
        yield* execute({ type: "terminal.cleanup" });
        assert.deepEqual(yield* f.delegated, ["terminal.cleanup"]);

        // Acknowledged, but a newer snapshot still waits in the outbox.
        yield* f.sql`UPDATE fork_library_source_threads SET acknowledged_sequence=2`;
        yield* f.sql`INSERT INTO fork_library_source_outbox (thread_id,source_sequence,payload_json)
          VALUES (${threadId},2,'{}')`;
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, ["terminal.cleanup"]);

        yield* f.sql`DELETE FROM fork_library_source_outbox`;
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, ["terminal.cleanup", "attachment.cleanup"]);
      }),
    ),
  );

  it.effect("finds the deletion however many events follow it", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        // A subagent or provider turn still draining after the deletion keeps writing to it.
        yield* f.sql`
          WITH RECURSIVE late(n) AS (SELECT 3 UNION ALL SELECT n + 1 FROM late WHERE n < 302)
          INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json)
          SELECT n,'late-' || n,n - 1,'2026-10-01T00:00:00.000Z','server','{}',2,'thread',${threadId},'node.updated','{}'
          FROM late`;
        yield* f.sql`INSERT INTO fork_library_source_threads (thread_id,queued_sequence,acknowledged_sequence)
          VALUES (${threadId},1,1)`;
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, []);

        yield* f.sql`UPDATE fork_library_source_threads SET acknowledged_sequence=2`;
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, ["attachment.cleanup"]);
      }),
    ),
  );

  it.effect("cleans up at once for a conversation that is not saved to the Library", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, ["attachment.cleanup"]);
      }),
    ),
  );

  it.effect("holds a bound conversation's files before the Library has received it", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* runForkMigrationSet(ProjectLibraryMigrations);
        yield* f.bind;
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, []);
      }),
    ),
  );

  it.effect("cleans up at once when the Library tables do not exist", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* execute(cleanup);
        assert.deepEqual(yield* f.delegated, ["attachment.cleanup"]);
      }),
    ),
  );
});
