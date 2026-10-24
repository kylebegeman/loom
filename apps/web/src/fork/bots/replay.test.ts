import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import {
  BOTS_REPLAY_MAX_RUNS,
  type BotReplay,
  type BotRun,
  type BotVerdictValue,
} from "@t3tools/contracts/fork";
import {
  currentReplay,
  defaultReplaySelection,
  replayHeadline,
  replayInputSummary,
  replayCandidates,
  replayRunsById,
  filterReplayCandidates,
  toggleReplaySelection,
  replayCheckoutWarning,
  replayMetricChanges,
  type ReplayOutcomeFilter,
  type ReplayRatingFilter,
} from "./replay";

const run = (id: string, patch: Partial<BotRun> = {}): BotRun => ({
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
  startedAt: null,
  finishedAt: null,
  result: null,
  resultTruncated: false,
  error: null,
  ...patch,
});

describe("replay selection", () => {
  it("offers finished runs of the bot that were not replays", () => {
    const runs = [
      run("a"),
      run("b", { status: "running" }),
      run("c", { replayId: "replay-1" }),
      run("d", { botId: "other" }),
      run("e", { status: "failed" }),
    ];
    expect(replayCandidates(runs, "reviewer").map((candidate) => candidate.id)).toEqual(["a", "e"]);
  });

  it("picks rated runs, or the newest few when none are rated", () => {
    const unrated = ["a", "b", "c", "d"].map((id) => run(id));
    expect(defaultReplaySelection(unrated, 2)).toEqual(["a", "b"]);
    const rated = [run("a"), run("b", { rating: "down" }), run("c", { rating: "up" })];
    expect(defaultReplaySelection(rated, 2)).toEqual(["b", "c"]);
  });
});

describe("replay rows", () => {
  it("still finds an original after the replay's runs push it off the list", () => {
    const original = run("old", { result: "Before." });
    const byId = replayRunsById(
      [original],
      [run("replay-1", { status: "queued" })],
      [run("replay-1", { status: "running" })],
    );
    expect(byId.get("old")).toBe(original);
    expect(byId.get("replay-1")?.status).toBe("running");
  });
});

describe("replay filters", () => {
  it("combines verdict and rating filters without treating a fail verdict as a failed run", () => {
    const verdict = (value: BotVerdictValue) => ({
      verdict: value,
      summary: value,
      findings: [],
      findingsTruncated: false,
      source: "decoded" as const,
    });
    const candidates = replayCandidates(
      [
        run("pass", { verdict: verdict("pass"), rating: "up", createdAt: "2026-10-21T10:00:00Z" }),
        run("bad", { verdict: verdict("fail"), rating: "down" }),
        run("failed", { status: "failed", rating: "down" }),
        run("timeout", { status: "timed_out" }),
        run("attention", { verdict: verdict("needs_attention") }),
      ],
      "reviewer",
    );
    const ids = (outcome: ReplayOutcomeFilter, rating: ReplayRatingFilter = "all") =>
      filterReplayCandidates(candidates, { outcome, rating }).map((candidate) => candidate.id);
    expect(ids("all", "rated")).toEqual(["pass", "bad", "failed"]);
    expect(ids("fail", "down")).toEqual(["bad"]);
    expect(ids("failed")).toEqual(["failed", "timeout"]);
    expect(ids("failed", "unrated")).toEqual(["timeout"]);
    expect(ids("needs_attention")).toEqual(["attention"]);
    expect(ids("pass", "down")).toEqual([]);
  });

  it("keeps selected originals while changing pages, deduplicates, and enforces the replay cap", () => {
    const original = run("chosen", { inputs: { pr: "94" }, result: "Original result." });
    let selected = toggleReplaySelection([], original, true);
    expect(toggleReplaySelection(selected, original, true)).toBe(selected);
    for (let index = 0; index < BOTS_REPLAY_MAX_RUNS + 2; index++)
      selected = toggleReplaySelection(selected, run(`page-two-${index}`), true);
    expect(selected).toHaveLength(BOTS_REPLAY_MAX_RUNS);
    expect(selected[0]).toBe(original);
    const retained = replayRunsById(selected, [run("newest")], []);
    expect(retained.get(original.id)?.inputs).toEqual({ pr: "94" });
    selected = toggleReplaySelection(selected, original, false);
    expect(selected.some((candidate) => candidate.id === original.id)).toBe(false);
  });
});

describe("replay workspace warning", () => {
  it("warns for both checkout modes and leaves worktrees and scratch unblocked", () => {
    expect(replayCheckoutWarning({ workspace: { type: "scratch" } })).toBeNull();
    expect(
      replayCheckoutWarning({ workspace: { type: "project", projectId: null, worktree: true } }),
    ).toBeNull();
    expect(
      replayCheckoutWarning({ workspace: { type: "project", projectId: null, worktree: false } }),
    ).toContain("project checkout");
    expect(
      replayCheckoutWarning({
        workspace: { type: "project", projectId: null, worktree: false, checkout: "caller" },
      }),
    ).toContain("recorded checkouts");
  });
});

describe("replay metric comparisons", () => {
  const usage = (
    inputTokens: number,
    outputTokens: number,
    status: "complete" | "partial" | "unavailable" = "complete",
  ) => ({ inputTokens, outputTokens, cachedInputTokens: inputTokens / 2, status });
  const before = run("before", {
    startedAt: "2026-10-20T10:00:00Z",
    finishedAt: "2026-10-20T10:02:00Z",
    usage: usage(800, 200),
  });

  it("shows absolute and proportional changes without double-counting cached input", () => {
    const after = { ...before, finishedAt: "2026-10-20T10:01:00Z", usage: usage(1000, 500) };
    expect(replayMetricChanges(before, after)).toEqual({
      duration: "1m faster (50%)",
      tokens: "500 more tokens (50%)",
    });
    expect(replayMetricChanges(after, before)).toEqual({
      duration: "1m slower (100%)",
      tokens: "500 fewer tokens (33%)",
    });
    expect(replayMetricChanges(before, before)).toEqual({
      duration: "Same duration",
      tokens: "Same token use",
    });
  });

  it("does not invent comparisons from missing or partial metrics, or divide by zero", () => {
    expect(replayMetricChanges(before, undefined)).toEqual({ duration: null, tokens: null });
    expect(
      replayMetricChanges(before, {
        ...before,
        startedAt: null,
        usage: usage(400, 100, "partial"),
      }),
    ).toEqual({ duration: null, tokens: null });
    expect(
      replayMetricChanges(before, { ...before, usage: usage(0, 0, "unavailable") }).tokens,
    ).toBeNull();
    expect(replayMetricChanges({ ...before, usage: usage(0, 0) }, before).tokens).toBe(
      "1,000 more tokens",
    );
  });
});

describe("replay results", () => {
  const replay = (patch: Partial<BotReplay> = {}): BotReplay => ({
    id: "replay-1",
    botId: "reviewer",
    source: { kind: "version", version: 2 },
    baseVersion: 3,
    createdAt: "2026-10-22T17:00:00Z",
    finishedAt: null,
    status: "running",
    items: [
      { originalRunId: "a", replayRunId: "ra", comparison: "pending", reason: null },
      { originalRunId: "b", replayRunId: "rb", comparison: "fixed", reason: null },
    ],
    summary: { fixed: 1, broke: 0, same: 0, changed: 0, failed: 0 },
    ...patch,
  });

  it("keeps a cancel's answer over a fetch that still says running, but not over a finished one", () => {
    const started = replay();
    const cancelled = replay({ status: "cancelled" });
    expect(currentReplay(started, null, null)).toBe(started);
    expect(currentReplay(started, replay(), cancelled)).toBe(cancelled);
    const done = replay({ status: "done" });
    expect(currentReplay(started, done, cancelled)).toBe(done);
  });

  it("says whether the replayed definition did better or worse", () => {
    expect(replayHeadline(replay())).toBe("Replaying. 1 of 2 runs done.");
    const settled = (summary: BotReplay["summary"], status: BotReplay["status"] = "done") =>
      replayHeadline(
        replay({
          status,
          summary,
          items: [{ originalRunId: "a", replayRunId: "ra", comparison: "same", reason: null }],
        }),
      );
    expect(settled({ fixed: 2, broke: 1, same: 0, changed: 0, failed: 0 })).toBe(
      "Done. Better on 2 runs, worse on 1 run.",
    );
    expect(settled({ fixed: 0, broke: 1, same: 3, changed: 0, failed: 0 })).toBe(
      "Done. Worse on 1 run, better on none.",
    );
    expect(settled({ fixed: 0, broke: 0, same: 1, changed: 2, failed: 0 }, "cancelled")).toBe(
      "Cancelled. No better or worse; 2 runs answered differently.",
    );
    expect(settled({ fixed: 0, broke: 0, same: 0, changed: 0, failed: 1 })).toBe(
      "Done. 1 run could not be replayed.",
    );
    expect(
      replayHeadline(replay({ status: "cancelled", items: [], summary: replay().summary })),
    ).toBe("Cancelled. No run finished.");
  });

  it("names each input once, in the order the run recorded them", () => {
    expect(replayInputSummary(run("x", { inputs: { pr: "94", draft: true } }))).toBe(
      "pr: 94, draft: true",
    );
    expect(replayInputSummary(run("y"))).toBe("");
  });
});
