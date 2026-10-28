import type {
  OrchestrationV2Run,
  OrchestrationV2Subagent,
  OrchestrationV2ThreadProjection,
  OrchestrationV2TurnItem,
  OrchestrationV2WorkflowAgent,
  ThreadId,
} from "@t3tools/contracts";
import type {
  AgentReceipt,
  AgentReceiptFile,
  AgentReceiptResultSource,
  AgentReceiptStatus,
  AgentReceiptUsage,
} from "@t3tools/contracts/fork";
import { subagentResultForRun } from "@t3tools/provider-core/server/subagentProjection";
import * as DateTime from "effect/DateTime";

import type { ClaudeAgentTranscript } from "./claudeTranscript.ts";

const PROMPT_CLIP_CHARS = 600;
const COMMAND_CLIP_CHARS = 240;
const RESULT_LINE_CHARS = 200;
const FAILED_COMMANDS_KEPT = 20;

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const isTerminalReceiptStatus = (status: string): status is AgentReceiptStatus =>
  TERMINAL_STATUSES.has(status);

export type ReceiptBody = Omit<AgentReceipt, "id">;

export type ChildRecords = Pick<
  OrchestrationV2ThreadProjection,
  "runs" | "messages" | "turnItems" | "checkpoints"
>;

export interface Lineage {
  readonly threadId: ThreadId;
  readonly parentThreadId: ThreadId | null;
  readonly rootThreadId: ThreadId;
  readonly parentSubjectId: string | null;
}

const clip = (text: string, limit: number) =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

export const resultLine = (text: string) =>
  clip(text.replace(/\s+/gu, " ").trim(), RESULT_LINE_CHARS);

const iso = (value: DateTime.Utc | null | undefined) =>
  value === null || value === undefined ? null : DateTime.formatIso(value);

const byOrdinalDesc = <A extends { readonly ordinal: number }>(items: ReadonlyArray<A>) =>
  items.toSorted((left, right) => right.ordinal - left.ordinal);

const lastStructuredOutput = (items: ReadonlyArray<OrchestrationV2TurnItem>) => {
  for (const item of byOrdinalDesc(items)) {
    if (item.type === "dynamic_tool" && item.toolName === "StructuredOutput") {
      if (item.input === undefined || item.input === null) continue;
      return typeof item.input === "string" ? item.input : JSON.stringify(item.input, null, 2);
    }
  }
  return undefined;
};

const lastAssistantText = (items: ReadonlyArray<OrchestrationV2TurnItem>) => {
  for (const item of byOrdinalDesc(items)) {
    if (item.type === "assistant_message" && item.text.trim().length > 0) return item.text;
  }
  return undefined;
};

const firstUserText = (items: ReadonlyArray<OrchestrationV2TurnItem>) =>
  items
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .find(
      (item): item is Extract<OrchestrationV2TurnItem, { readonly type: "user_message" }> =>
        item.type === "user_message" && item.text.trim().length > 0,
    )?.text;

const nonEmpty = (text: string | null | undefined) =>
  text !== null && text !== undefined && text.trim().length > 0 ? text : undefined;

/** The delegated child's own run for this task, else its newest run. */
const delegatedRun = (subagent: OrchestrationV2Subagent, child: ChildRecords) =>
  byOrdinalDesc(child.runs.filter((run) => run.delegatedTaskId === subagent.id))[0] ??
  byOrdinalDesc(child.runs)[0];

/**
 * The fullest outcome each provider leaves behind. Claude's Agent result is the child's final
 * message, but a background Agent reports only a summary there; its output file is the agent
 * transcript, so the longer of the two wins. Workflow members answer through StructuredOutput,
 * whose input is the real result while the record holds a preview.
 */
export const extractSubagentResult = (input: {
  readonly subagent: OrchestrationV2Subagent;
  readonly child: ChildRecords | null;
  readonly transcript: ClaudeAgentTranscript | null;
}): { readonly source: AgentReceiptResultSource; readonly text: string } => {
  const { subagent, child, transcript } = input;
  const recorded = nonEmpty(subagent.result);
  const childItems = child?.turnItems ?? [];
  if (subagent.origin === "app_owned") {
    if (subagent.remoteChild !== undefined && recorded !== undefined)
      return { source: "delegate_task", text: recorded };
    const run = child === null ? undefined : delegatedRun(subagent, child);
    if (child !== null && run !== undefined)
      return { source: "delegate_task", text: subagentResultForRun(child, run).text };
    return recorded === undefined
      ? { source: "none", text: "" }
      : { source: "subagent_record", text: recorded };
  }
  const structured = lastStructuredOutput(childItems);
  if (structured !== undefined) return { source: "workflow_structured_output", text: structured };
  if (subagent.driver === "codex" && recorded !== undefined)
    return { source: "codex_agent_state", text: recorded };
  if (subagent.driver === "claudeAgent") {
    const written = nonEmpty(transcript?.finalText);
    if (written !== undefined && (recorded === undefined || written.length > recorded.length))
      return { source: "claude_transcript", text: written };
    if (recorded !== undefined) return { source: "claude_agent_result", text: recorded };
  }
  if (recorded !== undefined) return { source: "subagent_record", text: recorded };
  const said = lastAssistantText(childItems);
  return said === undefined
    ? { source: "none", text: "" }
    : { source: "subagent_record", text: said };
};

const promptFields = (prompt: string, sha256: string) => ({
  sha256,
  length: prompt.length,
  clipped: clip(prompt, PROMPT_CLIP_CHARS),
});

export const subagentPrompt = (subagent: OrchestrationV2Subagent, child: ChildRecords | null) =>
  nonEmpty(subagent.prompt) ?? firstUserText(child?.turnItems ?? []) ?? "";

/** Files from file-change items and checkpoint lists, one entry per path. */
const changedFiles = (
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  checkpoints: ReadonlyArray<OrchestrationV2ThreadProjection["checkpoints"][number]>,
): ReadonlyArray<AgentReceiptFile> => {
  const files = new Map<string, AgentReceiptFile>();
  for (const checkpoint of checkpoints)
    for (const file of checkpoint.files)
      files.set(file.path, {
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
      });
  for (const item of items) {
    if (item.type !== "file_change" || files.has(item.fileName)) continue;
    files.set(item.fileName, {
      path: item.fileName,
      ...(item.additions === undefined ? {} : { additions: item.additions }),
      ...(item.deletions === undefined ? {} : { deletions: item.deletions }),
    });
  }
  return [...files.values()].toSorted((left, right) => left.path.localeCompare(right.path));
};

export const commandSummary = (items: ReadonlyArray<OrchestrationV2TurnItem>) => {
  const commands = items
    .filter(
      (item): item is Extract<OrchestrationV2TurnItem, { readonly type: "command_execution" }> =>
        item.type === "command_execution" && item.monitor !== true,
    )
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const failed = commands
    .filter(
      (item) =>
        (item.exitCode !== undefined && item.exitCode !== 0) ||
        item.outputIndicatesFailure === true ||
        item.status === "failed",
    )
    .map((item) => ({
      input: clip(item.input, COMMAND_CLIP_CHARS),
      exitCode: item.exitCode ?? null,
    }));
  return { count: commands.length, failed: failed.slice(-FAILED_COMMANDS_KEPT) };
};

const usageFrom = (input: {
  readonly transcript: ClaudeAgentTranscript | null;
  readonly member: OrchestrationV2WorkflowAgent | undefined;
  readonly workflow: OrchestrationV2Subagent["workflow"];
  readonly startedAt: DateTime.Utc | null;
  readonly finishedAt: DateTime.Utc;
}): AgentReceiptUsage => {
  const counted = input.transcript?.usage ?? {};
  const totals = input.member ?? input.workflow;
  const totalTokens = counted.totalTokens ?? totals?.totalTokens;
  const toolCalls = counted.toolCalls ?? totals?.toolCalls;
  const durationMs =
    totals?.durationMs ??
    counted.durationMs ??
    (input.startedAt === null
      ? undefined
      : Math.max(
          0,
          DateTime.toEpochMillis(input.finishedAt) - DateTime.toEpochMillis(input.startedAt),
        ));
  return {
    ...(totalTokens === undefined ? {} : { totalTokens }),
    ...(counted.inputTokens === undefined ? {} : { inputTokens: counted.inputTokens }),
    ...(counted.outputTokens === undefined ? {} : { outputTokens: counted.outputTokens }),
    ...(counted.cacheReadTokens === undefined ? {} : { cacheReadTokens: counted.cacheReadTokens }),
    ...(toolCalls === undefined ? {} : { toolCalls }),
    ...(durationMs === undefined ? {} : { durationMs }),
  };
};

export const subagentGeneration = (subagent: OrchestrationV2Subagent) =>
  DateTime.formatIso(subagent.completedAt ?? subagent.updatedAt);

export const buildSubagentReceipt = (input: {
  readonly subagent: OrchestrationV2Subagent & { readonly status: AgentReceiptStatus };
  readonly lineage: Lineage;
  readonly child: ChildRecords | null;
  /** Checkpoints the parent thread captured for this sub-agent's node. */
  readonly parentCheckpoints: ReadonlyArray<OrchestrationV2ThreadProjection["checkpoints"][number]>;
  readonly transcript: ClaudeAgentTranscript | null;
  readonly workflowMember: OrchestrationV2WorkflowAgent | undefined;
  readonly memberReceiptIds: ReadonlyArray<string>;
  readonly promptSha256: string;
}): ReceiptBody => {
  const { subagent, child, transcript } = input;
  const prompt = subagentPrompt(subagent, child);
  const finishedAt = subagent.completedAt ?? subagent.updatedAt;
  const items = child?.turnItems ?? [];
  return {
    kind: "subagent",
    subjectId: subagent.id,
    generation: subagentGeneration(subagent),
    threadId: input.lineage.threadId,
    parentThreadId: input.lineage.parentThreadId,
    rootThreadId: input.lineage.rootThreadId,
    childThreadId: subagent.childThreadId,
    parentSubjectId: input.lineage.parentSubjectId,
    driver: subagent.driver,
    origin: subagent.origin,
    title: subagent.title,
    status: subagent.status,
    prompt: promptFields(prompt, input.promptSha256),
    result: extractSubagentResult({ subagent, child, transcript }),
    files: changedFiles(items, [...input.parentCheckpoints, ...(child?.checkpoints ?? [])]),
    commands: commandSummary(items),
    usage: usageFrom({
      transcript,
      member: input.workflowMember,
      workflow: subagent.workflow,
      startedAt: subagent.startedAt,
      finishedAt,
    }),
    model: subagent.model ?? input.workflowMember?.model ?? transcript?.model ?? null,
    startedAt: iso(subagent.startedAt),
    finishedAt: DateTime.formatIso(finishedAt),
    memberReceiptIds: [...input.memberReceiptIds],
    pointers: {
      ...(subagent.remoteChild === undefined ? {} : { remoteChild: subagent.remoteChild }),
      childThreadId: subagent.childThreadId,
      providerTranscriptPath: transcript?.path ?? null,
    },
  };
};

export const runPrompt = (
  projection: Pick<OrchestrationV2ThreadProjection, "messages">,
  run: OrchestrationV2Run,
) => projection.messages.find((message) => message.id === run.userMessageId)?.text ?? "";

export const buildRunReceipt = (input: {
  readonly run: OrchestrationV2Run & { readonly status: AgentReceiptStatus };
  readonly completedAt: DateTime.Utc;
  readonly lineage: Lineage;
  readonly projection: ChildRecords;
  readonly driver: string;
  readonly memberReceiptIds: ReadonlyArray<string>;
  readonly promptSha256: string;
}): ReceiptBody => {
  const { run, projection } = input;
  const items = projection.turnItems.filter((item) => item.runId === run.id);
  const startedAt = run.startedAt ?? run.requestedAt;
  return {
    kind: "run",
    subjectId: run.id,
    generation: DateTime.formatIso(input.completedAt),
    threadId: input.lineage.threadId,
    parentThreadId: input.lineage.parentThreadId,
    rootThreadId: input.lineage.rootThreadId,
    childThreadId: null,
    parentSubjectId: input.lineage.parentSubjectId,
    driver: input.driver,
    origin: null,
    title: null,
    status: run.status,
    prompt: promptFields(runPrompt(projection, run), input.promptSha256),
    result: { source: "run_assistant", text: subagentResultForRun(projection, run).text },
    files: changedFiles(
      items,
      projection.checkpoints.filter((checkpoint) => checkpoint.runId === run.id),
    ),
    commands: commandSummary(items),
    usage: usageFrom({
      transcript: null,
      member: undefined,
      workflow: undefined,
      startedAt,
      finishedAt: input.completedAt,
    }),
    model: run.modelSelection.model,
    startedAt: iso(startedAt),
    finishedAt: DateTime.formatIso(input.completedAt),
    memberReceiptIds: [...input.memberReceiptIds],
    pointers: { childThreadId: null, providerTranscriptPath: null },
  };
};
