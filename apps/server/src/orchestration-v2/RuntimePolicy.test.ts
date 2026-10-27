import { assert, it } from "@effect/vitest";
import {
  type ModelSelection,
  type OrchestrationV2AppThread,
  ProjectId,
  ProviderInstanceId,
  type RuntimeMode,
  type ServerProvider,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

// fork: library-launch-files
import { LibraryError } from "@t3tools/contracts/fork";
import * as LibraryWorkspace from "../fork/project-library/LibraryWorkspace.ts";
import * as LibraryWorkspaceStore from "../fork/project-library/LibraryWorkspaceStore.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as RuntimePolicy from "./RuntimePolicy.ts";

const projectId = ProjectId.make("project:runtime-policy");
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = {
  instanceId: providerInstanceId,
  model: "gpt-5.5",
} satisfies ModelSelection;

function makeThread(input: {
  readonly now: DateTime.Utc;
  readonly worktreePath: string | null;
  readonly runtimeMode?: RuntimeMode;
}): OrchestrationV2AppThread {
  const threadId = ThreadId.make("thread:runtime-policy");
  return {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: "Runtime policy",
    providerInstanceId,
    modelSelection,
    runtimeMode: input.runtimeMode ?? "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: input.worktreePath,
    activeProviderThreadId: null,
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: input.now,
    updatedAt: input.now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

const grokInstanceId = ProviderInstanceId.make("grok");
const supportedRuntimeModesByInstance = new Map<ProviderInstanceId, ReadonlyArray<RuntimeMode>>([
  [grokInstanceId, ["approval-required", "auto", "full-access"]],
]);
const providerInstanceFor = (instanceId: ProviderInstanceId) =>
  ({
    snapshot: {
      getSnapshot: Effect.succeed({
        supportedRuntimeModes: supportedRuntimeModesByInstance.get(instanceId),
      } as ServerProvider),
    },
  }) as ProviderInstance;

const layerTest = RuntimePolicy.layerFromProjectStore.pipe(
  Layer.provide(
    Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
      getInstance: (instanceId) => Effect.succeed(providerInstanceFor(instanceId)),
      listInstances: Effect.succeed([]),
      listUnavailable: Effect.succeed([]),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.never,
    }),
  ),
  Layer.provide(
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () =>
        Effect.succeedSome({
          projectId,
          title: "Project",
          workspaceRoot: "/project-root",
          defaultModelSelection: null,
          defaultThreadEnvMode: null,
          autoPull: false,
          faviconPath: null,
          projectIcon: null,
          scripts: [],
          createdAt: "2026-06-21T00:00:00.000Z",
          updatedAt: "2026-06-21T00:00:00.000Z",
          deletedAt: null,
        }),
    }),
  ),
);

it.layer(layerTest)("RuntimePolicyV2", (it) => {
  it.effect("runs a mode the provider does not offer in Supervised", () =>
    Effect.gen(function* () {
      const policy = yield* RuntimePolicy.RuntimePolicyV2;
      const now = yield* DateTime.now;
      const modeFor = (instanceId: ProviderInstanceId, runtimeMode: RuntimeMode) =>
        policy
          .resolve({
            thread: makeThread({ now, worktreePath: null, runtimeMode }),
            modelSelection: { instanceId, model: "test-model" },
          })
          .pipe(Effect.map((resolved) => resolved.runtimeMode));

      assert.equal(yield* modeFor(grokInstanceId, "auto-accept-edits"), "approval-required");
      assert.equal(yield* modeFor(grokInstanceId, "auto"), "auto");
      assert.equal(yield* modeFor(grokInstanceId, "full-access"), "full-access");
      assert.equal(yield* modeFor(providerInstanceId, "auto-accept-edits"), "auto-accept-edits");
    }),
  );
});

// fork: library-launch-files
it.effect.each([false, true])(
  "restores Library files before validating cwd unless provider startup already prepared them (%s)",
  (prepared) =>
    Effect.gen(function* () {
      const order: string[] = [];
      const policy = yield* RuntimePolicy.RuntimePolicyV2.pipe(
        Effect.provide(
          Layer.fresh(layerTest).pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(LibraryWorkspace.LibraryWorkspace)({
                  prepareThreadFiles: () =>
                    Effect.sync(() => {
                      order.push("restore");
                    }),
                }),
                Layer.mock(LibraryWorkspaceStore.LibraryWorkspaceStore)({
                  validateThreadCwd: (input) =>
                    Effect.sync(() => {
                      order.push("validate");
                      return input.cwd;
                    }),
                }),
              ),
            ),
          ),
        ),
      );
      const now = yield* DateTime.now;
      const resolved = yield* policy.resolve({
        thread: makeThread({ now, worktreePath: null }),
        modelSelection,
        libraryFilesPrepared: prepared,
      });
      assert.equal(resolved.cwd, "/project-root");
      assert.deepEqual(order, prepared ? ["validate"] : ["restore", "validate"]);
    }),
);

it.effect("rejects a send before checkpoint preparation when Library recovery is unavailable", () =>
  Effect.gen(function* () {
    const policy = yield* RuntimePolicy.RuntimePolicyV2.pipe(
      Effect.provide(
        Layer.fresh(layerTest).pipe(
          Layer.provide(
            Layer.mock(LibraryWorkspace.LibraryWorkspace)({
              prepareThreadFiles: () =>
                Effect.fail(new LibraryError({ reason: "archive-unverified" })),
            }),
          ),
        ),
      ),
    );
    const now = yield* DateTime.now;
    const error = yield* policy
      .resolve({ thread: makeThread({ now, worktreePath: null }), modelSelection })
      .pipe(Effect.flip);
    assert.equal(error._tag, "RuntimePolicyResolveError");
    assert.equal((error.cause as LibraryError).reason, "archive-unverified");
  }),
);
