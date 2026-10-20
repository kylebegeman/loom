import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { BOTS_VERDICT_MAX_FINDINGS, type BotRun } from "@t3tools/contracts/fork";
import { runResultMessage } from "./BotsService.ts";
import { decodeVerdictReply, INVALID_VERDICT_SUMMARY } from "./verdict.ts";

describe("decodeVerdictReply", () => {
  it("reads a verdict wrapped in a fence and a sentence", () => {
    const reply = [
      "Here is my verdict:",
      "```json",
      '{"verdict":"Needs attention","summary":"Unclear.","findings":[{"title":"Race","detail":"Two writers.","path":"src/a.ts","line":"12"},{"title":"Naming"}],"extra":true}',
      "```",
    ].join("\n");
    expect(decodeVerdictReply(reply)).toEqual({
      verdict: "needs_attention",
      summary: "Unclear.",
      findings: [
        { title: "Race", detail: "Two writers.", path: "src/a.ts", line: 12 },
        { title: "Naming", detail: "" },
      ],
      findingsTruncated: false,
      source: "decoded",
    });
  });

  it("clips long text and keeps at most the finding limit", () => {
    const findings = Array.from({ length: BOTS_VERDICT_MAX_FINDINGS + 3 }, (_, index) => ({
      title: `Finding ${index}`,
      detail: "x".repeat(5000),
    }));
    const verdict = decodeVerdictReply(
      JSON.stringify({ verdict: "fail", summary: "s".repeat(3000), findings }),
    );
    expect(verdict.source).toBe("decoded");
    expect(verdict.summary).toHaveLength(2000);
    expect(verdict.summary.endsWith("…")).toBe(true);
    expect(verdict.findings).toHaveLength(BOTS_VERDICT_MAX_FINDINGS);
    expect(verdict.findings[0]!.detail).toHaveLength(4000);
    expect(verdict.findingsTruncated).toBe(true);
  });

  it("needs a person when the reply is not a verdict", () => {
    for (const reply of [
      "All good, nothing to report.",
      '{"verdict":"maybe","summary":"?"}',
      '{"verdict":"pass"}',
      '{"verdict":"pass","summary":"ok","findings":[{"detail":"no title"}]}',
      '{"verdict":"pass","summary":"ok"',
    ]) {
      expect(decodeVerdictReply(reply)).toEqual({
        verdict: "needs_attention",
        summary: INVALID_VERDICT_SUMMARY,
        findings: [],
        findingsTruncated: false,
        source: "invalid",
      });
    }
  });
});

describe("runResultMessage", () => {
  const run = (fields: Partial<BotRun>): BotRun => ({
    id: "run-1",
    botId: "reviewer",
    botVersion: 1,
    botName: "Reviewer",
    threadId: ThreadId.make("bot-run-run-1"),
    projectId: ProjectId.make("project-a"),
    inputs: {},
    status: "completed",
    startedBy: "user",
    callerThreadId: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    startedAt: "2026-10-20T10:00:00.000Z",
    finishedAt: "2026-10-20T10:01:05.000Z",
    result: "{...}",
    resultTruncated: false,
    error: null,
    ...fields,
  });

  it("leads with the verdict and lists findings instead of the raw reply", () => {
    const text = runResultMessage(
      run({
        verdict: {
          verdict: "fail",
          summary: "Two problems.",
          findings: [
            { title: "Race", detail: "Two writers.", path: "src/a.ts", line: 12 },
            { title: "Naming", detail: "" },
          ],
          findingsTruncated: false,
          source: "decoded",
        },
      }),
    );
    expect(text).toBe(
      "Bot run finished: Reviewer (fail (2 findings), 1m 5s)\nRun id: run-1\n\nTwo problems.\n\n- Race (src/a.ts:12): Two writers.\n- Naming",
    );
  });

  it("keeps the raw reply when it was not a verdict", () => {
    const text = runResultMessage(
      run({
        result: "Looks fine to me.",
        verdict: decodeVerdictReply("Looks fine to me."),
      }),
    );
    expect(text).toContain("(needs attention, 1m 5s)");
    expect(text).toContain(`${INVALID_VERDICT_SUMMARY}\n\nLooks fine to me.`);
  });
});
