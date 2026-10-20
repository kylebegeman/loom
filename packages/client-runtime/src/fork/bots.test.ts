import { describe, expect, it } from "vite-plus/test";
import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotRun } from "@t3tools/contracts/fork";
import {
  applyBotChanges,
  applyRunChanges,
  EMPTY_BOTS_CHANGES,
  foldBotsChange,
  type BotsChanges,
} from "./bots.ts";

const bot = (id: string, name: string, version = 1): BotDefinition => ({
  id,
  name,
  description: "",
  instructions: "Do it.",
  parameters: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "scratch" },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  version,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: null,
});

const run = (id: string, botId: string, createdAt: string, status: BotRun["status"]): BotRun => ({
  id,
  botId,
  botVersion: 1,
  botName: botId,
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: null,
  inputs: {},
  status,
  startedBy: "user",
  callerThreadId: null,
  createdAt,
  startedAt: null,
  finishedAt: null,
  result: null,
  resultTruncated: false,
  error: null,
});

const fold = (...changes: Parameters<typeof foldBotsChange>[1][]): BotsChanges =>
  changes.reduce(foldBotsChange, EMPTY_BOTS_CHANGES);

describe("bots changes", () => {
  it("applies edits, new bots and deletions over the listed bots in name order", () => {
    const changes = fold(
      { _tag: "bot", bot: bot("b", "Beta", 2) },
      { _tag: "bot", bot: bot("c", "Alpha") },
      { _tag: "bot-deleted", botId: "a" },
    );
    expect(
      applyBotChanges([bot("a", "Aardvark"), bot("b", "Beta")], changes).map((entry) => [
        entry.id,
        entry.version,
      ]),
    ).toEqual([
      ["c", 1],
      ["b", 2],
    ]);
  });

  it("updates listed runs and adds new ones only to pages that should show them", () => {
    const listed = [run("old", "x", "2026-10-20T10:00:00.000Z", "running")];
    const changes = fold(
      { _tag: "run", run: run("old", "x", "2026-10-20T10:00:00.000Z", "completed") },
      { _tag: "run", run: run("new-x", "x", "2026-10-20T11:00:00.000Z", "queued") },
      { _tag: "run", run: run("new-y", "y", "2026-10-20T12:00:00.000Z", "queued") },
    );
    const status = (runs: ReadonlyArray<BotRun>) => runs.map((entry) => [entry.id, entry.status]);
    expect(status(applyRunChanges(listed, changes, { includeNew: true }))).toEqual([
      ["new-y", "queued"],
      ["new-x", "queued"],
      ["old", "completed"],
    ]);
    expect(status(applyRunChanges(listed, changes, { botId: "x", includeNew: true }))).toEqual([
      ["new-x", "queued"],
      ["old", "completed"],
    ]);
    expect(status(applyRunChanges(listed, changes, { includeNew: false }))).toEqual([
      ["old", "completed"],
    ]);
  });
});
