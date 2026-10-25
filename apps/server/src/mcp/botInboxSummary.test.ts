// fork: attention-status
import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import { botInboxSummary } from "./botInboxSummary.ts";

const run = {
  id: "run",
  botId: "review",
  botName: "Review",
  threadId: ThreadId.make("bot-run-test"),
  status: "failed" as const,
  callerThreadId: ThreadId.make("caller"),
  createdAt: "2026-10-25T00:00:00Z",
  finishedAt: "2026-10-25T00:01:00Z",
  startedBy: "agent" as const,
  error: "Run failed.\nTry again.",
  inputs: { prompt: "input ".repeat(10_000) },
  result: "reply ".repeat(10_000),
};

describe("compact bot inbox", () => {
  it("keeps the reason and navigation ids without copying inputs or replies", () => {
    expect(botInboxSummary(run)).toEqual({
      id: run.id,
      botId: run.botId,
      botName: run.botName,
      threadId: run.threadId,
      status: "failed",
      callerThreadId: run.callerThreadId,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
      reason: "Run failed. Try again.",
      handled: false,
    });
    expect(
      JSON.stringify(Array.from({ length: 20 }, () => botInboxSummary(run))).length,
    ).toBeLessThan(8_000);
  });
  it("summarizes a decoded verdict once with a bounded single-line reason", () => {
    const summary = botInboxSummary({
      ...run,
      verdict: {
        verdict: "needs_attention",
        summary: "Check this.\n".repeat(1000),
        findings: [],
        findingsTruncated: false,
        source: "decoded",
      },
    });
    expect(summary.reason).toHaveLength(240);
    expect(summary.reason).not.toContain("\n");
    expect(summary.reason).toContain("Check this.");
    expect(summary).not.toHaveProperty("verdict");
    expect(summary).not.toHaveProperty("result");
  });
  it("marks a run whose result already reached its calling agent", () => {
    const delivered = { ...run, notify: true, deliveredAt: "2026-10-25T00:01:01Z" };
    expect(botInboxSummary(delivered).handled).toBe(true);
    expect(botInboxSummary({ ...delivered, notify: false }).handled).toBe(false);
    expect(botInboxSummary({ ...delivered, failureClass: "usage_limit" })).toMatchObject({
      failureClass: "usage_limit",
    });
  });
});
