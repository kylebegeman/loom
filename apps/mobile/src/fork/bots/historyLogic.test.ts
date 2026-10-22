import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { BOTS_REPLAY_MAX_RUNS, type BotRun } from "@t3tools/contracts/fork";
import {
  budgetStatus,
  defaultReplaySelection,
  formatDuration,
  replayCandidates,
  replayRunsById,
  targetReadinessText,
} from "./historyLogic";

const run = (id: string, patch: Partial<BotRun> = {}): BotRun => ({
  id,
  botId: "bot",
  botVersion: 1,
  botName: "Bot",
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: null,
  inputs: {},
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-22T10:00:00.000Z",
  startedAt: null,
  finishedAt: "2026-10-22T10:00:05.000Z",
  result: "Finished",
  resultTruncated: false,
  error: null,
  ...patch,
});

describe("native replay selection", () => {
  it("excludes unfinished runs, other bots and prior replays while retaining finished failures", () => {
    expect(
      replayCandidates(
        [
          run("done"),
          run("failed", { status: "failed" }),
          run("queued", { status: "queued" }),
          run("running", { status: "running" }),
          run("other", { botId: "other" }),
          run("replayed", { replayId: "replay" }),
        ],
        "bot",
      ).map((entry) => entry.id),
    ).toEqual(["done", "failed"]);
  });
  it("chooses rated examples before newer unrated runs and respects the server limit", () => {
    const rated = Array.from({ length: BOTS_REPLAY_MAX_RUNS + 5 }, (_, index) =>
      run(`rated-${index}`, { rating: index % 2 ? "up" : "down" }),
    );
    expect(defaultReplaySelection([run("unrated"), ...rated])).toEqual(
      rated.slice(0, BOTS_REPLAY_MAX_RUNS).map((entry) => entry.id),
    );
    expect(
      defaultReplaySelection(Array.from({ length: 10 }, (_, index) => run(String(index)))),
    ).toEqual(["0", "1", "2", "3", "4"]);
  });
  it("keeps original results after a capped list rolls over, while applying live progress", () => {
    const retained = run("original");
    const stale = run("replay", { status: "running" });
    const fresh = run("replay", { result: "New answer" });
    const byId = replayRunsById([retained], [stale], [fresh]);
    expect(byId.get("original")).toBe(retained);
    expect(byId.get("replay")).toBe(fresh);
  });
});

describe("native usage budgets", () => {
  it("blocks either reached limit and warns when either limit is approaching", () => {
    expect(budgetStatus({ runsInWindow: 10, runsPerDay: 10, tokensInWindow: 1 })).toBe("blocked");
    expect(
      budgetStatus({ runsInWindow: 1, runsPerDay: 10, tokensInWindow: 1_000, tokensPerDay: 1_000 }),
    ).toBe("blocked");
    expect(budgetStatus({ runsInWindow: 8, runsPerDay: 10, tokensInWindow: 1 })).toBe(
      "approaching",
    );
    expect(budgetStatus({ runsInWindow: 1, tokensInWindow: 800, tokensPerDay: 1_000 })).toBe(
      "approaching",
    );
    expect(
      budgetStatus({ runsInWindow: 0, tokensInWindow: 0, retryAt: "2026-10-22T11:00:00Z" }),
    ).toBe("blocked");
    expect(budgetStatus({ runsInWindow: 1, tokensInWindow: 1 })).toBe("available");
  });
  it("formats duration boundaries without an unnecessary hour fraction", () => {
    expect(formatDuration(59_000)).toBe("59s");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(3_660_000)).toBe("1h 1m");
  });
});

it("keeps readiness meaningful when an offline computer has not given reasons", () => {
  const target = {
    environmentId: EnvironmentId.make("computer"),
    label: "Computer",
    isThisComputer: false,
    online: false,
    ready: false,
    freeSlots: 0,
    reasons: [],
  };
  expect(targetReadinessText(target)).toBe("Offline");
  expect(
    targetReadinessText({ ...target, reasons: ["Remote runs are off", "Missing Vault slot"] }),
  ).toBe("Remote runs are off Missing Vault slot");
  expect(targetReadinessText({ ...target, online: true, ready: true, freeSlots: 1 })).toBe(
    "Ready, 1 free slot",
  );
});
