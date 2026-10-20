import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type {
  BotBatch,
  BotBatchItem,
  BotDefinition,
  BotRun,
  BotTrigger,
  BotTriggerFiring,
} from "@t3tools/contracts/fork";
import {
  applyBatchChanges,
  applyBatchItemChanges,
  applyBotChanges,
  applyFiringChanges,
  applyInboxChanges,
  applyRunChanges,
  applyTriggerChanges,
  botVersionDiff,
  botVersionLabel,
  EMPTY_BOT_BATCH_CHANGES,
  EMPTY_BOT_TRIGGER_CHANGES,
  EMPTY_BOTS_CHANGES,
  foldBotBatchChange,
  foldBotTriggerChange,
  foldBotsChange,
  formatReplaySummary,
  type BotsChanges,
  waitingBotRunThreads,
} from "./bots.ts";
import type { EnvironmentThreadShell } from "../state/models.ts";

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

  it("keeps a verdict page to runs that end with that verdict", () => {
    const at = "2026-10-20T10:00:00.000Z";
    const withVerdict = (id: string, verdict: "pass" | "fail"): BotRun => ({
      ...run(id, "x", at, "completed"),
      verdict: { verdict, summary: "", findings: [], findingsTruncated: false, source: "decoded" },
    });
    const listed = [withVerdict("a", "fail"), withVerdict("b", "fail")];
    const changes = fold(
      { _tag: "run", run: withVerdict("a", "pass") },
      { _tag: "run", run: withVerdict("c", "fail") },
      { _tag: "run", run: run("d", "x", at, "running") },
    );
    expect(
      applyRunChanges(listed, changes, { verdict: "fail", includeNew: true }).map(({ id }) => id),
    ).toEqual(["c", "b"]);
  });
});

const batch = (
  id: string,
  botId: string,
  createdAt: string,
  status: BotBatch["status"],
): BotBatch => ({
  id,
  botId,
  botVersion: 1,
  botName: botId,
  projectId: null,
  sourceType: "lines",
  sourceSummary: "Pasted lines, 2 items",
  itemParameter: "file",
  sharedInputs: {},
  status,
  note: null,
  startedBy: "user",
  callerThreadId: null,
  createdAt,
  finishedAt: null,
  total: 2,
  counts: {
    pending: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    timedOut: 0,
    cancelled: 0,
    skipped: 0,
    pass: 0,
    fail: 0,
    needsAttention: 0,
  },
});

const item = (index: number, state: BotBatchItem["state"]): BotBatchItem => ({
  index,
  label: `file-${index}`,
  inputs: {},
  state,
  runId: null,
  previousRunIds: [],
  run: null,
});

describe("bot batch changes", () => {
  it("updates a listed batch and its items, and adds new batches to pages that show them", () => {
    const at = "2026-10-20T10:00:00.000Z";
    const listed = batch("old", "x", at, "running");
    const changes = [
      { _tag: "batch", batch: batch("old", "x", at, "finished") },
      { _tag: "batch", batch: batch("new", "y", "2026-10-20T11:00:00.000Z", "running") },
      { _tag: "batch-item", batchId: "old", item: item(1, "skipped") },
    ] as const;
    const folded = changes.reduce(foldBotBatchChange, EMPTY_BOT_BATCH_CHANGES);

    expect(
      applyBatchChanges([listed], folded, { includeNew: true }).map(({ id, status }) => [
        id,
        status,
      ]),
    ).toEqual([
      ["new", "running"],
      ["old", "finished"],
    ]);
    expect(applyBatchChanges([listed], folded, { botId: "x", includeNew: true })).toHaveLength(1);
    const applied = applyBatchItemChanges(
      { batch: listed, items: [item(0, "started"), item(1, "pending")] },
      folded,
    );
    expect(applied.batch.status).toBe("finished");
    expect(applied.items.map(({ state }) => state)).toEqual(["started", "skipped"]);
  });
});

describe("bots inbox", () => {
  const failed = (id: string, createdAt: string, fields: Partial<BotRun> = {}) => ({
    ...run(id, "reviewer", createdAt, "failed"),
    ...fields,
  });

  it("keeps the first page and its total current as runs cross into and out of the inbox", () => {
    const page = {
      runs: [failed("r2", "2026-10-20T12:00:00.000Z"), failed("r1", "2026-10-20T11:00:00.000Z")],
      total: 5,
      hasMore: true,
    };
    const changes = fold(
      { _tag: "run", run: failed("r3", "2026-10-20T13:00:00.000Z") },
      { _tag: "run", run: failed("r2", "2026-10-20T12:00:00.000Z", { retriedBy: "r4" }) },
      { _tag: "run", run: run("r4", "reviewer", "2026-10-20T14:00:00.000Z", "running") },
      { _tag: "run", run: failed("r0", "2026-10-20T09:00:00.000Z", { dismissedAt: "x" }) },
    );
    const inbox = applyInboxChanges(page, changes, { dismissed: false });
    expect(inbox.runs.map((entry) => entry.id)).toEqual(["r3", "r1"]);
    expect(inbox.total).toBe(5);

    const dismissed = applyInboxChanges(
      { runs: [], total: 0, hasMore: false },
      fold({ _tag: "run", run: failed("r1", "2026-10-20T11:00:00.000Z", { dismissedAt: "x" }) }),
      { dismissed: true },
    );
    expect(dismissed).toMatchObject({ total: 1, runs: [{ id: "r1" }] });
  });
});

describe("waitingBotRunThreads", () => {
  const shell = (id: string, fields: Partial<EnvironmentThreadShell>) =>
    ({
      environmentId: EnvironmentId.make("env"),
      id: ThreadId.make(id),
      title: id,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      archivedAt: null,
      updatedAt: "2026-10-20T10:00:00.000Z",
      ...fields,
    }) as EnvironmentThreadShell;

  it("lists bot runs that wait on a person and nothing else", () => {
    const waiting = waitingBotRunThreads([
      shell("bot-run-a", { hasPendingApprovals: true }),
      shell("bot-run-b", { hasPendingUserInput: true, updatedAt: "2026-10-20T11:00:00.000Z" }),
      shell("bot-run-c", {}),
      shell("bot-run-d", { hasPendingApprovals: true, archivedAt: "2026-10-20T12:00:00.000Z" }),
      shell("thread-e", { hasPendingApprovals: true }),
    ]);
    expect(waiting.map((thread) => thread.id)).toEqual(["bot-run-b", "bot-run-a"]);
  });
});

const trigger = (id: string, botId: string, createdAt: string, name = id): BotTrigger => ({
  id,
  botId,
  name,
  event: { kind: "merge-conflict" },
  mapping: {},
  enabled: true,
  cooldownMinutes: 0,
  dailyLimit: 10,
  followLatest: false,
  pinnedVersion: 1,
  createdBy: "user",
  createdAt,
  updatedAt: createdAt,
  lastFiredAt: null,
});

const firing = (id: string, triggerId: string, firedAt: string): BotTriggerFiring => ({
  id,
  triggerId,
  eventKey: id,
  eventSummary: id,
  firedAt,
  outcome: "run",
  runId: null,
  reason: null,
});

describe("bot trigger changes", () => {
  const first = "trg_00000000000000000001";
  const second = "trg_00000000000000000002";
  const other = "trg_00000000000000000003";

  it("edits, adds and removes listed triggers, keeping a bot's page to that bot", () => {
    const listed = [trigger(first, "a", "2026-10-20T10:00:00.000Z")];
    const changes = [
      {
        _tag: "trigger" as const,
        trigger: trigger(first, "a", "2026-10-20T10:00:00.000Z", "Renamed"),
      },
      { _tag: "trigger" as const, trigger: trigger(second, "a", "2026-10-20T09:00:00.000Z") },
      { _tag: "trigger" as const, trigger: trigger(other, "b", "2026-10-20T11:00:00.000Z") },
    ].reduce(foldBotTriggerChange, EMPTY_BOT_TRIGGER_CHANGES);

    expect(applyTriggerChanges(listed, changes, "a").map((t) => [t.id, t.name])).toEqual([
      [second, second],
      [first, "Renamed"],
    ]);
    expect(applyTriggerChanges(listed, changes).map((t) => t.id)).toEqual([second, first, other]);

    const deleted = foldBotTriggerChange(changes, { _tag: "trigger-deleted", triggerId: first });
    expect(applyTriggerChanges(listed, deleted, "a").map((t) => t.id)).toEqual([second]);
  });

  it("puts new firings in front of a fetched page without repeating one", () => {
    const listed = [firing("f1", first, "2026-10-20T10:00:00.000Z")];
    const changes = [
      firing("f2", first, "2026-10-20T10:05:00.000Z"),
      firing("f1", first, "2026-10-20T10:00:00.000Z"),
      firing("f3", other, "2026-10-20T10:06:00.000Z"),
    ].reduce(
      (current, next) => foldBotTriggerChange(current, { _tag: "firing", firing: next }),
      EMPTY_BOT_TRIGGER_CHANGES,
    );
    expect(applyFiringChanges(listed, changes, first).map((f) => f.id)).toEqual(["f1", "f2"]);
  });
});

describe("bot versions", () => {
  it("diffs the instructions as text and every other changed field as before and after", () => {
    const before = bot("a", "Reviewer");
    const after = {
      ...before,
      instructions: "Do it carefully.",
      timeoutMinutes: 10,
      modelSelection: { model: "test", instanceId: ProviderInstanceId.make("codex") },
      budget: { runsPerDay: 5 },
    };
    const diff = botVersionDiff(before, after);
    expect(diff.instructions).toEqual({ before: "Do it.", after: "Do it carefully." });
    expect(diff.fields).toEqual([
      { field: "timeoutMinutes", label: "Timeout (minutes)", before: "5", after: "10" },
      {
        field: "budget",
        label: "Budget",
        before: "None",
        after: JSON.stringify({ runsPerDay: 5 }, null, 2),
      },
    ]);
    expect(botVersionDiff(before, before)).toEqual({ instructions: null, fields: [] });
  });

  it("formats a replay summary and a version label", () => {
    expect(formatReplaySummary({ fixed: 2, broke: 0, same: 8, changed: 0, failed: 0 })).toBe(
      "Fixed 2, broke 0, same 8",
    );
    expect(formatReplaySummary({ fixed: 0, broke: 1, same: 0, changed: 3, failed: 1 })).toBe(
      "Fixed 0, broke 1, same 0, changed 3, failed 1",
    );
    expect(botVersionLabel({ version: 4, stableVersion: 2 })).toBe("v4, stable v2");
    expect(botVersionLabel({ version: 4, stableVersion: 4 })).toBe("v4");
    expect(botVersionLabel({ version: 4 })).toBe("v4");
  });
});
