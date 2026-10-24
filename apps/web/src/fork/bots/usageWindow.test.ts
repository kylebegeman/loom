import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, UsageDay } from "@t3tools/contracts";
import { BotId } from "@t3tools/contracts/fork";
import {
  advanceUsageWindow,
  budgetAlertText,
  budgetAlerts,
  budgetCaption,
  budgetMeterText,
  budgetStatus,
  busiestTokens,
  emptyUsageRow,
  finishedRunsSignature,
  nextBudgetRetryMs,
  outcomeText,
  planUsageRefetch,
  platformName,
  reasonsText,
  remoteRuns,
  targetAvailability,
  tokenShare,
  usageClauseText,
  usagePageWindow,
  usageRate,
} from "./usageWindow";

const clock = (iso: string) => iso.slice(11, 16);

describe("usagePageWindow", () => {
  it("spans whole local days in the page's time zone", () => {
    expect(
      usagePageWindow({
        sinceDay: UsageDay.make("2026-10-14"),
        untilDay: UsageDay.make("2026-10-20"),
        timeZone: "America/Los_Angeles",
      }),
    ).toEqual({ since: "2026-10-14T07:00:00.000Z", until: "2026-10-21T07:00:00.000Z" });
  });

  it("keeps each end on local midnight across a DST change", () => {
    expect(
      usagePageWindow({
        sinceDay: UsageDay.make("2026-10-31"),
        untilDay: UsageDay.make("2026-11-01"),
        timeZone: "America/New_York",
      }),
    ).toEqual({ since: "2026-10-31T04:00:00.000Z", until: "2026-11-02T05:00:00.000Z" });
  });

  it("uses an hourly window's instants as they are", () => {
    expect(
      usagePageWindow({
        sinceDay: UsageDay.make("2026-10-19"),
        untilDay: UsageDay.make("2026-10-20"),
        timeZone: "Asia/Kolkata",
        resolution: "hour",
        sinceTime: "2026-10-19T09:13:00.000Z",
        untilTime: "2026-10-20T09:13:00.000Z",
      }),
    ).toEqual({ since: "2026-10-19T09:13:00.000Z", until: "2026-10-20T09:13:00.000Z" });
  });
});

describe("advanceUsageWindow", () => {
  const start = Date.parse("2026-10-23T10:15:20.000Z");
  const first = advanceUsageWindow({ since: "", until: "" }, 7, start);

  it("keeps the same window object within the minute, so the query stays one atom", () => {
    expect(first.until).toBe("2026-10-23T10:16:00.000Z");
    expect(first.since).toBe("2026-10-16T10:16:00.000Z");
    expect(advanceUsageWindow(first, 7, start + 30_000)).toBe(first);
  });

  it("moves once the minute turns", () => {
    const next = advanceUsageWindow(first, 7, start + 40_000);
    expect(next).not.toBe(first);
    expect(next.until).toBe("2026-10-23T10:17:00.000Z");
  });
});

describe("planUsageRefetch", () => {
  const ledger = { until: "u1", signature: "2:b", fetchedAt: 10_000 };

  it("adopts a window's first fetch instead of refetching it at once", () => {
    expect(planUsageRefetch(undefined, "u1", "2:b", 10_000)).toEqual({ kind: "adopt" });
    expect(planUsageRefetch(ledger, "u2", "3:c", 10_000)).toEqual({ kind: "adopt" });
  });

  it("does nothing while no run has finished since", () => {
    expect(planUsageRefetch(ledger, "u1", "2:b", 99_000)).toEqual({ kind: "none" });
  });

  it("refetches at most once per interval", () => {
    expect(planUsageRefetch(ledger, "u1", "3:c", 12_000)).toEqual({ kind: "wait", ms: 3_000 });
    expect(planUsageRefetch(ledger, "u1", "3:c", 15_000)).toEqual({ kind: "now" });
  });
});

describe("finishedRunsSignature", () => {
  it("moves when a dropped run is replaced by a newly finished one", () => {
    const before = finishedRunsSignature([
      { finishedAt: "2026-10-23T10:00:00.000Z" },
      { finishedAt: "2026-10-23T10:01:00.000Z" },
      { finishedAt: null },
    ]);
    const after = finishedRunsSignature([
      { finishedAt: "2026-10-23T10:01:00.000Z" },
      { finishedAt: "2026-10-23T10:02:00.000Z" },
      { finishedAt: null },
    ]);
    expect(before).toBe("2:2026-10-23T10:01:00.000Z");
    expect(after).not.toBe(before);
  });

  it("ignores runs still going", () => {
    expect(finishedRunsSignature([{ finishedAt: null }])).toBe("0:");
  });
});

describe("budgetStatus", () => {
  it("speaks for the tighter of two limits", () => {
    expect(
      budgetStatus({ runsInWindow: 10, runsPerDay: 50, tokensInWindow: 900, tokensPerDay: 1_000 }),
    ).toEqual({ level: "near", limit: "tokens", share: 0.9 });
  });

  it("is ok below the warning share", () => {
    expect(budgetStatus({ runsInWindow: 39, runsPerDay: 50, tokensInWindow: 0 })).toEqual({
      level: "ok",
      limit: "runs",
      share: 0.78,
    });
  });

  it("is blocked at the limit, or whenever the server says when to retry", () => {
    expect(budgetStatus({ runsInWindow: 50, runsPerDay: 50, tokensInWindow: 0 }).level).toBe(
      "blocked",
    );
    expect(
      budgetStatus({
        runsInWindow: 3,
        runsPerDay: 50,
        tokensInWindow: 0,
        retryAt: "2026-10-23T14:20:00.000Z",
      }).level,
    ).toBe("blocked");
  });

  it("has no limit for a budget with neither set", () => {
    expect(budgetStatus({ runsInWindow: 4, tokensInWindow: 10 })).toEqual({
      level: "ok",
      limit: null,
      share: 0,
    });
  });
});

describe("budget text", () => {
  it("states both limits' use and when the next run may start", () => {
    expect(
      budgetMeterText(
        {
          runsInWindow: 50,
          runsPerDay: 50,
          tokensInWindow: 1_200_000,
          tokensPerDay: 2_000_000,
          retryAt: "2026-10-23T14:20:00.000Z",
        },
        clock,
      ),
    ).toBe(
      "50 of 50 runs and 1.20M of 2M tokens in the last 24 hours. The next run is possible at 14:20.",
    );
  });

  it("reads singular limits and a budget with nothing set", () => {
    expect(budgetMeterText({ runsInWindow: 0, runsPerDay: 1, tokensInWindow: 0 })).toBe(
      "0 of 1 run in the last 24 hours.",
    );
    expect(budgetMeterText({ runsInWindow: 0, tokensInWindow: 0 })).toBe(
      "No limit is set for the last 24 hours.",
    );
  });

  it("captions a meter by where the bot stands", () => {
    expect(budgetCaption({ runsInWindow: 38, runsPerDay: 50, tokensInWindow: 0 })).toBe(
      "38 of 50 runs",
    );
    expect(budgetCaption({ runsInWindow: 45, runsPerDay: 50, tokensInWindow: 0 })).toBe(
      "45 of 50 runs, near limit",
    );
    expect(
      budgetCaption(
        {
          runsInWindow: 50,
          runsPerDay: 50,
          tokensInWindow: 0,
          retryAt: "2026-10-23T14:20:00.000Z",
        },
        clock,
      ),
    ).toBe("At limit until 14:20");
  });
});

describe("budget alerts", () => {
  const budgets = {
    a: { runsInWindow: 50, runsPerDay: 50, tokensInWindow: 0 },
    b: { runsInWindow: 41, runsPerDay: 50, tokensInWindow: 0 },
    c: { runsInWindow: 1, runsPerDay: 50, tokensInWindow: 0 },
  };

  it("counts bots at and near their limits", () => {
    expect(budgetAlerts(budgets)).toEqual({ blocked: 1, near: 1 });
  });

  it("reads one sentence for the header", () => {
    expect(budgetAlertText({ blocked: 1, near: 1 })).toBe("2 bots at or near their daily limit");
    expect(budgetAlertText({ blocked: 1, near: 0 })).toBe("1 bot at its daily limit");
    expect(budgetAlertText({ blocked: 0, near: 3 })).toBe("3 bots near their daily limit");
    expect(budgetAlertText({ blocked: 0, near: 0 })).toBeNull();
  });

  it("finds the soonest future retry", () => {
    const now = Date.parse("2026-10-23T10:00:00.000Z");
    expect(
      nextBudgetRetryMs(
        {
          past: { runsInWindow: 1, tokensInWindow: 0, retryAt: "2026-10-23T09:00:00.000Z" },
          late: { runsInWindow: 1, tokensInWindow: 0, retryAt: "2026-10-23T12:00:00.000Z" },
          soon: { runsInWindow: 1, tokensInWindow: 0, retryAt: "2026-10-23T11:00:00.000Z" },
        },
        now,
      ),
    ).toBe(Date.parse("2026-10-23T11:00:00.000Z"));
    expect(nextBudgetRetryMs({}, now)).toBeNull();
  });
});

describe("usageClauseText", () => {
  const tokens = { input: 3_000_000, cachedInput: 0, output: 200_000, total: 3_200_000 };

  it("reads the window's runs and tokens, marking a floor", () => {
    expect(usageClauseText({ runs: 142, tokens, usageComplete: false }, 7)).toBe(
      "142 runs in 7 days · at least 3.20M tokens",
    );
    expect(usageClauseText({ runs: 1, tokens, usageComplete: true }, 1)).toBe(
      "1 run in 24 hours · 3.20M tokens",
    );
  });

  it("says so when nothing ran", () => {
    expect(
      usageClauseText({ runs: 0, tokens: { ...tokens, total: 0 }, usageComplete: true }, 30),
    ).toBe("No runs in 30 days");
  });
});

describe("token scale", () => {
  it("scales every row to the busiest", () => {
    const max = busiestTokens([
      { tokens: { input: 0, cachedInput: 0, output: 0, total: 400 } },
      { tokens: { input: 0, cachedInput: 0, output: 0, total: 1_000 } },
    ]);
    expect(max).toBe(1_000);
    expect(tokenShare(400, max)).toBe(0.4);
    expect(tokenShare(1_000, max)).toBe(1);
  });

  it("keeps a tiny use visible and an absent one empty", () => {
    expect(tokenShare(1, 1_000_000)).toBe(0.02);
    expect(tokenShare(0, 1_000)).toBe(0);
    expect(tokenShare(500, 0)).toBe(0);
    expect(busiestTokens([])).toBe(0);
  });

  it("never overflows a stale scale", () => {
    expect(tokenShare(2_000, 1_000)).toBe(1);
  });
});

describe("rows", () => {
  const row = emptyUsageRow(BotId.make("reviewer"));

  it("reads a bot that did not run as zero", () => {
    expect(row.runs).toBe(0);
    expect(row.tokens.total).toBe(0);
    expect(usageRate(row)).toBeNull();
    expect(outcomeText(row)).toBe("None finished");
  });

  it("names the rate by whether the bot gives verdicts", () => {
    expect(usageRate({ ...row, successRate: 0.8, pass: 4, fail: 1 })).toEqual({
      label: "Pass rate",
      share: 0.8,
    });
    expect(usageRate({ ...row, successRate: 0.5 })).toEqual({ label: "Completed", share: 0.5 });
  });

  it("lists only the outcomes that happened", () => {
    expect(outcomeText({ completed: 3, failed: 0, timedOut: 1, cancelled: 0 })).toBe(
      "3 completed · 1 timed out",
    );
  });
});

describe("computers", () => {
  it("punctuates reasons so they read as sentences", () => {
    expect(reasonsText(["Remote runs are off", "Codex is not installed.", " "])).toBe(
      "Remote runs are off. Codex is not installed.",
    );
  });

  it("tells offline apart from busy", () => {
    const base = { ready: false, online: true, freeSlots: 0 };
    expect(targetAvailability({ ...base, availability: "busy" })).toEqual({
      tone: "warning",
      label: "Busy",
    });
    expect(targetAvailability({ ...base, online: false, availability: "offline" })).toEqual({
      tone: "neutral",
      label: "Offline",
    });
    expect(
      targetAvailability({ ready: true, online: true, freeSlots: 1, availability: "ready" }),
    ).toEqual({ tone: "success", label: "Ready · 1 free slot" });
  });

  it("falls back to readiness on servers without availability", () => {
    expect(targetAvailability({ ready: false, online: false, freeSlots: 0 }).label).toBe("Offline");
    expect(targetAvailability({ ready: false, online: true, freeSlots: 0 }).label).toBe(
      "Not ready",
    );
    expect(targetAvailability({ ready: true, online: true, freeSlots: 2 }).label).toBe(
      "Ready · 2 free slots",
    );
  });

  it("keeps only runs that crossed computers, up to the limit", () => {
    const computer = { environmentId: EnvironmentId.make("env-b"), label: "Studio" };
    const runs = [
      { id: "a", ranOn: computer },
      { id: "b" },
      { id: "c", requestedBy: computer },
      { id: "d", ranOn: null, requestedBy: null },
      { id: "e", ranOn: computer },
    ];
    expect(remoteRuns(runs, 2).map((run) => run.id)).toEqual(["a", "c"]);
  });

  it("names operating systems as people do", () => {
    expect(platformName("darwin")).toBe("macOS");
    expect(platformName("Linux")).toBe("Linux");
    expect(platformName("freebsd")).toBe("freebsd");
  });
});
