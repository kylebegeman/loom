import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotRun } from "@t3tools/contracts/fork";

export const makeBotRun = (id: string, patch: Partial<BotRun> = {}): BotRun => ({
  id,
  botId: "reviewer",
  botVersion: 1,
  botName: "Reviewer",
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: null,
  inputs: {},
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  startedAt: "2026-10-20T10:00:10.000Z",
  finishedAt: "2026-10-20T10:01:10.000Z",
  result: "Original result.",
  resultTruncated: false,
  error: null,
  ...patch,
});

export const makeBotDefinition = (patch: Partial<BotDefinition> = {}): BotDefinition => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Review changes.",
  instructions: "Review {{pr}}.",
  parameters: [{ name: "pr", label: "Pull request", type: "string", required: true }],
  modelSelection: { instanceId: ProviderInstanceId.make("codex_2"), model: "gpt-6.1-sol" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  version: 2,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T11:00:00.000Z",
  archivedAt: null,
  ...patch,
});
