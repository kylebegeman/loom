import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, EventId } from "@t3tools/contracts";
import { type LibraryProject, type LibraryResolvedBinding } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as HistorySource from "./LibraryHistorySource.ts";
import * as WorkspaceStore from "./LibraryWorkspaceStore.ts";
import { source, threadId, localProjectId, resource, archiveFor } from "./Library.testkit.ts";

const project: LibraryProject = {
  id: "central-project",
  title: "AspectAvy",
  brief: "Work across the repositories.",
  revision: 2,
  resources: [resource],
  archived: false,
  createdAt: "2026-10-15T00:00:00.000Z",
  updatedAt: "2026-10-15T00:00:00.000Z",
};
const resolved: LibraryResolvedBinding = {
  cwd: "/workspace",
  localProjectId,
  repositoryPaths: ["/workspace/api"],
  binding: {
    projectId: project.id,
    projectRevision: project.revision,
    workingCopyId: "copy",
    environmentId: source,
    resourceIds: [resource.id],
  },
};
const run = <A, E, R>(
  use: (fixture: {
    service: HistorySource.LibraryHistorySource["Service"];
    restart: Effect.Effect<
      HistorySource.LibraryHistorySource["Service"],
      never,
      import("effect/Crypto").Crypto | ProjectionStore.ProjectionStoreV2
    >;
    binding: Ref.Ref<LibraryResolvedBinding | null>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const archive = yield* archiveFor(project);
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* projections.apply({
      id: EventId.make("thread-created"),
      threadId,
      type: "thread.created",
      payload: archive.projection.thread,
      occurredAt: archive.projection.updatedAt,
    });
    yield* projections.apply({
      id: EventId.make("message-created"),
      threadId,
      type: "message.updated",
      payload: archive.projection.messages[0]!,
      occurredAt: archive.projection.updatedAt,
    });
    const binding = yield* Ref.make<LibraryResolvedBinding | null>(resolved);
    const store = Layer.mock(WorkspaceStore.LibraryWorkspaceStore)({
      getBinding: () => Ref.get(binding),
      getBoundProject: () => Effect.succeed(project),
    });
    const serviceLayer = HistorySource.layer.pipe(
      Layer.provide(store),
      Layer.provide(
        Layer.succeed(ServerEnvironmentIdentity, { getEnvironmentId: Effect.succeed(source) }),
      ),
    );
    const restart = HistorySource.LibraryHistorySource.pipe(
      Effect.provide(Layer.fresh(serviceLayer)),
    );
    const service = yield* restart;
    return yield* use({ service, restart, binding });
  }).pipe(
    Effect.provide(Layer.merge(ProjectionStore.layerMemory, NodeServices.layer)),
    Effect.scoped,
  );

describe("execution host Library snapshots", () => {
  it.effect(
    "retains native identifiers, full body, bound context, and atomic event watermark",
    () =>
      run((f) =>
        Effect.gen(function* () {
          const snapshot = yield* f.service.snapshotThread({ threadId });
          expect(snapshot.summary).toMatchObject({
            projectId: project.id,
            projectRevision: 2,
            environmentId: source,
            threadId,
            localProjectId,
            workingCopyId: "copy",
            resourceIds: [resource.id],
            sequence: 2,
          });
          expect(snapshot.context).toEqual(project);
          expect(snapshot.projection.messages[0]?.text).toContain("complete conversation");
          expect(snapshot.projection.thread.projectId).toBe(localProjectId);
          const restarted = yield* f.restart;
          expect((yield* restarted.snapshotThread({ threadId })).summary.id).toBe(
            snapshot.summary.id,
          );
        }),
      ),
  );
  it.effect("refuses unbound legacy threads and mismatched host bindings", () =>
    run((f) =>
      Effect.gen(function* () {
        yield* Ref.set(f.binding, null);
        expect((yield* f.service.snapshotThread({ threadId }).pipe(Effect.flip)).reason).toBe(
          "not-found",
        );
        yield* Ref.set(f.binding, {
          ...resolved,
          binding: { ...resolved.binding, environmentId: EnvironmentId.make("different-host") },
        });
        expect((yield* f.service.snapshotThread({ threadId }).pipe(Effect.flip)).reason).toBe(
          "invalid",
        );
      }),
    ),
  );
});
