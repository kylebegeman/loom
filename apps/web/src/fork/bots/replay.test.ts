import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import { BOTS_REPLAY_MAX_RUNS, type BotRun, type BotVerdictValue } from "@t3tools/contracts/fork";
import {
  defaultReplaySelection,
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
