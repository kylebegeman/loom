import { OrchestrationV2RemoteTaskChild } from "../orchestrationV2.ts";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "../auth.ts";
import { NonNegativeInt, ThreadId } from "../baseSchemas.ts";

export const AGENT_RECEIPTS_WS_METHODS = {
  list: "loom.agent-receipts.list",
  get: "loom.agent-receipts.get",
} as const;

/** Where a receipt's result text came from; each provider reports its outcome differently. */
export const AgentReceiptResultSource = Schema.Literals([
  "claude_agent_result",
  "claude_transcript",
  "workflow_structured_output",
  "codex_agent_state",
  "delegate_task",
  "run_assistant",
  "subagent_record",
  "none",
]);
export type AgentReceiptResultSource = typeof AgentReceiptResultSource.Type;

export const AgentReceiptStatus = Schema.Literals([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type AgentReceiptStatus = typeof AgentReceiptStatus.Type;

export const AgentReceiptFile = Schema.Struct({
  path: Schema.String,
  additions: Schema.optional(NonNegativeInt),
  deletions: Schema.optional(NonNegativeInt),
});
export type AgentReceiptFile = typeof AgentReceiptFile.Type;

export const AgentReceiptFailedCommand = Schema.Struct({
  input: Schema.String,
  exitCode: Schema.NullOr(Schema.Int),
});
export type AgentReceiptFailedCommand = typeof AgentReceiptFailedCommand.Type;

export const AgentReceiptUsage = Schema.Struct({
  totalTokens: Schema.optional(NonNegativeInt),
  inputTokens: Schema.optional(NonNegativeInt),
  outputTokens: Schema.optional(NonNegativeInt),
  cacheReadTokens: Schema.optional(NonNegativeInt),
  toolCalls: Schema.optional(NonNegativeInt),
  durationMs: Schema.optional(NonNegativeInt),
});
export type AgentReceiptUsage = typeof AgentReceiptUsage.Type;

/**
 * What one finished sub-agent or top-level run was asked, did and found, built by Loom from its
 * own records without a model call. `id` is a SHA-256 of every other field, so an unchanged
 * outcome always gets the same id. One receipt per subject and finish `generation`.
 */
export const AgentReceipt = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["subagent", "run"]),
  /** The sub-agent's node id, or the run id for a top-level run. */
  subjectId: Schema.String,
  /** The ISO finish time; a reopened sub-agent finishes again with a new generation. */
  generation: Schema.String,
  threadId: ThreadId,
  parentThreadId: Schema.NullOr(ThreadId),
  rootThreadId: ThreadId,
  childThreadId: Schema.NullOr(ThreadId),
  parentSubjectId: Schema.NullOr(Schema.String),
  driver: Schema.String,
  origin: Schema.NullOr(Schema.Literals(["provider_native", "app_owned"])),
  title: Schema.NullOr(Schema.String),
  status: AgentReceiptStatus,
  prompt: Schema.Struct({
    sha256: Schema.String,
    length: NonNegativeInt,
    clipped: Schema.String,
  }),
  result: Schema.Struct({
    source: AgentReceiptResultSource,
    text: Schema.String,
  }),
  files: Schema.Array(AgentReceiptFile),
  commands: Schema.Struct({
    count: NonNegativeInt,
    failed: Schema.Array(AgentReceiptFailedCommand),
  }),
  usage: AgentReceiptUsage,
  model: Schema.NullOr(Schema.String),
  startedAt: Schema.NullOr(Schema.String),
  finishedAt: Schema.String,
  /** A workflow coordinator's members, or a top-level run's direct sub-agents. */
  memberReceiptIds: Schema.Array(Schema.String),
  pointers: Schema.Struct({
    remoteChild: Schema.optional(OrchestrationV2RemoteTaskChild),
    childThreadId: Schema.NullOr(ThreadId),
    providerTranscriptPath: Schema.NullOr(Schema.String),
  }),
});
export type AgentReceipt = typeof AgentReceipt.Type;

/** A receipt without its full result, for rows that show it before anyone expands it. */
export const AgentReceiptSummary = Schema.Struct({
  id: Schema.String,
  kind: AgentReceipt.fields.kind,
  subjectId: Schema.String,
  generation: Schema.String,
  status: AgentReceiptStatus,
  resultLine: Schema.String,
  resultLength: NonNegativeInt,
  filesChanged: NonNegativeInt,
  commandCount: NonNegativeInt,
  failedCommands: NonNegativeInt,
  memberCount: NonNegativeInt,
});
export type AgentReceiptSummary = typeof AgentReceiptSummary.Type;

export class AgentReceiptError extends Schema.TaggedError<AgentReceiptError>()(
  "AgentReceiptError",
  {
    reason: Schema.Literals(["not-found", "io"]),
    message: Schema.String,
  },
) {}

const errors = Schema.Union([AgentReceiptError, EnvironmentAuthorizationError]);

export const AgentReceiptsRpcGroup = RpcGroup.make(
  /** The latest receipt of each sub-agent recorded on this thread, and its runs' receipts. */
  Rpc.make(AGENT_RECEIPTS_WS_METHODS.list, {
    payload: Schema.Struct({ threadId: ThreadId }),
    success: Schema.Array(AgentReceiptSummary),
    error: errors,
  }),
  Rpc.make(AGENT_RECEIPTS_WS_METHODS.get, {
    payload: Schema.Struct({ threadId: ThreadId, subjectId: Schema.String }),
    success: AgentReceipt,
    error: errors,
  }),
);
