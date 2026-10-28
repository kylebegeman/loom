import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  CommandId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as AttentionRetry from "./AttentionRetry.ts";
import { OrchestratorDispatchError } from "../../orchestration-v2/Orchestrator.ts";

const now = DateTime.makeUnsafe("2026-10-28T00:00:00.000Z");
const threadId = ThreadId.make("failed");
const runId = RunId.make("failed-run");
const shell: OrchestrationV2ThreadShell = {
  id: threadId,
  projectId: ProjectId.make("project"),
  title: "Failed thread",
  providerInstanceId: ProviderInstanceId.make("claude"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: { rootThreadId: threadId, parentThreadId: null, relationshipToParent: null },
  forkedFrom: null,
  createdBy: "user",
  creationSource: "web",
  latestRunId: runId,
  activeRunId: null,
  status: "failed",
  lastErrorClass: "transport_error",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  deletedAt: null,
};
const question = {
  id: RuntimeRequestId.make("question"),
  kind: "user_input" as const,
  createdAt: now,
};

it.effect("rejects stale, unavailable and blocked failures before dispatch", () =>
  Effect.gen(function* () {
    let current: OrchestrationV2ThreadShell | null = shell;
    let family = [shell];
    let dispatched = 0;
    let changedDuringDispatch = false;
    const service = yield* AttentionRetry.AttentionRetry.pipe(
      Effect.provide(
        AttentionRetry.layer.pipe(
          Layer.provide(
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: () => Effect.succeed(current),
              readShellSnapshot: () =>
                Effect.succeed(
                  Effect.succeed({
                    threads: family,
                    snapshotSequence: 0,
                    schemaVersion: 1,
                    archivedThreads: [],
                  }),
                ),
              dispatch: (command) =>
                Effect.gen(function* () {
                  dispatched++;
                  expect(command).toMatchObject({
                    threadId,
                    manualContinuationOfRunId: runId,
                    dispatchMode: { type: "start_immediately" },
                    createdBy: "user",
                    creationSource: "web",
                  });
                  if (changedDuringDispatch)
                    return yield* new OrchestratorDispatchError({
                      commandId: CommandId.make("raced"),
                      commandType: "message.dispatch",
                      cause: "Stale run",
                    });
                  return { sequence: 1, storedEvents: [] };
                }),
            }),
          ),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
    const retry = () =>
      service.retry({ threadId, runId }, { createdBy: "user", creationSource: "web" });
    for (const [changed, reason] of [
      [null, "not-found"],
      [{ ...shell, archivedAt: now }, "not-found"],
      [{ ...shell, deletedAt: now }, "not-found"],
      [{ ...shell, latestRunId: RunId.make("newer") }, "changed"],
      [{ ...shell, status: "running" as const }, "changed"],
      [{ ...shell, lastErrorClass: "permission_error" as const }, "not-retryable"],
      [{ ...shell, pendingRuntimeRequest: question }, "pending-request"],
    ] as const) {
      current = changed;
      expect((yield* retry().pipe(Effect.flip)).reason).toBe(reason);
    }
    current = shell;
    family = [
      shell,
      {
        ...shell,
        id: ThreadId.make("child"),
        status: "running",
        lineage: { ...shell.lineage, relationshipToParent: "subagent", parentThreadId: threadId },
        pendingRuntimeRequest: question,
      },
    ];
    expect((yield* retry().pipe(Effect.flip)).reason).toBe("pending-request");
    expect(dispatched).toBe(0);
    family = [shell];
    expect(yield* retry()).toEqual({ sequence: 1 });
    expect(dispatched).toBe(1);
    changedDuringDispatch = true;
    expect((yield* retry().pipe(Effect.flip)).reason).toBe("changed");
  }),
);
