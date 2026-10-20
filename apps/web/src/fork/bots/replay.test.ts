import { describe, expect, it } from "vite-plus/test";
import { ThreadId } from "@t3tools/contracts";
import type { BotRun } from "@t3tools/contracts/fork";
import { defaultReplaySelection, replayCandidates } from "./replay";

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
