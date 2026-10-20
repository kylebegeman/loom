import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import type { BotRun } from "@t3tools/contracts/fork";
import { isoAt } from "./BotBudgets.ts";
import { testBot, testRun } from "./testing/fixtures.ts";
import { summarizeRunUsage, summarizeUsage } from "./usage.ts";

const complete = (inputTokens: number, outputTokens: number) => ({
  turnTokenUsage: {
    usageScope: "main_agent" as const,
    hasSubagents: false,
    inputTokens,
    outputTokens,
    usageStatus: "complete" as const,
  },
});

const verdict = (value: "pass" | "fail") => ({
  verdict: {
    verdict: value,
    summary: value,
    findings: [],
    findingsTruncated: false,
    source: "decoded" as const,
  },
});

/** A completed run that started at 10:00 and took `minutes`. */
const timed = (id: string, minutes: number, fields: Partial<BotRun> = {}): BotRun =>
  testRun(id, "2026-10-20T10:00:00.000Z", {
    startedAt: "2026-10-20T10:00:00.000Z",
    finishedAt: isoAt(Date.parse("2026-10-20T10:00:00.000Z") + minutes * 60_000),
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 10, status: "complete" },
    ...fields,
  });

describe("summarizeRunUsage", () => {
  it("sums complete turns", () => {
    expect(summarizeRunUsage([complete(100, 10), complete(50, 5)])).toEqual({
      inputTokens: 150,
      cachedInputTokens: 0,
      outputTokens: 15,
      status: "complete",
    });
  });

  it("is partial when a turn reported no tokens or used subagents", () => {
    expect(summarizeRunUsage([complete(100, 10), {}]).status).toBe("partial");
    expect(
      summarizeRunUsage([
        { turnTokenUsage: { ...complete(100, 10).turnTokenUsage, hasSubagents: true } },
      ]).status,
    ).toBe("partial");
  });

  it("is unavailable when no turn reported tokens", () => {
    expect(summarizeRunUsage([{}, {}]).status).toBe("unavailable");
    expect(summarizeRunUsage([]).status).toBe("unavailable");
  });
});

describe("summarizeUsage", () => {
  it("rates verdict runs by pass rate and others by completion", () => {
    const verdicts = summarizeUsage(
      [
        timed("a", 1, verdict("pass")),
        timed("b", 1, verdict("fail")),
        timed("c", 1, verdict("pass")),
        timed("d", 1, verdict("pass")),
      ],
      [testBot()],
    );
    expect(verdicts.rows[0]).toMatchObject({ pass: 3, fail: 1, successRate: 0.75 });

    const plain = summarizeUsage(
      [
        timed("a", 1),
        timed("b", 1, { status: "failed" }),
        timed("c", 1, { status: "cancelled" }),
        timed("d", 1, { status: "timed_out" }),
      ],
      [testBot()],
    );
    expect(plain.rows[0]).toMatchObject({ completed: 1, cancelled: 1, successRate: 1 / 3 });
  });

  it("takes the median over odd and even counts", () => {
    const odd = summarizeUsage([timed("a", 1), timed("b", 5), timed("c", 2)], [testBot()]);
    expect(odd.rows[0]).toMatchObject({ medianDurationMs: 120_000, maxDurationMs: 300_000 });
    const even = summarizeUsage(
      [timed("a", 1), timed("b", 2), timed("c", 4), timed("d", 9)],
      [testBot()],
    );
    expect(even.rows[0]!.medianDurationMs).toBe(180_000);
  });

  it("groups by recorded model and assumes the current model for runs without one", () => {
    const other = { instanceId: ProviderInstanceId.make("claude"), model: "other" };
    const { rows } = summarizeUsage(
      [
        timed("a", 1, { modelSelection: other }),
        timed("b", 1, { modelSelection: other }),
        timed("c", 1),
      ],
      [testBot()],
    );
    expect(rows[0]!.byModel).toEqual([
      expect.objectContaining({ model: "other", assumed: false, runs: 2, totalTokens: 220 }),
      expect.objectContaining({ model: "test", assumed: true, runs: 1 }),
    ]);
  });

  it("orders bots by tokens and flags incomplete usage", () => {
    const result = summarizeUsage(
      [
        timed("a", 1),
        timed("b", 1, {
          botId: "writer",
          botName: "Writer",
          usage: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 100, status: "partial" },
        }),
        timed("never", 0, { status: "failed", startedAt: null, usage: null }),
      ],
      [testBot()],
    );
    expect(result.rows.map((row) => [row.botName, row.tokens.total, row.usageComplete])).toEqual([
      ["Writer", 1000, false],
      ["Reviewer", 110, true],
    ]);
    expect(result.totals).toMatchObject({ runs: 3, usageComplete: false });
    expect(result.totals.tokens.total).toBe(1110);
  });
});
