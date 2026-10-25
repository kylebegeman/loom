import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { CodexProviderCapabilitiesV2 } from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as EventSink from "../../orchestration-v2/EventSink.ts";
import { DispatchModeLimit } from "../../orchestration-v2/DispatchModeLimit.ts";
import * as Orchestrator from "../../orchestration-v2/Orchestrator.ts";
import * as ProviderAdapterRegistry from "../../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "../../orchestration-v2/testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5" };
const adapter: ProviderAdapter.ProviderAdapterV2["Service"] = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
  openSession: () => Effect.die("Forks and merge-backs record transfers without provider work"),
};
const layer = ProviderReplayHarness.layerWithRegistry(
  { name: "deleted-thread-commands" },
  ProviderAdapterRegistry.layerFromAdapters([adapter]),
  { runEffectWorker: false },
);

const runOf = (threadId: ThreadId) => RunId.make(`run:${threadId}`);
// Below the full-access mode every thread here is created with.
const supervised = { runtimeMode: "approval-required", interactionMode: "default" } as const;

// A finished run is what a fork copies and what a merge-back brings back.
const finishRun = Effect.fnUntraced(function* (threadId: ThreadId) {
  const sink = yield* EventSink.EventSinkV2;
  const now = yield* DateTime.now;
  const runId = runOf(threadId);
  yield* sink.write({
    events: [
      {
        id: EventId.make(runId),
        type: "run.created",
        threadId,
        runId,
        occurredAt: now,
        payload: {
          id: runId,
          threadId,
          ordinal: 1,
          providerInstanceId: instanceId,
          modelSelection,
          providerThreadId: null,
          userMessageId: MessageId.make(`message:${threadId}`),
          rootNodeId: null,
          activeAttemptId: null,
          status: "completed",
          requestedAt: now,
          startedAt: now,
          completedAt: now,
          checkpointId: null,
          contextHandoffId: null,
        },
      },
    ],
  });
});

const createFinished = Effect.fnUntraced(function* (threadId: ThreadId) {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("project:deleted-thread-commands"),
    title: threadId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* finishRun(threadId);
});

const fork = (sourceThreadId: ThreadId, targetThreadId: ThreadId) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make(`fork:${targetThreadId}`),
      sourceThreadId,
      targetThreadId,
      sourcePoint: { type: "run", runId: runOf(sourceThreadId) },
      createdBy: "agent",
      creationSource: "mcp",
    }),
  );

const remove = (threadId: ThreadId) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "thread.delete",
      commandId: CommandId.make(`delete:${threadId}`),
      threadId,
    }),
  );

const mergeBack = (input: {
  readonly attempt: string;
  readonly fork: ThreadId;
  readonly parent: ThreadId;
}) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.dispatch({
      type: "thread.merge_back",
      commandId: CommandId.make(`merge:${input.attempt}`),
      sourceThreadId: input.fork,
      targetThreadId: input.parent,
      sourcePoint: { type: "run", runId: runOf(input.fork) },
      createdBy: "agent",
      creationSource: "mcp",
    }),
  );

const mergeTransfers = (threadId: ThreadId) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator
      .getThreadProjection(threadId)
      .pipe(
        Effect.map(
          (projection) =>
            projection.contextTransfers.filter((transfer) => transfer.type === "merge_back").length,
        ),
      ),
  );

it.effect("refuses to fork a deleted thread, whose history is purged a day later", () =>
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    const source = ThreadId.make("thread:fork-source");
    const before = ThreadId.make("thread:fork-before");
    const after = ThreadId.make("thread:fork-after");
    yield* createFinished(source);
    yield* fork(source, before);
    assert.isNotNull(yield* orchestrator.getThreadShell(before));

    yield* remove(source);
    // A deleted source is refused as deleted, not as needing a higher mode.
    const refused = yield* Effect.flip(
      fork(source, after).pipe(Effect.provideService(DispatchModeLimit, supervised)),
    );
    assert.ok(refused._tag === "OrchestratorDispatchError");
    assert.equal(refused.cause, `Thread ${source} is deleted.`);
    assert.isNull(yield* orchestrator.getThreadShell(after));
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses to merge a fork back out of a deleted fork or into a deleted parent", () =>
  Effect.gen(function* () {
    const parent = ThreadId.make("thread:merge-parent");
    const child = ThreadId.make("thread:merge-child");
    yield* createFinished(parent);
    yield* fork(parent, child);
    yield* finishRun(child);
    yield* mergeBack({ attempt: "live", fork: child, parent });
    assert.equal(yield* mergeTransfers(parent), 1);

    // The parent, which the command locks, is within the limit; only the deleted fork is above it.
    yield* Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
      orchestrator.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make("lower:merge-parent"),
        threadId: parent,
        runtimeMode: supervised.runtimeMode,
      }),
    );
    yield* remove(child);
    const outOfDeleted = yield* Effect.flip(
      mergeBack({ attempt: "deleted-fork", fork: child, parent }).pipe(
        Effect.provideService(DispatchModeLimit, supervised),
      ),
    );
    assert.ok(outOfDeleted._tag === "OrchestratorDispatchError");
    assert.equal(outOfDeleted.cause, `Thread ${child} is deleted.`);

    const deletedParent = ThreadId.make("thread:merge-deleted-parent");
    const liveChild = ThreadId.make("thread:merge-live-child");
    yield* createFinished(deletedParent);
    yield* fork(deletedParent, liveChild);
    yield* finishRun(liveChild);
    yield* remove(deletedParent);
    const intoDeleted = yield* Effect.flip(
      mergeBack({ attempt: "deleted-parent", fork: liveChild, parent: deletedParent }),
    );
    assert.ok(intoDeleted._tag === "OrchestratorDispatchError");
    assert.equal(intoDeleted.cause, `Thread ${deletedParent} is deleted.`);
    assert.equal(yield* mergeTransfers(parent), 1);
    assert.equal(yield* mergeTransfers(deletedParent), 0);
  }).pipe(Effect.provide(layer)),
);
