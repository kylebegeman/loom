import { describe, expect, it } from "vite-plus/test";
import type { BotBatch, BotBatchCounts, BotBatchItem, BotRun } from "@t3tools/contracts/fork";
import {
  batchNeedsRetry,
  batchPlanSentence,
  batchSegments,
  batchState,
  batchStatusCounts,
  batchVitals,
  budgetNote,
  cancelBatchMessage,
  countLines,
  filterBatches,
  filterItems,
  groupBatches,
  itemOutcome,
  itemParameterNote,
  itemTickTone,
  retryChoice,
  retryPlan,
  runOnManyBlocker,
  runOnManyLabel,
  sharedInputErrors,
} from "./batches";
import { makeBotDefinition, makeBotRun } from "./testFixtures";

const NO_COUNTS: BotBatchCounts = {
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
};

const makeBatch = (id: string, patch: Partial<BotBatch> = {}): BotBatch => ({
  id: id as BotBatch["id"],
  botId: "reviewer" as BotBatch["botId"],
  botVersion: 2,
  botName: "Reviewer",
  projectId: null,
  sourceType: "glob",
  sourceSummary: "src/**/*.ts, 3 files",
  itemParameter: "pr",
  sharedInputs: {},
  status: "finished",
  note: null,
  total: 3,
  counts: { ...NO_COUNTS, completed: 3 },
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  finishedAt: "2026-10-20T10:05:00.000Z",
  ...patch,
});

let nextIndex = 0;
const makeItem = (patch: Partial<BotBatchItem> & { run?: BotRun | null } = {}): BotBatchItem => {
  const index = nextIndex++;
  const run = patch.run === undefined ? makeBotRun(`run-${index}`) : patch.run;
  return {
    index,
    label: `item-${index}`,
    inputs: {},
    state: "started",
    runId: run?.id ?? null,
    previousRunIds: [],
    run,
    ...patch,
  };
};

const failedRun = (id: string) => makeBotRun(id, { status: "failed", error: "Broke." });
const verdictRun = (id: string, verdict: "pass" | "fail" | "needs_attention") =>
  makeBotRun(id, {
    verdict: {
      verdict,
      summary: `${verdict} summary`,
      findings: [],
      findingsTruncated: false,
      source: "decoded",
    },
  });

describe("the batches index", () => {
  const running = makeBatch("running", {
    status: "running",
    counts: { ...NO_COUNTS, running: 1, pending: 2 },
  });
  const clean = makeBatch("clean", { sourceSummary: "Pasted lines, 3 items" });
  const failed = makeBatch("failed", {
    botName: "Fixer",
    counts: { ...NO_COUNTS, completed: 2, failed: 1 },
  });
  const attention = makeBatch("attention", {
    counts: { ...NO_COUNTS, completed: 3, needsAttention: 1 },
  });
  const cancelled = makeBatch("cancelled", {
    status: "cancelled",
    counts: { ...NO_COUNTS, completed: 1, skipped: 2 },
  });
  const all = [running, clean, failed, attention, cancelled];

  it("groups running batches apart from settled ones, keeping the list's order", () => {
    const { running: live, earlier } = groupBatches(all);
    expect(live.map((batch) => batch.id)).toEqual(["running"]);
    expect(earlier.map((batch) => batch.id)).toEqual(["clean", "failed", "attention", "cancelled"]);
  });

  it("counts a settled batch with failures or items needing attention as needing a retry", () => {
    expect(batchNeedsRetry(failed)).toBe(true);
    expect(batchNeedsRetry(attention)).toBe(true);
    expect(batchNeedsRetry(clean)).toBe(false);
    // Skipped items cannot be retried, so a cancelled batch with only those is not offered.
    expect(batchNeedsRetry(cancelled)).toBe(false);
    // A running batch cannot be retried until it settles, whatever has failed so far.
    expect(
      batchNeedsRetry(
        makeBatch("live-fail", { status: "running", counts: { ...NO_COUNTS, fail: 1 } }),
      ),
    ).toBe(false);
  });

  it("filters by status and by a search over the source and the bot", () => {
    const ids = (status: "all" | "running" | "retry", query: string) =>
      filterBatches(all, { status, query }).map((batch) => batch.id);
    expect(ids("running", "")).toEqual(["running"]);
    expect(ids("retry", "")).toEqual(["failed", "attention"]);
    expect(ids("all", "  FIXER ")).toEqual(["failed"]);
    expect(ids("all", "pasted")).toEqual(["clean"]);
    expect(ids("retry", "pasted")).toEqual([]);
    expect(batchStatusCounts(all)).toEqual({ all: 5, running: 1, retry: 2 });
  });

  it("shows a running batch held by its budget as paused", () => {
    expect(batchState(running)).toEqual({ label: "Running", tone: "active" });
    expect(batchState({ ...running, pausedUntil: "2026-10-21T00:00:00.000Z" })).toEqual({
      label: "Paused",
      tone: "warning",
    });
    expect(batchState({ ...cancelled, pausedUntil: "2026-10-21T00:00:00.000Z" }).label).toBe(
      "Cancelled",
    );
  });

  it("says what cancelling stops before it happens", () => {
    expect(cancelBatchMessage({ ...NO_COUNTS, running: 1, queued: 1, pending: 26 })).toBe(
      "Cancel this batch? 2 runs in progress stop and 26 waiting items are skipped. Cancelled and skipped items cannot be retried.",
    );
    expect(cancelBatchMessage({ ...NO_COUNTS, running: 1 })).toBe(
      "Cancel this batch? 1 run in progress stops. Cancelled and skipped items cannot be retried.",
    );
  });

  it("tones timed-out items as warnings in the bar, as their ticks are", () => {
    const segments = batchSegments({ ...NO_COUNTS, completed: 2, timedOut: 1, failed: 1 });
    expect(segments.find((segment) => segment.key === "attention")?.count).toBe(1);
    expect(segments.find((segment) => segment.key === "failed")?.count).toBe(1);
    expect(segments.find((segment) => segment.key === "passed")?.count).toBe(2);
  });
});

describe("batch items", () => {
  it("gives every toned tick a run to open", () => {
    const items = [
      makeItem({ state: "pending", run: null, runId: null }),
      makeItem({ state: "skipped", run: null, runId: null }),
      makeItem({ run: null }),
      makeItem({ run: makeBotRun("queued", { status: "queued" }) }),
      makeItem({ run: makeBotRun("cancelled", { status: "cancelled" }) }),
      makeItem({ run: makeBotRun("timed", { status: "timed_out" }) }),
    ];
    expect(items.map((item) => itemOutcome(item).label)).toEqual([
      "Waiting",
      "Skipped",
      "Not stored",
      "Queued",
      "Cancelled",
      "Timed out",
    ]);
    for (const item of items) if (itemTickTone(item) !== null) expect(item.run).not.toBeNull();
    expect(items.map(itemTickTone)).toEqual([null, null, null, null, "neutral", "warning"]);
  });

  it("reads a verdict over a plain completion", () => {
    expect(itemOutcome(makeItem({ run: verdictRun("a", "fail") }))).toEqual({
      key: "failed",
      label: "Fail",
    });
    expect(itemOutcome(makeItem({ run: verdictRun("b", "pass") })).label).toBe("Pass");
    expect(itemOutcome(makeItem())).toEqual({ key: "passed", label: "Completed" });
  });

  it("filters items by outcome and label", () => {
    const items = [
      makeItem({ label: "src/a.ts", run: failedRun("a") }),
      makeItem({ label: "src/b.ts" }),
      makeItem({ label: "docs/c.md", run: failedRun("c") }),
    ];
    expect(filterItems(items, { outcome: "failed", query: "" }).map((item) => item.label)).toEqual([
      "src/a.ts",
      "docs/c.md",
    ]);
    expect(
      filterItems(items, { outcome: "failed", query: "SRC" }).map((item) => item.label),
    ).toEqual(["src/a.ts"]);
    expect(filterItems(items, { outcome: "all", query: "" })).toHaveLength(3);
  });

  it("plans a retry the way the server picks items, leaving out exhausted ones", () => {
    const items = [
      makeItem({ run: failedRun("f1") }),
      makeItem({ run: verdictRun("f2", "fail") }),
      makeItem({ run: makeBotRun("t", { status: "timed_out" }) }),
      makeItem({ run: verdictRun("n", "needs_attention") }),
      makeItem({ run: verdictRun("p", "pass") }),
      makeItem({ run: makeBotRun("c", { status: "cancelled" }) }),
      makeItem({ state: "skipped", run: null, runId: null }),
      makeItem({
        label: "tired",
        run: failedRun("x"),
        previousRunIds: ["1", "2", "3", "4"] as BotBatchItem["previousRunIds"],
      }),
    ];
    const plan = retryPlan(items);
    expect(plan).toEqual({ failed: 3, attention: 1, exhausted: ["tired"] });
    expect(retryChoice(plan, false)).toEqual({
      include: "failed",
      count: 3,
      label: "Retry 3 failed",
    });
    expect(retryChoice(plan, true)).toEqual({
      include: "failed_and_attention",
      count: 4,
      label: "Retry 4",
    });
  });

  it("retries items needing attention when nothing else failed", () => {
    expect(retryChoice({ failed: 0, attention: 2, exhausted: [] }, false)).toEqual({
      include: "failed_and_attention",
      count: 2,
      label: "Retry 2 needing attention",
    });
    expect(retryChoice({ failed: 0, attention: 0, exhausted: ["a"] }, true).count).toBe(0);
  });

  it("measures pass rate, typical and slowest time, tokens and retries", () => {
    const run = (id: string, seconds: number, patch: Partial<BotRun> = {}) =>
      makeBotRun(id, {
        startedAt: "2026-10-20T10:00:00.000Z",
        finishedAt: new Date(Date.parse("2026-10-20T10:00:00.000Z") + seconds * 1000).toISOString(),
        ...patch,
      });
    const vitals = batchVitals([
      makeItem({
        run: run("a", 10, {
          usage: { status: "complete", inputTokens: 100, cachedInputTokens: 0, outputTokens: 20 },
        }),
      }),
      makeItem({
        run: run("b", 30, { status: "failed" }),
        previousRunIds: ["z"] as BotBatchItem["previousRunIds"],
      }),
      makeItem({ run: run("c", 20) }),
      makeItem({ state: "pending", run: null, runId: null }),
    ]);
    expect(vitals).toEqual({
      passed: 2,
      judged: 3,
      typicalMs: 20_000,
      slowestMs: 30_000,
      tokens: 120,
      retried: 1,
    });
  });
});

describe("run on many", () => {
  const bot = makeBotDefinition({
    name: "Reviewer",
    version: 3,
    maxConcurrentRuns: 2,
    timeoutMinutes: 5,
    parameters: [
      { name: "file", label: "File", type: "string", required: true },
      { name: "focus", label: "Focus", type: "string", required: true },
      { name: "depth", label: "Depth", type: "number", required: false },
      { name: "tone", label: "Tone", type: "choice", required: false, choices: ["kind", "blunt"] },
    ],
  });

  it("checks only the inputs every item shares", () => {
    expect(Object.keys(sharedInputErrors(bot.parameters, "file", {}))).toEqual(["focus"]);
    expect(Object.keys(sharedInputErrors(bot.parameters, "focus", { file: "a" }))).toEqual([]);
    expect(
      Object.keys(
        sharedInputErrors(bot.parameters, "file", { focus: "x", depth: "deep", tone: "rude" }),
      ),
    ).toEqual(["depth", "tone"]);
    expect(
      sharedInputErrors(bot.parameters, "file", { focus: "x", depth: "2", tone: "kind" }),
    ).toEqual({});
  });

  it("warns when items fill an input that is not free text", () => {
    expect(itemParameterNote(bot.parameters[0])).toBeNull();
    expect(itemParameterNote(bot.parameters[2])).toContain("takes a number");
    expect(itemParameterNote(bot.parameters[3])).toContain("kind, blunt");
    expect(itemParameterNote(undefined)).toBeNull();
  });

  it("says in one sentence what starting will do", () => {
    const here = { type: "here" } as const;
    expect(
      batchPlanSentence({ bot, total: 31, type: "glob", target: here, targetLabel: null }),
    ).toBe("31 runs of Reviewer v3, up to 2 at a time, each stopped after 5 minutes.");
    expect(
      batchPlanSentence({
        bot,
        total: 2,
        type: "lines",
        target: { type: "best" },
        targetLabel: null,
      }),
    ).toBe(
      "2 runs of Reviewer v3 on the best available computer, as slots free up, each stopped after 5 minutes.",
    );
    expect(
      batchPlanSentence({
        bot: { ...bot, maxConcurrentRuns: 1, timeoutMinutes: 1 },
        total: 19,
        type: "conflicts",
        target: { type: "environment", environmentId: "mini" as never },
        targetLabel: "Mini",
      }),
    ).toBe(
      "Resolves 19 conflicts with Reviewer v3 on Mini, as slots free up, each stopped after 1 minute.",
    );
    expect(
      batchPlanSentence({
        bot: { ...bot, maxConcurrentRuns: 1 },
        total: 4,
        type: "lines",
        target: here,
        targetLabel: null,
      }),
    ).toBe("4 runs of Reviewer v3, one at a time, each stopped after 5 minutes.");
    expect(
      batchPlanSentence({ bot, total: 1, type: "lines", target: here, targetLabel: null }),
    ).toBe("1 run of Reviewer v3, stopped after 5 minutes.");
  });

  it("notes a budget the batch would outrun", () => {
    expect(budgetNote({ budget: { runsPerDay: 10 } }, 31)).toContain(
      "more than its budget of 10 runs",
    );
    expect(budgetNote({ budget: { tokensPerDay: 5000 } }, 31)).toContain("can pause");
    expect(budgetNote({}, 31)).toBeNull();
  });

  it("labels the run button by source and count", () => {
    expect(runOnManyLabel("conflicts", 1)).toBe("Resolve the conflict");
    expect(runOnManyLabel("conflicts", 4)).toBe("Resolve all 4 conflicts");
    expect(runOnManyLabel("glob", 1)).toBe("Run on 1 item");
  });

  it("counts pasted lines as the server does", () => {
    expect(countLines("a\n\n  b \r\na\n   \nc")).toBe(3);
    expect(countLines("   ")).toBe(0);
  });

  it("puts reconnecting before the bot's own reasons", () => {
    const archived = { ...bot, archivedAt: "2026-10-21T00:00:00.000Z" };
    const bare = { ...bot, parameters: [] };
    expect(runOnManyBlocker({ connected: false, permitted: true, bot: archived })).toBe(
      "Offline. Reconnect to start a batch.",
    );
    expect(runOnManyBlocker({ connected: true, permitted: false, bot })).toBe(
      "This connection cannot start batches.",
    );
    expect(runOnManyBlocker({ connected: true, permitted: true, bot: archived })).toBe(
      "Restore Reviewer to run it.",
    );
    expect(runOnManyBlocker({ connected: true, permitted: true, bot: bare })).toContain(
      "takes no inputs",
    );
    expect(runOnManyBlocker({ connected: true, permitted: true, bot })).toBeNull();
    expect(runOnManyBlocker({ connected: true, permitted: true, bot: null })).toBeNull();
  });
});
