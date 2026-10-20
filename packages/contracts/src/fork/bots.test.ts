import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "../baseSchemas.ts";
import { isBotInboxRun, needsBotAttention, type BotRun, type BotVerdictValue } from "./bots.ts";

const run = (fields: Partial<BotRun> = {}): BotRun => ({
  id: "run-1",
  botId: "reviewer",
  botVersion: 1,
  botName: "Reviewer",
  threadId: ThreadId.make("bot-run-run-1"),
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
  ...fields,
});

const verdict = (value: BotVerdictValue) => ({
  verdict: value,
  summary: "",
  findings: [],
  findingsTruncated: false,
  source: "decoded" as const,
});

describe("isBotInboxRun", () => {
  it("holds failed, timed out and undecided runs", () => {
    expect(isBotInboxRun(run({ status: "failed" }))).toBe(true);
    expect(isBotInboxRun(run({ status: "timed_out" }))).toBe(true);
    expect(isBotInboxRun(run({ verdict: verdict("needs_attention") }))).toBe(true);
  });

  it("leaves out answers, choices, unfinished runs and handled ones", () => {
    expect(isBotInboxRun(run())).toBe(false);
    expect(isBotInboxRun(run({ verdict: verdict("fail") }))).toBe(false);
    expect(isBotInboxRun(run({ verdict: null }))).toBe(false);
    expect(isBotInboxRun(run({ status: "cancelled" }))).toBe(false);
    expect(isBotInboxRun(run({ status: "running" }))).toBe(false);
    expect(isBotInboxRun(run({ status: "failed", retriedBy: "run-2" }))).toBe(false);
    const dismissed = run({ status: "failed", dismissedAt: "2026-10-20T11:00:00.000Z" });
    expect(isBotInboxRun(dismissed)).toBe(false);
    expect(needsBotAttention(dismissed)).toBe(true);
  });
});
