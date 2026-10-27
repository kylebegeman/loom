import * as Context from "effect/Context";
import * as Queue from "effect/Queue";
import * as Tracer from "effect/Tracer";
import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, type Project, ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess"; // fork: file-placement
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { TestClock } from "effect/testing";
import * as SqlClient from "effect/sql/SqlClient";
import * as FileSystem from "effect/FileSystem";

import * as ServerConfig from "../config.ts";
// fork: file-placement
import { lifecycleDefaults } from "../fork/project-lifecycle/lanesRoots.ts"; // fork: file-placement
import { ProjectLifecycleMigrations } from "../fork/project-lifecycle/migrations.ts"; // fork: file-placement
import { makeStore as makeLifecycleStore } from "../fork/project-lifecycle/store.ts"; // fork: file-placement
import { runForkMigrationSet } from "../fork/persistence/migrations.ts"; // fork: file-placement
import { copyFor } from "../fork/project-library/Library.testkit.ts";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";
import {
  orchestrationCommandDuration,
  orchestrationCommandsTotal,
} from "../observability/Metrics.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as LegacyV1ThreadImporter from "../orchestration-v2/legacy/LegacyV1ThreadImporter.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  markManagedProjectCheckout,
  readManagedProjectCheckout, // fork: file-placement
} from "../workspace/ManagedProjectCheckout.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectPlacement from "./ProjectPlacement.ts"; // fork: file-placement
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";
import { buildRepositoryIdentity } from "./RepositoryIdentityResolver.ts";

const layerWorkspacePaths = Layer.succeed(WorkspacePaths.WorkspacePaths, {
  normalizeWorkspaceRoot: (workspaceRoot) => Effect.succeed(workspaceRoot.replace(/\/$/, "")),
  resolveRelativePathWithinRoot: ({ workspaceRoot, relativePath }) =>
    Effect.succeed({ absolutePath: `${workspaceRoot}/${relativePath}`, relativePath }),
});

const layerMetadata = Layer.merge(
  Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
    resolve: (workspaceRoot) =>
      Effect.succeed({
        canonicalKey: `github.com/t3tools/${workspaceRoot.split("/").at(-1)}`,
        locator: {
          source: "git-remote" as const,
          remoteName: "origin",
          remoteUrl: `git@github.com:t3tools/${workspaceRoot.split("/").at(-1)}.git`,
        },
        rootPath: workspaceRoot,
      }),
  }),
  Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
    invalidate: () => Effect.void,
    resolvePath: (workspaceRoot) => Effect.succeed(`${workspaceRoot}/favicon.svg`),
  }),
);

class EnrichmentCompletions extends Context.Service<EnrichmentCompletions, Queue.Queue<void>>()(
  "t3/project/ProjectService.test/EnrichmentCompletions",
) {}

const layerEnrichmentCompletions = Layer.effectContext(
  Effect.gen(function* () {
    const completions = yield* Queue.unbounded<void>();
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (...args) => {
          end(...args);
          if (
            span.name === "ProjectEnrichmentService.resolveRepositoryIdentity" ||
            span.name === "ProjectEnrichmentService.resolveFavicon"
          ) {
            Queue.offerUnsafe(completions, undefined);
          }
        };
        return span;
      },
    });
    return Context.make(EnrichmentCompletions, completions).pipe(
      Context.add(Tracer.Tracer, tracer),
    );
  }),
);

const layerTestFor = (
  projectMetadataLayer: Layer.Layer<
    | ProjectFaviconResolver.ProjectFaviconResolver
    | RepositoryIdentityResolver.RepositoryIdentityResolver
  >,
) =>
  RuntimeLayer.layerProjectService.pipe(
    Layer.provideMerge(ProjectEnrichmentService.layer),
    Layer.provideMerge(layerWorkspacePaths),
    Layer.provideMerge(projectMetadataLayer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    // fork: file-placement: the default lanes folder lives under home and may hold the temp folder.
    Layer.provideMerge(
      Layer.effect(
        HostProcess.HomeDirectory,
        Effect.map(ServerConfig.ServerConfig, (config) => config.baseDir),
      ),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-service-test-" })), // fork: file-placement
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(layerEnrichmentCompletions),
  );

const layerTest = layerTestFor(layerMetadata);

const layerProjectServiceDependencies = Layer.mergeAll(
  RuntimeLayer.layerEventSink,
  ProjectStore.layer,
  ProjectionStore.layer,
  IdAllocator.layer,
  ThreadCommandExecutor.layer,
  Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({ receipts: Effect.succeed([]) }),
  Layer.mock(ProjectPlacement.ProjectPlacement)({}), // fork: file-placement
).pipe(
  Layer.provideMerge(LegacyV1ThreadImporter.layer.pipe(Layer.provide(RuntimeLayer.layerEventSink))),
  Layer.provideMerge(ProjectEnrichmentService.layer),
  Layer.provideMerge(layerWorkspacePaths),
  Layer.provideMerge(layerMetadata),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "project-service-race-" })), // fork: file-placement
  Layer.provideMerge(NodeServices.layer),
);

const waitForProject = Effect.fn("ProjectServiceTest.waitForProject")(function* (
  service: ProjectService.ProjectService["Service"],
  projectId: ProjectId,
  predicate: (project: Project) => boolean,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const completions = yield* EnrichmentCompletions;
      for (;;) {
        const project = Option.getOrThrow(yield* service.getById(projectId));
        if (predicate(project)) return project;
        yield* Queue.take(completions);
      }
    }),
  );
});

it.layer(layerTest)("ProjectService", (it) => {
  it.effect("creates, updates, resolves, snapshots, and soft-deletes projects", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("project:service-test");
      const modelSelection = {
        instanceId: ProviderInstanceId.make("codex_custom"),
        model: "gpt-5.1-codex",
      } as const;
      yield* TestClock.setTime(Date.parse("2026-06-20T10:00:00.000Z"));

      const created = yield* service.create({
        commandId: CommandId.make("command:project:create"),
        projectId,
        title: "Project",
        workspaceRoot: "/work/project/",
        defaultModelSelection: modelSelection,
        scripts: [
          {
            id: "setup",
            name: "Setup",
            command: "vp install",
            icon: "configure",
            runOnWorktreeCreate: true,
          },
        ],
      });
      assert.equal(created.workspaceRoot, "/work/project");
      assert.isNull(created.repositoryIdentity);
      assert.isNull(created.faviconPath);

      const hydratedCreated = yield* waitForProject(
        service,
        projectId,
        (project) => project.repositoryIdentity !== null && project.faviconPath !== null,
      );
      assert.equal(hydratedCreated?.repositoryIdentity?.canonicalKey, "github.com/t3tools/project");
      assert.equal(hydratedCreated?.faviconPath, "/work/project/favicon.svg");

      const updated = yield* service.update({
        commandId: CommandId.make("command:project:update"),
        projectId,
        title: "Renamed",
        autoPull: true,
        projectIcon: { kind: "emoji", emoji: "🦊" },
        faviconPath: "/work/project/custom.svg",
        defaultThreadEnvMode: "worktree",
      });
      assert.equal(updated.title, "Renamed");
      assert.equal(updated.createdAt, created.createdAt);
      assert.isTrue(updated.autoPull);
      assert.deepEqual(updated.projectIcon, { kind: "emoji", emoji: "🦊" });
      assert.equal(updated.faviconPath, "/work/project/custom.svg");
      assert.equal(updated.defaultThreadEnvMode, "worktree");

      const byId = yield* service.getById(projectId);
      const byWorkspace = yield* service.getByWorkspaceRoot("/work/project/");
      assert.isTrue(Option.isSome(byId));
      assert.isTrue(Option.isSome(byWorkspace));
      assert.equal(Option.getOrThrow(byWorkspace).id, projectId);
      assert.isTrue(Option.getOrThrow(byId).autoPull);
      assert.deepEqual(Option.getOrThrow(byId).projectIcon, updated.projectIcon);
      assert.equal(Option.getOrThrow(byId).faviconPath, updated.faviconPath);
      assert.equal(Option.getOrThrow(byId).defaultThreadEnvMode, "worktree");
      const reset = yield* service.update({
        commandId: CommandId.make("command:project:reset-appearance"),
        projectId,
        autoPull: false,
        projectIcon: null,
        faviconPath: null,
        defaultThreadEnvMode: null,
      });
      assert.isFalse(reset.autoPull);
      assert.isNull(reset.projectIcon);
      assert.equal(reset.faviconPath, hydratedCreated.faviconPath);
      assert.isNull(reset.defaultThreadEnvMode);
      assert.deepEqual(
        (yield* service.snapshot).projects.map((project) => project.id),
        [projectId],
      );

      const deleted = yield* service.delete({
        commandId: CommandId.make("command:project:delete"),
        projectId,
      });
      assert.isNotNull(deleted.deletedAt);
      assert.isTrue(Option.isNone(yield* service.getById(projectId)));
      assert.isTrue(Option.isSome(yield* service.getById(projectId, { includeDeleted: true })));
      assert.deepEqual((yield* service.snapshot).projects, []);

      const sql = yield* SqlClient.SqlClient;
      const changes = yield* sql<{ readonly event_type: string }>`
        SELECT event_type
        FROM orchestration_events
        WHERE aggregate_kind = 'project' AND stream_id = ${projectId}
        ORDER BY sequence ASC
      `;
      assert.deepEqual(
        changes.map((change) => change.event_type),
        ["project.created", "project.meta-updated", "project.meta-updated", "project.deleted"],
      );
    }),
  );

  it.effect("records the outcome and duration of a committed project command", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const successes = Metric.value(
        Metric.withAttributes(orchestrationCommandsTotal, {
          commandType: "project.create",
          outcome: "success",
        }),
      );
      const durations = Metric.value(
        Metric.withAttributes(orchestrationCommandDuration, { commandType: "project.create" }),
      );
      const successesBefore = (yield* successes).count;
      const durationsBefore = (yield* durations).count;

      yield* service.create({
        commandId: CommandId.make("command:metrics:create"),
        projectId: ProjectId.make("project:metrics"),
        title: "Metrics",
        workspaceRoot: "/work/metrics",
      });

      assert.strictEqual((yield* successes).count - successesBefore, 1);
      assert.strictEqual((yield* durations).count - durationsBefore, 1);
    }),
  );

  it.effect("auto-bootstraps a workspace exactly once", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      yield* TestClock.setTime(Date.parse("2026-06-20T10:00:00.000Z"));
      const input = {
        commandId: CommandId.make("command:bootstrap:first"),
        projectId: ProjectId.make("project:bootstrap"),
        title: "Bootstrap",
        workspaceRoot: "/work/bootstrap/",
      };
      const first = yield* service.bootstrap(input);
      const second = yield* service.bootstrap({
        ...input,
        commandId: CommandId.make("command:bootstrap:second"),
        projectId: ProjectId.make("project:bootstrap:unused"),
      });
      assert.isTrue(first.created);
      assert.isFalse(second.created);
      assert.equal(second.project.id, first.project.id);
    }),
  );

  it.effect("commits the event, the row and the receipt together, once per command id", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:retry");
      const input = {
        commandId: CommandId.make("command:retry:create"),
        projectId,
        title: "Retry",
        workspaceRoot: "/work/retry",
      };
      const first = yield* service.create(input);
      const retried = yield* service.create(input);
      assert.deepEqual(retried, first);
      const updateInput = {
        commandId: CommandId.make("command:retry:update"),
        projectId,
        autoPull: true,
      };
      yield* service.update(updateInput);
      yield* service.update(updateInput);

      const committed = yield* sql<{
        readonly sequence: number;
        readonly event_type: string;
        readonly receipt_sequence: number;
        readonly status: string;
        readonly aggregate_kind: string;
      }>`
        SELECT events.sequence, events.event_type,
          receipts.result_sequence AS receipt_sequence, receipts.status, receipts.aggregate_kind
        FROM orchestration_events AS events
        JOIN orchestration_command_receipts AS receipts ON receipts.command_id = events.command_id
        WHERE events.stream_id = ${projectId}
        ORDER BY events.sequence
      `;
      assert.deepEqual(
        committed.map((row) => [row.event_type, row.status, row.aggregate_kind]),
        [
          ["project.created", "accepted", "project"],
          ["project.meta-updated", "accepted", "project"],
        ],
      );
      for (const row of committed) assert.equal(row.receipt_sequence, row.sequence);
      assert.isTrue(Option.getOrThrow(yield* service.getById(projectId)).autoPull);
    }),
  );

  it.effect("replays a rejected receipt instead of re-planning the command", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:rejected");
      yield* service.create({
        commandId: CommandId.make("command:rejected:create"),
        projectId,
        title: "Rejected",
        workspaceRoot: "/work/rejected",
      });
      const invalid = {
        commandId: CommandId.make("command:rejected:script"),
        projectId,
        scripts: [
          {
            id: "Not.Valid",
            name: "Invalid",
            command: "true",
            icon: "play" as const,
            runOnWorktreeCreate: false,
          },
        ],
      };
      const first = yield* service.update(invalid).pipe(Effect.flip);
      assert.equal(first._tag, "ProjectOperationError");
      const replayed = yield* service
        .update({ ...invalid, scripts: [{ ...invalid.scripts[0]!, id: "valid" }] })
        .pipe(Effect.flip);
      assert.equal(replayed._tag, "ProjectOperationError");
      assert.include(
        String(replayed._tag === "ProjectOperationError" && replayed.cause),
        "Script ID",
      );
      const receipts = yield* sql<{ readonly status: string; readonly aggregate_id: string }>`
        SELECT status, aggregate_id FROM orchestration_command_receipts
        WHERE command_id = ${invalid.commandId}
      `;
      assert.deepEqual(receipts, [{ status: "rejected", aggregate_id: projectId }]);
      const events = yield* sql`
        SELECT sequence FROM orchestration_events WHERE command_id = ${invalid.commandId}
      `;
      assert.deepEqual(events, []);
      assert.deepEqual(Option.getOrThrow(yield* service.getById(projectId)).scripts, []);
    }),
  );

  it.effect("rejects a workspace another active project holds", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const other = ProjectId.make("project:conflict:mover");
      yield* service.create({
        commandId: CommandId.make("command:conflict:holder"),
        projectId: ProjectId.make("project:conflict:holder"),
        title: "Holder",
        workspaceRoot: "/work/conflict",
      });
      yield* service.create({
        commandId: CommandId.make("command:conflict:mover"),
        projectId: other,
        title: "Mover",
        workspaceRoot: "/work/conflict-mover",
      });
      const move = yield* service
        .update({
          commandId: CommandId.make("command:conflict:move"),
          projectId: other,
          workspaceRoot: "/work/conflict",
        })
        .pipe(Effect.flip);
      assert.equal(move._tag, "ProjectConflictError");
      assert.equal(
        Option.getOrThrow(yield* service.getById(other)).workspaceRoot,
        "/work/conflict-mover",
      );
    }),
  );

  it.effect("replays a workspace conflict after the workspace frees up", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const holderId = ProjectId.make("project:freed:holder");
      yield* service.create({
        commandId: CommandId.make("command:freed:holder"),
        projectId: holderId,
        title: "Holder",
        workspaceRoot: "/work/freed",
      });
      const claim = {
        commandId: CommandId.make("command:freed:claim"),
        projectId: ProjectId.make("project:freed:claim"),
        title: "Claim",
        workspaceRoot: "/work/freed",
      };
      const first = yield* service.create(claim).pipe(Effect.flip);
      yield* service.delete({
        commandId: CommandId.make("command:freed:delete"),
        projectId: holderId,
      });
      const replayed = yield* service.create(claim).pipe(Effect.flip);
      assert.deepEqual(replayed, first);
      assert.instanceOf(replayed, ProjectService.ProjectConflictError);
      assert.isTrue(
        Option.isNone(yield* service.getById(claim.projectId, { includeDeleted: true })),
      );
    }),
  );

  it.effect("returns the deleted project when a completed delete is retried", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:delete-retry");
      yield* service.create({
        commandId: CommandId.make("command:delete-retry:create"),
        projectId,
        title: "Delete retry",
        workspaceRoot: "/work/delete-retry",
      });
      const input = { commandId: CommandId.make("command:delete-retry:delete"), projectId };
      const deleted = yield* service.delete(input);
      assert.deepEqual(yield* service.delete(input), deleted);
      const events = yield* sql<{ readonly command_id: string }>`
        SELECT command_id FROM orchestration_events
        WHERE stream_id = ${projectId} AND event_type = 'project.deleted'
      `;
      assert.deepEqual(events, [{ command_id: input.commandId }]);
    }),
  );

  it.effect("treats a deleted project as missing for updates and new deletes", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:deleted-target");
      yield* service.create({
        commandId: CommandId.make("command:deleted-target:create"),
        projectId,
        title: "Deleted target",
        workspaceRoot: "/work/deleted-target",
      });
      yield* service.delete({
        commandId: CommandId.make("command:deleted-target:delete"),
        projectId,
      });
      const again = yield* service
        .delete({ commandId: CommandId.make("command:deleted-target:delete-again"), projectId })
        .pipe(Effect.flip);
      assert.instanceOf(again, ProjectService.ProjectNotFoundError);
      const events = yield* sql<{ readonly event_type: string }>`
        SELECT event_type FROM orchestration_events
        WHERE stream_id = ${projectId} ORDER BY sequence ASC
      `;
      assert.deepEqual(
        events.map((event) => event.event_type),
        ["project.created", "project.deleted"],
      );
    }),
  );

  it.effect("rolls back the event and receipt when the row write fails", () =>
    Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const sql = yield* SqlClient.SqlClient;
      const projectId = ProjectId.make("project:atomic");
      yield* sql`
        CREATE TRIGGER fail_project_row BEFORE INSERT ON projection_projects
        WHEN NEW.project_id = 'project:atomic'
        BEGIN SELECT RAISE(ABORT, 'injected row failure'); END
      `;
      const input = {
        commandId: CommandId.make("command:atomic:create"),
        projectId,
        title: "Atomic",
        workspaceRoot: "/work/atomic",
      };
      const failure = yield* service.create(input).pipe(Effect.flip);
      assert.equal(failure._tag, "ProjectOperationError");
      const leftovers = yield* sql<{ readonly count: number }>`
        SELECT
          (SELECT COUNT(*) FROM orchestration_events WHERE command_id = ${input.commandId}) +
          (SELECT COUNT(*) FROM orchestration_command_receipts WHERE command_id = ${input.commandId}) +
          (SELECT COUNT(*) FROM projection_projects WHERE project_id = ${projectId}) AS count
      `;
      assert.equal(leftovers[0]?.count, 0);
      yield* sql`DROP TRIGGER fail_project_row`;
      assert.equal((yield* service.create(input)).id, projectId);
    }),
  );
});

it.effect("keeps project snapshots available when optional metadata enrichment fails", () =>
  Effect.gen(function* () {
    const layerFailingMetadata = Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: (workspaceRoot) =>
          Effect.fail(
            new ProjectFaviconResolver.ProjectFaviconResolutionError({
              operation: "stat-candidate",
              workspaceRoot,
              cause: "permission denied",
            }),
          ),
      }),
    );

    yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("project:failed-enrichment");
      yield* service.create({
        commandId: CommandId.make("command:failed-enrichment:create"),
        projectId,
        title: "Still visible",
        workspaceRoot: "/work/failed-enrichment",
      });

      const snapshot = yield* service.snapshot;
      assert.equal(snapshot.projects.length, 1);
      assert.equal(snapshot.projects[0]?.id, projectId);
      assert.equal(snapshot.projects[0]?.title, "Still visible");
      assert.isNull(snapshot.projects[0]?.repositoryIdentity ?? null);
      assert.isNull(snapshot.projects[0]?.faviconPath ?? null);
    }).pipe(Effect.provide(layerTestFor(layerFailingMetadata)));
  }),
);

it.effect("invalidates workspace-derived metadata when a project moves", () =>
  Effect.gen(function* () {
    const metadataVersion = yield* Ref.make(1);
    const layerVersionedMetadata = Layer.merge(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: (workspaceRoot) =>
          Ref.get(metadataVersion).pipe(
            Effect.map((version) => ({
              canonicalKey: `example.test/v${version}${workspaceRoot}`,
              locator: {
                source: "git-remote" as const,
                remoteName: "origin",
                remoteUrl: `https://example.test/v${version}${workspaceRoot}.git`,
              },
              rootPath: workspaceRoot,
            })),
          ),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: (workspaceRoot) =>
          Ref.get(metadataVersion).pipe(
            Effect.map((version) => `${workspaceRoot}/favicon-v${version}.svg`),
          ),
      }),
    );

    yield* Effect.gen(function* () {
      const service = yield* ProjectService.ProjectService;
      const projectId = ProjectId.make("project:moved-enrichment");
      yield* service.create({
        commandId: CommandId.make("command:moved-enrichment:create"),
        projectId,
        title: "Moved",
        workspaceRoot: "/work/original",
      });
      assert.equal(
        (yield* waitForProject(
          service,
          projectId,
          (project) => project.faviconPath === "/work/original/favicon-v1.svg",
        )).faviconPath,
        "/work/original/favicon-v1.svg",
      );

      yield* Ref.set(metadataVersion, 2);
      yield* service.update({
        commandId: CommandId.make("command:moved-enrichment:away"),
        projectId,
        workspaceRoot: "/work/temporary",
      });
      yield* service.snapshot;

      yield* Ref.set(metadataVersion, 3);
      yield* service.update({
        commandId: CommandId.make("command:moved-enrichment:return"),
        projectId,
        workspaceRoot: "/work/original",
      });
      assert.equal(
        (yield* waitForProject(
          service,
          projectId,
          (project) => project.faviconPath === "/work/original/favicon-v3.svg",
        )).faviconPath,
        "/work/original/favicon-v3.svg",
      );
    }).pipe(Effect.provide(layerTestFor(layerVersionedMetadata)));
  }),
);

it.effect("serializes two projects claiming the same workspace root", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const firstReachedCommit = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const gatedSink = EventSink.EventSinkV2.of({
      ...eventSink,
      commitProjectCommand: (input) =>
        input.projectId === "project:race:first"
          ? Deferred.succeed(firstReachedCommit, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirst)),
              Effect.andThen(eventSink.commitProjectCommand(input)),
            )
          : eventSink.commitProjectCommand(input),
    });
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(EventSink.EventSinkV2, gatedSink),
    );
    const claim = (name: string) =>
      service.create({
        commandId: CommandId.make(`command:race:${name}`),
        projectId: ProjectId.make(`project:race:${name}`),
        title: name,
        workspaceRoot: "/work/race",
      });
    const first = yield* claim("first").pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(firstReachedCommit);
    const second = yield* claim("second").pipe(
      Effect.flip,
      Effect.forkChild({ startImmediately: true }),
    );
    yield* Effect.yieldNow;
    assert.isUndefined(second.pollUnsafe());
    yield* Deferred.succeed(releaseFirst, undefined);
    assert.equal((yield* Fiber.join(first)).id, "project:race:first");
    assert.equal((yield* Fiber.join(second))._tag, "ProjectConflictError");
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);

// fork: file-placement
it.effect("rejects a macOS workspace another project names in another case or Unicode form", () =>
  Effect.gen(function* () {
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(HostProcess.Platform, "darwin"),
    );
    const holder = yield* service.create({
      commandId: CommandId.make("command:spelled:holder"),
      projectId: ProjectId.make("project:spelled:holder"),
      title: "Holder",
      workspaceRoot: "/Users/k/Projects/Café",
    });
    const claim = yield* service
      .create({
        commandId: CommandId.make("command:spelled:claim"),
        projectId: ProjectId.make("project:spelled:claim"),
        title: "Claim",
        workspaceRoot: "/Users/k/projects/café",
      })
      .pipe(Effect.flip);
    assert.instanceOf(claim, ProjectService.ProjectConflictError);
    assert.equal(claim.conflictingProjectId, holder.id);
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);

it.effect("rejects an update that waited on the lock while its project was deleted", () =>
  Effect.gen(function* () {
    const eventSink = yield* EventSink.EventSinkV2;
    const deleteReachedCommit = yield* Deferred.make<void>();
    const releaseDelete = yield* Deferred.make<void>();
    const gatedSink = EventSink.EventSinkV2.of({
      ...eventSink,
      commitProjectCommand: (input) =>
        input.commandType === "project.delete"
          ? Deferred.succeed(deleteReachedCommit, undefined).pipe(
              Effect.andThen(Deferred.await(releaseDelete)),
              Effect.andThen(eventSink.commitProjectCommand(input)),
            )
          : eventSink.commitProjectCommand(input),
    });
    const service = yield* ProjectService.make.pipe(
      Effect.provideService(EventSink.EventSinkV2, gatedSink),
    );
    const sql = yield* SqlClient.SqlClient;
    const projectId = ProjectId.make("project:update-race");
    yield* service.create({
      commandId: CommandId.make("command:update-race:create"),
      projectId,
      title: "Update race",
      workspaceRoot: "/work/update-race",
    });
    const deletion = yield* service
      .delete({ commandId: CommandId.make("command:update-race:delete"), projectId })
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(deleteReachedCommit);
    const updateCommandId = CommandId.make("command:update-race:update");
    const update = yield* service
      .update({ commandId: updateCommandId, projectId, title: "Too late" })
      .pipe(Effect.flip, Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;
    yield* Deferred.succeed(releaseDelete, undefined);
    assert.isNotNull((yield* Fiber.join(deletion)).deletedAt);
    assert.instanceOf(yield* Fiber.join(update), ProjectService.ProjectNotFoundError);
    const receipts = yield* sql<{ readonly status: string }>`
      SELECT status FROM orchestration_command_receipts WHERE command_id = ${updateCommandId}
    `;
    assert.deepEqual(receipts, [{ status: "rejected" }]);
    const events = yield* sql<{ readonly event_type: string }>`
      SELECT event_type FROM orchestration_events
      WHERE stream_id = ${projectId} ORDER BY sequence ASC
    `;
    assert.deepEqual(
      events.map((event) => event.event_type),
      ["project.created", "project.deleted"],
    );
    assert.equal(
      Option.getOrThrow(yield* service.getById(projectId, { includeDeleted: true })).title,
      "Update race",
    );
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);

const libraryReceipt = (rootPath: string): LibraryWorkspaceStore.WorkspaceReceipt => {
  const project = {
    id: "library-project",
    title: "Library project",
    brief: "",
    revision: 1,
    resources: [],
    archived: false,
    createdAt: "2026-10-15T00:00:00.000Z",
    updatedAt: "2026-10-15T00:00:00.000Z",
  };
  return {
    requestId: "copy",
    fingerprint: "copy",
    project,
    copy: { ...copyFor(project), rootPath, repositories: [], ownership: "managed" },
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
};

it.effect("refuses to repoint a project whose folder the Library manages", () =>
  Effect.gen(function* () {
    const service = yield* ProjectService.make.pipe(
      Effect.provide(
        Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({
          receipts: Effect.succeed([libraryReceipt("/work/library-copy")]),
        }),
      ),
    );
    const projectId = ProjectId.make("project:library-root");
    yield* service.create({
      commandId: CommandId.make("command:library-root:create"),
      projectId,
      title: "Library copy",
      workspaceRoot: "/work/library-copy",
    });
    const refused = yield* service
      .update({
        commandId: CommandId.make("command:library-root:move"),
        projectId,
        workspaceRoot: "/work/elsewhere",
      })
      .pipe(Effect.flip);
    assert.equal(refused._tag, "ProjectLocationManagedError");
    const renamed = yield* service.update({
      commandId: CommandId.make("command:library-root:rename"),
      projectId,
      title: "Renamed",
    });
    assert.deepEqual([renamed.title, renamed.workspaceRoot], ["Renamed", "/work/library-copy"]);
  }).pipe(Effect.provide(layerProjectServiceDependencies)),
);

it.effect("refuses to repoint a project in a folder Loom cloned and manages", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "project-service-managed-" }),
    );
    const workspaceRoot = `${root}/app`;
    yield* fs.makeDirectory(`${workspaceRoot}/.git`, { recursive: true });
    yield* markManagedProjectCheckout(
      workspaceRoot,
      buildRepositoryIdentity({
        rootPath: workspaceRoot,
        remoteName: "origin",
        remoteUrl: "https://github.com/example/app.git",
        originUrl: "https://github.com/example/app.git",
      }),
    );
    const service = yield* ProjectService.ProjectService;
    const projectId = ProjectId.make("project:managed-root");
    yield* service.create({
      commandId: CommandId.make("command:managed-root:create"),
      projectId,
      title: "Managed",
      workspaceRoot,
    });
    const refused = yield* service
      .update({
        commandId: CommandId.make("command:managed-root:move"),
        projectId,
        workspaceRoot: `${root}/elsewhere`,
      })
      .pipe(Effect.flip);
    assert.equal(refused._tag, "ProjectLocationManagedError");
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

// fork: file-placement
it.effect("lets a managed project follow a folder moved by hand, taking its receipt along", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "project-service-moved-" }),
    );
    const workspaceRoot = `${root}/app`;
    const movedRoot = `${root}/renamed`;
    yield* fs.makeDirectory(`${workspaceRoot}/.git`, { recursive: true });
    yield* markManagedProjectCheckout(
      workspaceRoot,
      buildRepositoryIdentity({
        rootPath: workspaceRoot,
        remoteName: "origin",
        remoteUrl: "https://github.com/example/app.git",
        originUrl: "https://github.com/example/app.git",
      }),
    );
    const service = yield* ProjectService.ProjectService;
    const projectId = ProjectId.make("project:moved-root");
    yield* service.create({
      commandId: CommandId.make("command:moved-root:create"),
      projectId,
      title: "Moved",
      workspaceRoot,
    });
    yield* fs.rename(workspaceRoot, movedRoot);
    const moved = yield* service.update({
      commandId: CommandId.make("command:moved-root:move"),
      projectId,
      workspaceRoot: movedRoot,
    });
    assert.equal(moved.workspaceRoot, movedRoot);
    assert.equal((yield* readManagedProjectCheckout(movedRoot))?.workspaceRoot, movedRoot);
    assert.isNull(yield* readManagedProjectCheckout(workspaceRoot));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

// fork: file-placement
it.effect("refuses to create or move a project into T3 home", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.realPath((yield* ServerConfig.ServerConfig).stateDir);
    const root = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "project-service-guarded-" }),
    );
    const service = yield* ProjectService.ProjectService;
    const created = yield* service
      .create({
        commandId: CommandId.make("command:guarded:create-inside"),
        projectId: ProjectId.make("project:guarded-inside"),
        title: "Inside",
        workspaceRoot: `${stateDir}/inside`,
        createWorkspaceRootIfMissing: true,
      })
      .pipe(Effect.flip);
    assert.equal(created._tag, "ProjectLocationManagedError");
    assert.isFalse(yield* fs.exists(`${stateDir}/inside`));

    const projectId = ProjectId.make("project:guarded");
    yield* service.create({
      commandId: CommandId.make("command:guarded:create"),
      projectId,
      title: "Guarded",
      workspaceRoot: root,
    });
    const moved = yield* service
      .update({
        commandId: CommandId.make("command:guarded:move"),
        projectId,
        workspaceRoot: `${stateDir}/worktrees`,
      })
      .pipe(Effect.flip);
    assert.equal(moved._tag, "ProjectLocationManagedError");
    assert.equal(Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot, root);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

// fork: file-placement
it.effect("refuses to create or move a project into the lanes folder", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "project-service-lanes-" }),
    );
    const lanesRoot = `${root}/lanes`;
    yield* runForkMigrationSet(ProjectLifecycleMigrations);
    const store = yield* makeLifecycleStore;
    yield* store.updateSettings({
      ...lifecycleDefaults(yield* ServerConfig.ServerConfig, root),
      lanesRoot,
    });
    const service = yield* ProjectService.ProjectService;
    const created = yield* service
      .create({
        commandId: CommandId.make("command:lanes:create-inside"),
        projectId: ProjectId.make("project:lanes-inside"),
        title: "Inside",
        workspaceRoot: `${lanesRoot}/app`,
        createWorkspaceRootIfMissing: true,
      })
      .pipe(Effect.flip);
    assert.equal(created._tag, "ProjectLocationManagedError");
    assert.isFalse(yield* fs.exists(`${lanesRoot}/app`));

    const projectId = ProjectId.make("project:lanes");
    const workspaceRoot = `${root}/app`;
    yield* fs.makeDirectory(workspaceRoot);
    yield* service.create({
      commandId: CommandId.make("command:lanes:create"),
      projectId,
      title: "Outside",
      workspaceRoot,
    });
    const moved = yield* service
      .update({
        commandId: CommandId.make("command:lanes:move"),
        projectId,
        workspaceRoot: `${lanesRoot}/app`,
      })
      .pipe(Effect.flip);
    assert.equal(moved._tag, "ProjectLocationManagedError");
    assert.equal(Option.getOrThrow(yield* service.getById(projectId)).workspaceRoot, workspaceRoot);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);
