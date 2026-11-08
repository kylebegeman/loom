import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  NodeId,
  RunId,
  ThreadId,
  type OrchestrationV2Checkpoint,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import { ProcessRunner } from "../processRunner.ts";
import { makeTurnFiles, turnGeneration } from "./turnFiles.ts";

const threadId = ThreadId.make("thread");
const row = (
  turn: number,
  patch: Partial<OrchestrationV2Checkpoint> = {},
): OrchestrationV2Checkpoint => ({
  id: CheckpointId.make(`checkpoint-${turn}`),
  threadId,
  scopeId: CheckpointScopeId.make("root"),
  runId: RunId.make(`run-${turn}`),
  nodeId: NodeId.make(`node-${turn}`),
  parentCheckpointId: null,
  ordinalWithinScope: turn,
  appRunOrdinal: turn,
  ref: CheckpointRef.make(`refs/checkpoints/${turn}`),
  status: "ready",
  files: [{ path: "models/part.scad", kind: "modified", additions: 1, deletions: 0 }],
  capturedAt: DateTime.makeUnsafe("2026-10-10T00:00:00Z"),
  ...patch,
});

it.effect("generations follow the thread's newest turn row of any status or file count", () =>
  Effect.gen(function* () {
    let rows: readonly OrchestrationV2Checkpoint[] = [];
    const turnFiles = yield* makeTurnFiles.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThreadRecords: () => Effect.sync(() => ({ checkpoints: rows }) as never),
          }),
          Layer.mock(ThreadManagementService)({
            streamDomainEvents: Stream.suspend(() =>
              Stream.fromIterable(
                rows.map(
                  (payload) =>
                    ({ type: "checkpoint.captured", payload }) as OrchestrationV2DomainEvent,
                ),
              ),
            ),
          }),
          Layer.mock(ProcessRunner)({}),
        ),
      ),
    );
    const generation = (runId: RunId | null = null) =>
      turnFiles
        .turnCheckpoints(threadId, runId, 20)
        .pipe(Effect.map((result) => result.generation));
    const baseline = row(0, { runId: null, appRunOrdinal: null, files: [] });

    rows = [baseline, row(1), row(2)];
    const olderRun = yield* turnFiles.turnCheckpoints(threadId, RunId.make("run-1"), 20);
    expect(olderRun.checkpoints.map((turn) => turn.checkpointId)).toEqual(["checkpoint-1"]);
    expect(olderRun.generation).toBe("checkpoint-2:ready");
    const events = yield* Stream.runCollect(turnFiles.turnCheckpointEvents(threadId));
    expect(events.map(turnGeneration)).toEqual(["checkpoint-1:ready", olderRun.generation]);

    rows = [baseline, row(1), row(2, { status: "error", files: [] })];
    expect(yield* generation()).toBe("checkpoint-2:error");
    rows = [baseline, row(1), row(2, { status: "stale" })];
    expect(yield* generation()).toBe("checkpoint-2:stale");
    rows = [baseline, row(1), row(2, { files: [] })];
    expect(yield* generation()).toBe("checkpoint-2:ready");
    rows = [baseline];
    expect(yield* generation()).toBeNull();
  }),
);
