import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotRun } from "@t3tools/contracts/fork";

export const testBot = (fields: Partial<BotDefinition> = {}): BotDefinition => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews one file.",
  instructions: "Review {{file}}.",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "project", projectId: null, worktree: false },
  timeoutMinutes: 5,
  maxConcurrentRuns: 2,
  scopeProjectId: null,
  version: 1,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: null,
  ...fields,
});

export const testRun = (id: string, createdAt: string, fields: Partial<BotRun> = {}): BotRun => ({
  id,
  botId: "reviewer",
  botVersion: 1,
  botName: "Reviewer",
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: ProjectId.make("project-a"),
  inputs: { file: "a.ts" },
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt,
  startedAt: createdAt,
  finishedAt: createdAt,
  result: "Looks fine.",
  resultTruncated: false,
  error: null,
  ...fields,
});
