import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EventId,
  MessageId,
  NodeId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  type OrchestrationV2Subagent,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunAttemptId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import type { AgentReceipt } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import * as AgentReceipts from "./AgentReceipts.ts";
import { AgentReceiptsMigrations } from "./migrations.ts";
import { reactorLayer } from "./reactor.ts";

export const at = (minute: number) =>
  DateTime.makeUnsafe(`2026-10-20T09:${String(minute).padStart(2, "0")}:00.000Z`);

export const rootThreadId = ThreadId.make("thread:receipts-root");

export const makeThread = (
  id: ThreadId,
  parent: { readonly threadId: ThreadId; readonly rootThreadId: ThreadId } | null = null,
): OrchestrationV2AppThread => ({
  createdBy: parent === null ? "user" : "agent",
  creationSource: parent === null ? "web" : "provider",
  id,
  projectId: ProjectId.make("project:receipts"),
  title: id,
  providerInstanceId: ProviderInstanceId.make("claude"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  activeProviderThreadId: null,
  lineage: {
    parentThreadId: parent?.threadId ?? null,
    relationshipToParent: parent === null ? null : "subagent",
    rootThreadId: parent?.rootThreadId ?? id,
  },
  forkedFrom: null,
  createdAt: at(0),
  updatedAt: at(0),
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  lastVisitedAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  deletedAt: null,
});

export const makeSubagent = (
  overrides: Partial<OrchestrationV2Subagent> & Pick<OrchestrationV2Subagent, "id" | "threadId">,
): OrchestrationV2Subagent => ({
  runId: null,
  parentNodeId: NodeId.make("node:root"),
  origin: "provider_native",
  createdBy: "agent",
  driver: ProviderDriverKind.make("claudeAgent"),
  providerInstanceId: ProviderInstanceId.make("claude"),
  providerThreadId: null,
  childThreadId: null,
  nativeTaskRef: null,
  prompt: "Find the flaky test",
  title: "Investigate",
  model: null,
  status: "completed",
  result: "The flake is a shared port.",
  startedAt: at(1),
  completedAt: at(5),
  updatedAt: at(5),
  ...overrides,
});

export const makeRun = (
  overrides: Partial<OrchestrationV2Run> & Pick<OrchestrationV2Run, "id" | "threadId">,
): OrchestrationV2Run => ({
  ordinal: 1,
  providerInstanceId: ProviderInstanceId.make("claude"),
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-opus-5-5" },
  providerThreadId: null,
  userMessageId: MessageId.make("message:prompt"),
  rootNodeId: NodeId.make("node:root"),
  activeAttemptId: RunAttemptId.make("attempt"),
  status: "completed",
  requestedAt: at(0),
  startedAt: at(0),
  completedAt: at(9),
  checkpointId: null,
  contextHandoffId: null,
  ...overrides,
});

const itemBase = (threadId: ThreadId, ordinal: number, runId: RunId | null = null) => ({
  id: TurnItemId.make(`item:${threadId}:${ordinal}`),
  threadId,
  runId,
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal,
  status: "completed" as const,
  title: null,
  startedAt: at(2),
  completedAt: at(2),
  updatedAt: at(2),
});

export const assistantItem = (
  threadId: ThreadId,
  ordinal: number,
  text: string,
  runId: RunId | null = null,
): OrchestrationV2TurnItem => ({
  ...itemBase(threadId, ordinal, runId),
  type: "assistant_message",
  messageId: MessageId.make(`message:${threadId}:${ordinal}`),
  text,
  streaming: false,
});

export const userItem = (
  threadId: ThreadId,
  ordinal: number,
  text: string,
): OrchestrationV2TurnItem => ({
  ...itemBase(threadId, ordinal),
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: MessageId.make(`message:${threadId}:${ordinal}`),
  inputIntent: "turn_start",
  workflowScript: undefined,
  text,
  attachments: [],
});

export const commandItem = (
  threadId: ThreadId,
  ordinal: number,
  input: string,
  exitCode: number,
  options: { readonly monitor?: boolean } = {},
): OrchestrationV2TurnItem => ({
  ...itemBase(threadId, ordinal),
  type: "command_execution",
  input,
  exitCode,
  ...options,
});

export const toolItem = (
  threadId: ThreadId,
  ordinal: number,
  toolName: string,
  input: unknown,
): OrchestrationV2TurnItem => ({
  ...itemBase(threadId, ordinal),
  type: "dynamic_tool",
  toolName,
  input,
});

export const fileItem = (threadId: ThreadId, ordinal: number, fileName: string) =>
  ({ ...itemBase(threadId, ordinal), type: "file_change", fileName }) as OrchestrationV2TurnItem;

export const receiptFixture = (
  subjectId: string,
  threadId: ThreadId = rootThreadId,
): AgentReceipt => ({
  id: `receipt:${subjectId}`,
  kind: "subagent",
  subjectId,
  generation: "2026-10-20T09:05:00.000Z",
  threadId,
  parentThreadId: null,
  rootThreadId: threadId,
  childThreadId: null,
  parentSubjectId: null,
  driver: "claudeAgent",
  origin: "provider_native",
  title: null,
  status: "completed",
  prompt: { sha256: "0".repeat(64), length: 4, clipped: "Find" },
  result: { source: "claude_agent_result", text: `Result of ${subjectId}` },
  files: [],
  commands: { count: 0, failed: [] },
  usage: {},
  model: null,
  startedAt: null,
  finishedAt: "2026-10-20T09:05:00.000Z",
  memberReceiptIds: [],
  pointers: { childThreadId: null, providerTranscriptPath: null },
});

let eventCounter = 0;
const nextEventId = () => EventId.make(`event:receipts:${++eventCounter}`);

export const applyThread = (thread: OrchestrationV2AppThread) =>
  Effect.flatMap(ProjectionStore.ProjectionStoreV2, (projections) =>
    projections.apply({
      id: nextEventId(),
      threadId: thread.id,
      type: "thread.created",
      payload: thread,
      occurredAt: thread.createdAt,
    }),
  );

export const applySubagent = (subagent: OrchestrationV2Subagent) =>
  Effect.flatMap(ProjectionStore.ProjectionStoreV2, (projections) =>
    projections.apply({
      id: nextEventId(),
      threadId: subagent.threadId,
      type: "subagent.updated",
      payload: subagent,
      occurredAt: subagent.updatedAt,
    }),
  );

export const applyItem = (item: OrchestrationV2TurnItem) =>
  Effect.flatMap(ProjectionStore.ProjectionStoreV2, (projections) =>
    projections.apply({
      id: nextEventId(),
      threadId: item.threadId,
      type: "turn-item.updated",
      payload: item,
      occurredAt: item.updatedAt,
    }),
  );

export const subagentEvent = (subagent: OrchestrationV2Subagent) =>
  ({
    id: nextEventId(),
    threadId: subagent.threadId,
    type: "subagent.updated",
    payload: subagent,
    occurredAt: subagent.updatedAt,
  }) as const;

/** In-memory database with the projections and receipt tables; never reads a real Claude home. */
export const receiptsLayer = reactorLayer.pipe(
  Layer.provideMerge(AgentReceipts.layer),
  Layer.provideMerge(Layer.succeed(AgentReceipts.ClaudeConfigDirs, [])),
  Layer.provideMerge(
    Layer.effectDiscard(runForkMigrationSet(AgentReceiptsMigrations)).pipe(
      Layer.provideMerge(ProjectionStore.layer),
    ),
  ),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provideMerge(NodeServices.layer),
);
