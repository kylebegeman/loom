import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { BUDGET_WINDOW_MS, budgetRefusal, budgetState, isoAt, waitText } from "./BotBudgets.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { BotsMigrations } from "./migrations.ts";
import { testRun } from "./testing/fixtures.ts";

const START = Date.parse("2026-10-20T00:00:00.000Z");
const minute = (n: number) => isoAt(START + n * 60_000);

/** `count` counted runs, one a minute from midnight. */
const runs = (count: number) => Array.from({ length: count }, (_, index) => minute(index));

describe("budgetState", () => {
  it("refuses the run past runsPerDay until the oldest run leaves the window", () => {
    const state = budgetState({ runsPerDay: 50 }, { runs: runs(50), finished: [] });
    expect(state).toMatchObject({ runsInWindow: 50, runsPerDay: 50 });
    expect(state.retryAt).toBe(isoAt(START + BUDGET_WINDOW_MS));

    const refusal = budgetRefusal("Reviewer", state, START + 60 * 60_000);
    expect(refusal).toMatchObject({ reason: "invalid", retryAt: state.retryAt });
    expect(refusal?.message).toBe(
      "Reviewer reached its budget of 50 runs per 24 hours. The next run is possible in 23 hours.",
    );

    // At retryAt the store's window (created_at > now - 24h) no longer holds the oldest run.
    const later = budgetState({ runsPerDay: 50 }, { runs: runs(50).slice(1), finished: [] });
    expect(later.retryAt).toBeUndefined();
    expect(budgetRefusal("Reviewer", later, START + BUDGET_WINDOW_MS)).toBeNull();
  });

  it("counts finished tokens and waits until enough of the oldest leave", () => {
    const finished = [
      { finishedAt: minute(0), tokens: 400 },
      { finishedAt: minute(10), tokens: 400 },
      { finishedAt: minute(20), tokens: 400 },
    ];
    const state = budgetState({ tokensPerDay: 1000 }, { runs: [], finished });
    expect(state).toMatchObject({ tokensInWindow: 1200, tokensPerDay: 1000 });
    // Dropping the first run leaves 800, under the limit.
    expect(state.retryAt).toBe(isoAt(START + BUDGET_WINDOW_MS));
    expect(budgetRefusal("Reviewer", state, START)?.message).toContain("1,000 tokens");

    const tight = budgetState({ tokensPerDay: 500 }, { runs: [], finished });
    expect(tight.retryAt).toBe(isoAt(START + 10 * 60_000 + BUDGET_WINDOW_MS));
  });

  it("takes the later time when both limits are reached", () => {
    const state = budgetState(
      { runsPerDay: 2, tokensPerDay: 100 },
      { runs: runs(2), finished: [{ finishedAt: minute(30), tokens: 100 }] },
    );
    expect(state.retryAt).toBe(isoAt(START + 30 * 60_000 + BUDGET_WINDOW_MS));
  });

  it("never refuses without a budget", () => {
    const state = budgetState(undefined, { runs: runs(500), finished: [] });
    expect(state.retryAt).toBeUndefined();
    expect(budgetRefusal("Reviewer", state, START)).toBeNull();
  });

  it("says how long to wait in hours and minutes", () => {
    expect(waitText(30_000)).toBe("1 minute");
    expect(waitText(125 * 60_000)).toBe("2 hours 5 minutes");
    expect(waitText(60 * 60_000)).toBe("1 hour");
  });
});

describe("BotsStore.budgetWindow", () => {
  it.effect("counts started and waiting runs, not runs that never started", () =>
    Effect.gen(function* () {
      yield* runForkMigrationSet(BotsMigrations);
      const store = yield* makeBotsStore;
      const done = testRun("done", minute(1), {
        usage: { inputTokens: 300, cachedInputTokens: 100, outputTokens: 20, status: "complete" },
      });
      yield* store.insertRun(done);
      yield* store.saveRun(done);
      yield* store.insertRun(
        testRun("queued", minute(2), { status: "queued", startedAt: null, finishedAt: null }),
      );
      yield* store.insertRun(
        testRun("refused", minute(3), { status: "failed", startedAt: null, finishedAt: minute(3) }),
      );
      yield* store.insertRun(testRun("old", isoAt(START - BUDGET_WINDOW_MS)));

      const window = yield* store.budgetWindow("reviewer", isoAt(START - 60_000));
      expect(window.runs).toEqual([minute(1), minute(2)]);
      expect(window.finished).toEqual([
        { finishedAt: minute(1), tokens: 320 },
        { finishedAt: minute(3), tokens: 0 },
      ]);
    }).pipe(Effect.provide(SqlitePersistenceMemory)),
  );
});
