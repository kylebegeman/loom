import {
  MessageId,
  RunId,
  type OrchestrationV2Run,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { idleThreadProjection } from "../../mcp/McpToolAccess.testkit.ts";
import { threadShellFromProjection } from "../../orchestration-v2/ProjectionStore.ts";

export const vaultRun = (
  thread: OrchestrationV2ThreadShell,
  overrides: Partial<OrchestrationV2Run> = {},
): OrchestrationV2Run => ({
  id: thread.activeRunId ?? RunId.make("vault-active-run"),
  threadId: thread.id,
  ordinal: 1,
  providerInstanceId: thread.modelSelection.instanceId,
  modelSelection: thread.modelSelection,
  providerThreadId: null,
  userMessageId: MessageId.make("vault-run-message"),
  rootNodeId: null,
  activeAttemptId: null,
  status: thread.status === "idle" ? "completed" : thread.status,
  requestedAt: thread.createdAt,
  startedAt: thread.createdAt,
  completedAt: null,
  checkpointId: null,
  contextHandoffId: null,
  ...overrides,
});

export const newerVaultRun = (
  state: { thread: OrchestrationV2ThreadShell; runs: OrchestrationV2Run[] },
  status: "cancelled" | "completed",
) => {
  const active = vaultRun(state.thread, { status: "running" });
  state.runs = [
    active,
    vaultRun(state.thread, {
      id: RunId.make("newer-queued-turn"),
      ordinal: 2,
      status,
      completedAt: state.thread.updatedAt,
    }),
  ];
  state.thread = threadShellFromProjection({
    ...idleThreadProjection(state.thread),
    runs: state.runs,
  });
};
