import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { BUDGET_WINDOW_MS, isoAt } from "./BotBudgets.ts";
import { USER_CALLER } from "./BotsService.ts";
import { projectId, reviewer, withHarness } from "./testing/BotsHarness.ts";

const WAIT_MS = 60_000;
const inputs = (file: string) => ({ botId: "reviewer", inputs: { file }, projectId });

describe("BotsService budgets", () => {
  it.effect("admits exactly one of two concurrent starts at the last run of a budget", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(
          reviewer({ maxConcurrentRuns: 8, budget: { runsPerDay: 2 } }),
          USER_CALLER,
        );
        const first = yield* bots.run(inputs("a.ts"), USER_CALLER);

        const results = yield* Effect.all(
          [
            Effect.result(bots.run(inputs("b.ts"), USER_CALLER)),
            Effect.result(bots.run(inputs("c.ts"), USER_CALLER)),
          ],
          { concurrency: "unbounded" },
        );
        expect(results.filter(Result.isSuccess)).toHaveLength(1);
        const [refusal] = results.filter(Result.isFailure).map((result) => result.failure);
        expect(refusal).toMatchObject({
          reason: "invalid",
          retryAt: isoAt(Date.parse(first.createdAt) + BUDGET_WINDOW_MS),
        });
        expect(refusal?.message).toBe(
          "Reviewer reached its budget of 2 runs per 24 hours. The next run is possible in 24 hours.",
        );
      }),
    ),
  );

  it.effect("stores token usage from the run thread's turns", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const run = yield* bots.run(inputs("a.ts"), USER_CALLER);
        harness.turns.set(run.threadId, [
          {
            usageScope: "main_agent",
            hasSubagents: false,
            inputTokens: 1200,
            cachedInputTokens: 800,
            outputTokens: 90,
            usageStatus: "complete",
          },
          undefined,
        ]);
        yield* harness.end(run.threadId, { status: "completed", reply: "Fine." });

        expect((yield* bots.awaitRun(run.id, WAIT_MS)).usage).toEqual({
          inputTokens: 1200,
          cachedInputTokens: 800,
          outputTokens: 90,
          status: "partial",
        });
        expect((yield* bots.getRun(run.id)).usage?.status).toBe("partial");
      }),
    ),
  );

  it.effect("keeps the reply when usage cannot be read", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        harness.state.usageError = true;
        const run = yield* bots.run(inputs("a.ts"), USER_CALLER);
        yield* harness.end(run.threadId, { status: "completed", reply: "Fine." });

        const done = yield* bots.awaitRun(run.id, WAIT_MS);
        expect(done).toMatchObject({ status: "completed", result: "Fine." });
        expect(done.usage ?? null).toBeNull();
      }),
    ),
  );

  it.effect("reports usage over a window with each budget as it stands", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ budget: { runsPerDay: 5 } }), USER_CALLER);
        const run = yield* bots.run(inputs("a.ts"), USER_CALLER);
        harness.turns.set(run.threadId, [
          {
            usageScope: "main_agent",
            hasSubagents: false,
            inputTokens: 100,
            outputTokens: 10,
            usageStatus: "complete",
          },
        ]);
        yield* harness.end(run.threadId, { status: "completed", reply: "Fine." });
        yield* bots.awaitRun(run.id, WAIT_MS);

        const createdMs = Date.parse(run.createdAt);
        const result = yield* bots.usage({
          since: isoAt(createdMs - BUDGET_WINDOW_MS),
          until: isoAt(createdMs + 1),
        });
        expect(result.rows).toEqual([
          expect.objectContaining({ botId: "reviewer", runs: 1, usageComplete: true }),
        ]);
        expect(result.totals.tokens.total).toBe(110);
        expect(result.budgets).toEqual({
          reviewer: { runsInWindow: 1, tokensInWindow: 110, runsPerDay: 5 },
        });

        const backwards = yield* Effect.flip(
          bots.usage({ since: isoAt(createdMs), until: isoAt(createdMs) }),
        );
        expect(backwards.message).toBe("Choose a window whose start is before its end.");
        const tooLong = yield* Effect.flip(
          bots.usage({ since: isoAt(createdMs - 93 * BUDGET_WINDOW_MS), until: isoAt(createdMs) }),
        );
        expect(tooLong.message).toBe("Choose a window of at most 92 days.");
      }),
    ),
  );
});
