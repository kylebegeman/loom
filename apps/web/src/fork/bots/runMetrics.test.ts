import { describe, expect, it } from "vite-plus/test";
import {
  runDurationLabel,
  runDurationMs,
  runTokensLabel,
  runTotalTokens,
  waitingAgeLabel,
} from "./runMetrics";
import { makeBotRun } from "./testFixtures";

describe("bot run metrics", () => {
  it("measures runtime without queue time and distinguishes refused and missing runs", () => {
    const run = makeBotRun("one");
    expect(runDurationMs(run)).toBe(60_000);
    expect(runDurationLabel(run)).toBe("Ran for 1m");
    expect(runDurationLabel({ startedAt: null, finishedAt: run.finishedAt })).toBe("Did not start");
    expect(runDurationLabel({ startedAt: run.startedAt, finishedAt: null })).toBe("In progress");
    expect(runDurationMs({ startedAt: run.finishedAt, finishedAt: run.startedAt })).toBeNull();
    expect(runDurationMs({ startedAt: "invalid", finishedAt: run.finishedAt })).toBeNull();
    expect(runDurationLabel({ ...run, startedAt: null })).toBe("Duration unavailable");
    expect(runDurationLabel({ ...run, finishedAt: null })).toBe("Duration unavailable");
    expect(runDurationLabel({ ...run, status: "queued", startedAt: null, finishedAt: null })).toBe(
      "Not started",
    );
    expect(runDurationLabel({ ...run, status: "running", finishedAt: null })).toBe("In progress");
  });

  it("counts cached input only once and marks partial or unavailable tokens", () => {
    const run = makeBotRun("one", {
      usage: { inputTokens: 800, cachedInputTokens: 500, outputTokens: 200, status: "complete" },
    });
    expect(runTotalTokens(run)).toBe(1000);
    expect(runTokensLabel({ usage: { ...run.usage!, status: "partial" } })).toBe(
      "1,000 tokens (partial)",
    );
    expect(runTokensLabel({ usage: { ...run.usage!, status: "unavailable" } })).toBe(
      "Tokens unavailable",
    );
    expect(runTotalTokens(makeBotRun("older"))).toBeNull();
    expect(
      runTotalTokens({
        usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, status: "complete" },
      }),
    ).toBe(0);
  });

  it("ages waiting requests by minute, handles clock skew, and rejects invalid timestamps", () => {
    const since = "2026-10-20T10:00:30.000Z";
    expect(waitingAgeLabel(since, Date.parse("2026-10-20T10:00:00Z"))).toBe("less than a minute");
    expect(waitingAgeLabel(since, Date.parse("2026-10-20T10:09:00Z"))).toBe("8m");
    expect(waitingAgeLabel(since, Date.parse("2026-10-20T11:30:30Z"))).toBe("1h 30m");
    expect(waitingAgeLabel("invalid", Date.now())).toBeNull();
  });
});
