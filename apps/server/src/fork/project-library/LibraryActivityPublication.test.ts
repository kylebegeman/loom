import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, type OrchestrationV2AppThread } from "@t3tools/contracts";
import {
  LIBRARY_TIMELINE_ACTIVITY_FEATURE,
  LibraryError,
  type LibraryProject,
  type LibraryRecordActivityRequest,
  type MiniReceipt,
} from "@t3tools/contracts/fork";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import { layerMemory } from "../../persistence/Sqlite.ts";
import createScheduledTasks from "../../persistence/Migrations/OrchestrationV2/ScheduledTasks.ts";
import { ServerActivation } from "../../serverActivation.ts";
import * as MiniOffload from "../mini-offload/MiniOffloadService.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { copyFor, localProjectId, resource, source } from "./Library.testkit.ts";
import * as Activity from "./LibraryActivityPublication.ts";
import * as Publisher from "./LibraryPublisher.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import { ProjectLibraryMigrations } from "./migrations.ts";

const project: LibraryProject = {
  id: "activity-project",
  title: "AspectAvy",
  brief: "",
  revision: 1,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const copy = copyFor(project);
const receipt: WorkspaceStore.WorkspaceReceipt = {
  requestId: copy.id,
  fingerprint: copy.id,
  project,
  copy,
  rootLocalProjectId: null,
  rootCheckpointRepository: true,
  legacyThreadIds: [],
  rootIdentity: null,
  releaseRequestId: null,
  releaseReviewToken: null,
  removalPath: null,
  archivePath: null,
  archiveDigest: null,
};
const scheduled: Activity.LibraryActivityCompletion = {
  id: "scheduled:task:2026-10-16T10:00:00.000Z",
  // Recent enough for the collection window, whatever day the test runs.
  at: "2999-01-01T00:00:00.000Z",
  threadId: null,
  localProjectId,
  work: {
    kind: "scheduled-run",
    run: {
      taskId: "task",
      title: "Nightly checks",
      status: "succeeded",
      startedAt: "2999-01-01T00:00:00.000Z",
    },
  },
};
const job: Activity.LibraryActivityCompletion = {
  id: "mini:0123456789abcdef0123456789abcdef",
  at: "2999-01-01T00:01:00.000Z",
  threadId: ThreadId.make("mini-thread"),
  localProjectId,
  work: {
    kind: "mini-job",
    job: {
      requestId: "0123456789abcdef0123456789abcdef",
      label: "Unit tests",
      status: "failed",
      exitCode: 1,
    },
  },
};

function partial<A extends object>(value: Partial<A>): A {
  return new Proxy(value as A, {
    get: (target, key) => {
      if (key in target) return Reflect.get(target, key);
      throw new Error(`Unexpected test service call: ${String(key)}`);
    },
  });
}

const fixture = Effect.gen(function* () {
  yield* runForkMigrationSet(ProjectLibraryMigrations);
  const sql = yield* SqlClient.SqlClient;
  const completions = yield* Ref.make<ReadonlyArray<Activity.LibraryActivityCompletion>>([
    scheduled,
    job,
    // Work outside every Library copy stays on this computer.
    { ...scheduled, id: "scheduled:elsewhere:1", localProjectId: ProjectId.make("elsewhere") },
  ]);
  const features = yield* Ref.make<ReadonlyArray<string>>([LIBRARY_TIMELINE_ACTIVITY_FEATURE]);
  const offline = yield* Ref.make(false);
  const sent = yield* Ref.make<LibraryRecordActivityRequest[]>([]);
  const recorded = yield* Ref.make<ReadonlyMap<string, LibraryRecordActivityRequest>>(new Map());
  const publisher = Publisher.LibraryPublisher.of({
    enabled: true,
    project: () => Effect.die("unused"),
    proposeBrief: () => Effect.die("unused"),
    info: Ref.get(features).pipe(
      Effect.map((list) => ({
        environmentId: source,
        authorityId: "authority",
        authorityEpoch: 1,
        assets: "local" as const,
        features: list,
      })),
    ),
    recordActivity: (input) =>
      Effect.gen(function* () {
        yield* Ref.update(sent, (all) => [...all, input]);
        if (yield* Ref.get(offline)) return yield* new LibraryError({ reason: "io" });
        // The Library keeps one entry per request id, as its receipts do.
        yield* Ref.update(recorded, (all) => new Map(all).set(input.requestId, input));
        return { projectId: project.id, copyId: input.activity.copyId };
      }),
    registerCopy: () => Effect.die("unused"),
    publishAttachments: () => Effect.die("unused"),
    ingest: () => Effect.die("unused"),
  });
  const serviceLayer = Activity.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Publisher.LibraryPublisher, publisher),
        Layer.succeed(
          WorkspaceStore.LibraryWorkspaceStore,
          partial<WorkspaceStore.LibraryWorkspaceStore["Service"]>({
            receipts: Effect.succeed([receipt]),
            bindings: Effect.succeed([]),
          }),
        ),
        Layer.succeed(Activity.LibraryActivitySource, {
          completions: () => Ref.get(completions),
        }),
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
      ),
    ),
  );
  /** A fresh service over the same database, as after the computer restarts. */
  const start = Activity.LibraryActivityPublication.pipe(Effect.provide(Layer.fresh(serviceLayer)));
  const journal = sql`INSERT INTO fork_library_source_state (key,journal_id,environment_id,authority_id,authority_epoch,scan_sequence) VALUES ('host','journal',${source},'authority',1,0)`;
  const pending = sql<{
    count: number;
  }>`SELECT COUNT(*) AS count FROM fork_library_source_activity WHERE acknowledged=0`.pipe(
    Effect.map((rows) => rows[0]!.count),
  );
  return { start, journal, pending, completions, features, offline, sent, recorded };
});
const run = <A, E>(
  use: (
    state: Effect.Success<typeof fixture>,
  ) => Effect.Effect<A, E, SqlClient.SqlClient | Crypto.Crypto>,
) =>
  Effect.gen(function* () {
    return yield* use(yield* fixture);
  }).pipe(
    Effect.provideService(ServerActivation, Effect.never),
    Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
    Effect.scoped,
  );

describe("Library timeline activity publication", () => {
  it.effect("publishes finished work in a copy once, retrying while the Library is offline", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* f.journal;
        yield* Ref.set(f.offline, true);
        const service = yield* f.start;
        expect((yield* service.report.pipe(Effect.flip)).reason).toBe("io");
        // An offline Library stops the batch at its first attempt and keeps everything queued.
        expect(yield* Ref.get(f.sent)).toHaveLength(1);
        expect(yield* f.pending).toBe(2);

        // The computer restarts, and by then its sources no longer list the work.
        yield* Ref.set(f.completions, []);
        yield* Ref.set(f.offline, false);
        const restarted = yield* f.start;
        yield* restarted.report;
        expect(yield* f.pending).toBe(0);
        const recorded = [...(yield* Ref.get(f.recorded)).values()];
        expect(recorded.map((request) => request.activity)).toEqual([
          {
            id: scheduled.id,
            copyId: copy.id,
            at: scheduled.at,
            kind: "scheduled-run",
            run: scheduled.work.kind === "scheduled-run" ? scheduled.work.run : null,
          },
          {
            id: job.id,
            copyId: copy.id,
            at: job.at,
            kind: "mini-job",
            job: job.work.kind === "mini-job" ? job.work.job : null,
          },
        ]);
        expect(recorded[0]).toMatchObject({
          environmentId: source,
          authorityId: "authority",
          authorityEpoch: 1,
        });
        // The retry reused the first attempt's request id, so a Library that did record it
        // before the response was lost keeps one entry.
        const [first, ...rest] = yield* Ref.get(f.sent);
        expect(first!.requestId).toMatch(/^journal:activity:[a-f0-9]{32}$/);
        expect(rest[0]!.requestId).toBe(first!.requestId);

        // Seeing the same completions again sends nothing.
        yield* Ref.set(f.completions, [scheduled, job]);
        const sentBefore = (yield* Ref.get(f.sent)).length;
        yield* restarted.report;
        expect(yield* Ref.get(f.sent)).toHaveLength(sentBefore);
      }),
    ),
  );

  it.effect("waits for a Library that records activity and for the history fence", () =>
    run((f) =>
      Effect.gen(function* () {
        const service = yield* f.start;
        // No journal yet: history replication has not established the fence.
        yield* service.report;
        expect(yield* Ref.get(f.sent)).toEqual([]);
        expect(yield* f.pending).toBe(2);

        // A Library deployed before this feature does not advertise it.
        yield* f.journal;
        yield* Ref.set(f.features, []);
        yield* service.report;
        expect(yield* Ref.get(f.sent)).toEqual([]);

        yield* Ref.set(f.features, [LIBRARY_TIMELINE_ACTIVITY_FEATURE]);
        yield* service.report;
        expect(yield* f.pending).toBe(0);
        expect((yield* Ref.get(f.recorded)).size).toBe(2);
      }),
    ),
  );
});

describe("activityCopy", () => {
  const otherCopy = {
    ...receipt,
    copy: {
      ...copy,
      id: "other-copy",
      repositories: [
        { ...copy.repositories[0]!, localProjectId: ProjectId.make("other-local-project") },
      ],
    },
  };
  const threadId = ThreadId.make("bound-thread");
  it("prefers the copy a thread is bound to, then the copy holding its project", () => {
    const binding = {
      threadId,
      resolved: { binding: { workingCopyId: "other-copy" } },
    };
    expect(
      Activity.activityCopy({ threadId, localProjectId }, [receipt, otherCopy], [binding]),
    ).toBe("other-copy");
    expect(
      Activity.activityCopy({ threadId: null, localProjectId }, [receipt, otherCopy], [binding]),
    ).toBe(copy.id);
    // A thread bound to a copy this computer no longer holds reports nowhere.
    expect(Activity.activityCopy({ threadId, localProjectId }, [receipt], [binding])).toBeNull();
    expect(
      Activity.activityCopy({ threadId: null, localProjectId: null }, [receipt], []),
    ).toBeNull();
  });
});

describe("activity source", () => {
  it.effect("reads finished scheduled runs and Mini jobs without prompts or command lines", () =>
    Effect.gen(function* () {
      yield* createScheduledTasks;
      const sql = yield* SqlClient.SqlClient;
      const task = (id: string, status: string, updatedAt: string) =>
        sql`INSERT INTO scheduled_tasks (task_id,title,prompt,enabled,schedule_json,project_id,thread_id,workspace_strategy_json,model_selection_json,runtime_mode,interaction_mode,created_by,creation_source,created_at,updated_at,next_run_at,last_run_at,last_run_status,last_run_error,run_count) VALUES (${id},'  Nightly checks  ','Secret prompt text',1,'{}',${localProjectId},NULL,'{}','{}','full-access','default','user','web','2026-10-16T00:00:00.000Z',${updatedAt},NULL,'2026-10-16T10:00:00.000Z',${status},'Error with details',1)`;
      yield* task("done", "failed", "2026-10-16T10:03:00.000Z");
      yield* task("running", "running", "2026-10-16T10:03:00.000Z");
      yield* task("old", "succeeded", "2026-10-01T00:00:00.000Z");
      const miniThread = ThreadId.make("mini-thread");
      const miniReceipt: MiniReceipt = {
        request: {
          threadId: miniThread,
          workerId: "studio",
          requestId: "0123456789abcdef0123456789abcdef",
          label: "Unit tests",
          argv: ["npm", "test", "--token=secret"],
          memoryMiB: 1024,
          cpuPercent: 100,
          timeoutSeconds: 600,
          committedOnly: true,
        },
        workerName: "studio",
        sourceRevision: "abc",
        archiveSha256: "def",
        archiveBytes: 1,
        localEditsExcluded: false,
        createdAt: "2026-10-16T10:00:00.000Z",
        state: "submitted",
        job: {
          id: "0123456789abcdef0123456789abcdef",
          state: "failed",
          label: "Unit tests",
          exit_code: 2,
          reason: "\n  Tests failed in api  \nstack trace follows",
        },
      };
      const source = yield* Activity.LibraryActivitySource.pipe(
        Effect.provide(
          Activity.layerSource.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  MiniOffload.MiniOffloadService,
                  partial<MiniOffload.MiniOffloadService["Service"]>({
                    finished: () =>
                      Effect.succeed([
                        { receipt: miniReceipt, recordedAt: "2026-10-16T10:05:00.000Z" },
                      ]),
                  }),
                ),
                Layer.succeed(
                  ProjectionStore.ProjectionStoreV2,
                  partial<ProjectionStore.ProjectionStoreV2["Service"]>({
                    getThread: () =>
                      Effect.succeed({ projectId: localProjectId } as OrchestrationV2AppThread),
                  }),
                ),
              ),
            ),
          ),
        ),
      );
      const found = yield* source.completions(Date.parse("2026-10-16T00:00:00.000Z"));
      expect(found).toEqual([
        {
          id: "scheduled:done:2026-10-16T10:00:00.000Z",
          at: "2026-10-16T10:03:00.000Z",
          threadId: null,
          localProjectId,
          work: {
            kind: "scheduled-run",
            run: {
              taskId: "done",
              title: "Nightly checks",
              status: "failed",
              startedAt: "2026-10-16T10:00:00.000Z",
            },
          },
        },
        {
          id: "mini:0123456789abcdef0123456789abcdef",
          at: "2026-10-16T10:05:00.000Z",
          threadId: miniThread,
          localProjectId,
          work: {
            kind: "mini-job",
            job: {
              requestId: "0123456789abcdef0123456789abcdef",
              label: "Unit tests",
              workerName: "studio",
              status: "failed",
              exitCode: 2,
              summary: "Tests failed in api",
            },
          },
        },
      ]);
      expect(JSON.stringify(found)).not.toMatch(/Secret prompt|token=secret|Error with details/);
    }).pipe(
      Effect.provide(layerMemory.pipe(Layer.provideMerge(NodeServices.layer))),
      Effect.scoped,
    ),
  );
});
