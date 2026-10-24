import type { BotUsageRow, BotVerdictValue } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  budgetLevel,
  hasFailures,
  lastRunState,
  matchesBotFilters,
  matchesBotSearch,
  runOutcomeLabel,
  runsByBot,
  sortBots,
  successFigure,
  type BotFacts,
  type BotFilters,
} from "./botsCollection";
import { makeBotDefinition, makeBotRun } from "./testFixtures";

const verdict = (value: BotVerdictValue) => ({
  verdict: value,
  summary: "",
  findings: [],
  findingsTruncated: false,
  source: "decoded" as const,
});

const usageRow = (patch: Partial<BotUsageRow> = {}): BotUsageRow => ({
  botId: "reviewer",
  botName: "Reviewer",
  runs: 0,
  completed: 0,
  failed: 0,
  timedOut: 0,
  cancelled: 0,
  pass: 0,
  fail: 0,
  needsAttention: 0,
  successRate: null,
  medianDurationMs: null,
  maxDurationMs: null,
  tokens: { input: 0, cachedInput: 0, output: 0, total: 0 },
  usageComplete: true,
  byModel: [],
  ...patch,
});

const facts = (patch: Partial<BotFacts> = {}): BotFacts => ({
  recent: [],
  row: undefined,
  budget: undefined,
  needsYou: 0,
  ...patch,
});

const NO_FILTERS: BotFilters = { query: "", states: new Set(), origins: new Set() };

describe("matchesBotSearch", () => {
  const bot = makeBotDefinition({
    name: "Release checker",
    description: "Checks a release branch before it ships.",
  });

  it("finds a bot by any word of its name, description, id or inputs", () => {
    expect(matchesBotSearch(bot, "release")).toBe(true);
    expect(matchesBotSearch(bot, "ships")).toBe(true);
    expect(matchesBotSearch(bot, "reviewer")).toBe(true);
    expect(matchesBotSearch(bot, "pull request")).toBe(true);
    expect(matchesBotSearch(bot, "pr")).toBe(true);
  });

  it("needs every word to match, in any order and case", () => {
    expect(matchesBotSearch(bot, "  CHECKER   release ")).toBe(true);
    expect(matchesBotSearch(bot, "release deploy")).toBe(false);
  });

  it("matches everything for an empty query", () => {
    expect(matchesBotSearch(bot, "   ")).toBe(true);
  });
});

describe("hasFailures", () => {
  it("trusts the window's usage over the newest runs", () => {
    const failedRecently = [makeBotRun("a", { status: "failed" })];
    expect(hasFailures({ row: usageRow({ completed: 3 }), recent: failedRecently })).toBe(false);
    expect(hasFailures({ row: usageRow({ timedOut: 1 }), recent: [] })).toBe(true);
    expect(hasFailures({ row: usageRow({ fail: 1 }), recent: [] })).toBe(true);
  });

  it("falls back to the newest runs without usage, counting failed verdicts", () => {
    expect(hasFailures({ row: undefined, recent: [makeBotRun("a")] })).toBe(false);
    expect(
      hasFailures({ row: undefined, recent: [makeBotRun("a", { verdict: verdict("fail") })] }),
    ).toBe(true);
    expect(
      hasFailures({ row: undefined, recent: [makeBotRun("a", { status: "timed_out" })] }),
    ).toBe(true);
  });
});

describe("budgetLevel", () => {
  it("is null for a bot without a limit", () => {
    expect(budgetLevel(undefined)).toBeNull();
    expect(budgetLevel({ runsInWindow: 40, tokensInWindow: 9_000 })).toBeNull();
  });

  it("reads the closer of the two limits", () => {
    expect(budgetLevel({ runsInWindow: 2, tokensInWindow: 0, runsPerDay: 10 })).toBe("clear");
    expect(
      budgetLevel({
        runsInWindow: 1,
        tokensInWindow: 85_000,
        runsPerDay: 10,
        tokensPerDay: 100_000,
      }),
    ).toBe("near");
    expect(budgetLevel({ runsInWindow: 10, tokensInWindow: 0, runsPerDay: 10 })).toBe("at");
  });

  it("is at its limit whenever the server says when the next run may start", () => {
    expect(
      budgetLevel({
        runsInWindow: 0,
        tokensInWindow: 0,
        runsPerDay: 10,
        retryAt: "2026-10-23T12:00:00.000Z",
      }),
    ).toBe("at");
  });
});

describe("matchesBotFilters", () => {
  const starter = makeBotDefinition({
    id: "verifier",
    origin: { kind: "starter", starterId: "verifier", revision: 1 },
  });
  const custom = makeBotDefinition({ id: "release" });

  it("splits starters from bots people wrote", () => {
    const starters: BotFilters = { ...NO_FILTERS, origins: new Set(["starter"]) };
    expect(matchesBotFilters(starter, facts(), starters)).toBe(true);
    expect(matchesBotFilters(custom, facts(), starters)).toBe(false);
  });

  it("keeps a bot that is in any chosen state", () => {
    const trouble: BotFilters = { ...NO_FILTERS, states: new Set(["attention", "budget"]) };
    expect(matchesBotFilters(custom, facts({ needsYou: 2 }), trouble)).toBe(true);
    expect(
      matchesBotFilters(
        custom,
        facts({ budget: { runsInWindow: 9, tokensInWindow: 0, runsPerDay: 10 } }),
        trouble,
      ),
    ).toBe(true);
    expect(
      matchesBotFilters(
        custom,
        facts({ budget: { runsInWindow: 1, tokensInWindow: 0, runsPerDay: 10 } }),
        trouble,
      ),
    ).toBe(false);
  });

  it("applies the search as well as the states", () => {
    const filters: BotFilters = {
      query: "verifier",
      states: new Set(["attention"]),
      origins: new Set(),
    };
    expect(matchesBotFilters(custom, facts({ needsYou: 1 }), filters)).toBe(false);
    expect(matchesBotFilters(starter, facts({ needsYou: 1 }), filters)).toBe(true);
  });
});

describe("sortBots", () => {
  const alpha = makeBotDefinition({
    id: "alpha",
    name: "alpha",
    updatedAt: "2026-10-01T00:00:00Z",
  });
  const beta = makeBotDefinition({ id: "beta", name: "Beta", updatedAt: "2026-10-22T00:00:00Z" });
  const gamma = makeBotDefinition({
    id: "gamma",
    name: "Gamma",
    updatedAt: "2026-09-01T00:00:00Z",
  });
  const recent = runsByBot([
    makeBotRun("g1", { botId: "gamma", createdAt: "2026-10-23T09:00:00Z" }),
  ]);
  const factsOf = (bot: { id: string }) =>
    facts({
      recent: recent.get(bot.id) ?? [],
      row:
        bot.id === "alpha"
          ? usageRow({ tokens: { input: 0, cachedInput: 0, output: 0, total: 900 } })
          : undefined,
    });

  it("puts the latest run or edit first", () => {
    expect(sortBots([alpha, beta, gamma], "activity", factsOf).map((bot) => bot.id)).toEqual([
      "gamma",
      "beta",
      "alpha",
    ]);
  });

  it("sorts names without regard to case", () => {
    expect(sortBots([gamma, beta, alpha], "name", factsOf).map((bot) => bot.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });

  it("puts bots with no usage after those that used tokens", () => {
    expect(sortBots([beta, gamma, alpha], "tokens", factsOf).map((bot) => bot.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
  });
});

describe("successFigure", () => {
  it("is a pass rate once the bot returns verdicts", () => {
    expect(successFigure(usageRow({ completed: 5, pass: 3, fail: 1, needsAttention: 1 }))).toEqual({
      label: "Passed",
      share: 0.6,
      detail: "3 of 5",
    });
  });

  it("is a completion rate otherwise, leaving cancelled runs out", () => {
    expect(successFigure(usageRow({ completed: 3, failed: 1, cancelled: 4 }))).toEqual({
      label: "Completed",
      share: 0.75,
      detail: "3 of 4",
    });
  });

  it("says nothing without a finished run or without usage", () => {
    expect(successFigure(usageRow({ cancelled: 2 }))).toBeNull();
    expect(successFigure(undefined)).toBeNull();
  });
});

describe("lastRunState", () => {
  it("names the newest run when the bot has one", () => {
    const run = makeBotRun("a");
    expect(lastRunState([run], true)).toEqual({ kind: "run", run });
  });

  it("only claims no runs when the newest runs are every run", () => {
    expect(lastRunState([], false)).toEqual({ kind: "none" });
    expect(lastRunState([], true)).toEqual({ kind: "older" });
  });
});

describe("runOutcomeLabel", () => {
  it("prefers a completed run's verdict to its status", () => {
    expect(runOutcomeLabel(makeBotRun("a", { verdict: verdict("needs_attention") }))).toBe(
      "Needs attention",
    );
    expect(runOutcomeLabel(makeBotRun("b", { status: "timed_out" }))).toBe("Timed out");
  });
});
