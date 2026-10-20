import { describe, expect, it } from "@effect/vitest";
import { isBotInboxRun } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { BUDGET_WINDOW_MS, budgetState, isoAt } from "./BotBudgets.ts";
import { makeBotsStore, type BotsStore } from "./BotsStore.ts";
import { BotsMigrations } from "./migrations.ts";
import { testBot, testRun } from "./testing/fixtures.ts";

const withStore = <A, E>(use: (store: BotsStore) => Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(BotsMigrations);
    return yield* use(yield* makeBotsStore);
  }).pipe(Effect.provide(SqlitePersistenceMemory));

describe("BotsStore", () => {
  it.effect("round-trips definitions and upserts by id", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.putDefinition(testBot());
        yield* store.putDefinition(testBot({ version: 2, name: "Reviewer 2" }));
        expect(yield* store.listDefinitions()).toEqual([
          testBot({ version: 2, name: "Reviewer 2" }),
        ]);
        expect(yield* store.getDefinition("missing")).toBeNull();
      }),
    ),
  );

  it.effect("pages runs newest first, filters by bot and lists unfinished runs", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insertRun(testRun("r1", "2026-10-20T10:00:00.000Z"));
        yield* store.insertRun(testRun("r2", "2026-10-20T11:00:00.000Z", { status: "running" }));
        yield* store.insertRun(testRun("r3", "2026-10-20T12:00:00.000Z", { botId: "other" }));
        const first = yield* store.listRuns({ limit: 2 });
        expect(first.runs.map((run) => run.id)).toEqual(["r3", "r2"]);
        expect(first.hasMore).toBe(true);
        const next = yield* store.listRuns({ limit: 2, before: first.runs[1]!.createdAt });
        expect(next).toEqual({ runs: [testRun("r1", "2026-10-20T10:00:00.000Z")], hasMore: false });
        expect((yield* store.listRuns({ botId: "other", limit: 5 })).runs.map((r) => r.id)).toEqual(
          ["r3"],
        );
        expect((yield* store.listUnfinishedRuns()).map((run) => run.id)).toEqual(["r2"]);
      }),
    ),
  );

  it.effect("stores verdicts, filters by them, and keeps a run whose verdict it cannot read", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const verdict = {
          verdict: "fail",
          summary: "One bug.",
          findings: [{ title: "Off by one", detail: "", path: "a.ts", line: 3 }],
          findingsTruncated: false,
          source: "decoded",
        } as const;
        yield* store.insertRun(testRun("r1", "2026-10-20T10:00:00.000Z"));
        yield* store.saveRun(testRun("r1", "2026-10-20T10:00:00.000Z", { verdict }));
        yield* store.insertRun(testRun("r2", "2026-10-20T11:00:00.000Z"));
        expect(yield* store.listRuns({ verdict: "fail", limit: 5 })).toEqual({
          runs: [testRun("r1", "2026-10-20T10:00:00.000Z", { verdict })],
          hasMore: false,
        });

        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE fork_bots_runs SET verdict_json = '{"verdict":"maybe"}' WHERE id = 'r1'`;
        expect(yield* store.getRun("r1")).toEqual(
          testRun("r1", "2026-10-20T10:00:00.000Z", { verdict: null }),
        );
      }),
    ),
  );

  it.effect("prunes only finished runs beyond the newest kept", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-10-22T00:00:00.000Z"));
        yield* store.insertRun(
          testRun("r0", "2026-10-20T09:00:00.000Z", { status: "running", finishedAt: null }),
        );
        for (const hour of [10, 11, 12])
          yield* store.insertRun(testRun(`r${hour}`, `2026-10-20T${hour}:00:00.000Z`));
        yield* store.pruneRuns("reviewer", 2);
        expect((yield* store.listRuns({ limit: 10 })).runs.map((run) => run.id)).toEqual([
          "r12",
          "r11",
          "r0",
        ]);
      }),
    ),
  );

  it.effect("keeps runs the budget window still counts when pruning", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const now = Date.parse("2026-10-20T12:00:00.000Z");
        yield* TestClock.setTime(now);
        const minutesAgo = (minutes: number) => isoAt(now - minutes * 60_000);
        const usage = {
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 0,
          status: "complete",
        } as const;
        for (const minutes of [30, 20]) {
          const run = testRun(`counted-${minutes}`, minutesAgo(minutes), { usage });
          yield* store.insertRun(run);
          yield* store.saveRun(run);
        }
        // Newer runs that never started, such as trigger skips, fill the kept places.
        for (const minutes of [10, 5])
          yield* store.insertRun(
            testRun(`skipped-${minutes}`, minutesAgo(minutes), {
              status: "failed",
              startedAt: null,
            }),
          );
        yield* store.insertRun(testRun("stale", isoAt(now - BUDGET_WINDOW_MS - 60_000)));
        const since = isoAt(now - BUDGET_WINDOW_MS);
        const counted = Effect.map(store.budgetWindow("reviewer", since), (window) =>
          budgetState(undefined, window),
        );
        expect(yield* counted).toEqual({ runsInWindow: 2, tokensInWindow: 200 });

        yield* store.pruneRuns("reviewer", 1);
        expect((yield* store.listRuns({ limit: 10 })).runs.map((run) => run.id)).toEqual([
          "skipped-5",
          "counted-20",
          "counted-30",
        ]);
        expect(yield* counted).toEqual({ runsInWindow: 2, tokensInWindow: 200 });
      }),
    ),
  );

  it.effect("deletes a bot's Vault bindings with the bot", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.putDefinition(testBot());
        yield* store.bindVaultSlot("reviewer", "github-token", "item-a");
        yield* store.deleteDefinition("reviewer");
        yield* store.putDefinition(testBot({ createdAt: "2026-10-21T10:00:00.000Z" }));
        expect(yield* store.vaultBindings("reviewer")).toEqual(new Map());
      }),
    ),
  );

  it.effect("selects the inbox in SQL exactly as isBotInboxRun does", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const verdict = (value: "pass" | "needs_attention") =>
          ({
            verdict: value,
            summary: "",
            findings: [],
            findingsTruncated: false,
            source: "decoded",
          }) as const;
        const fixture = [
          testRun("failed", "2026-10-20T10:00:00.000Z", { status: "failed" }),
          testRun("timed", "2026-10-20T11:00:00.000Z", { status: "timed_out" }),
          testRun("unsure", "2026-10-20T12:00:00.000Z", { verdict: verdict("needs_attention") }),
          testRun("passed", "2026-10-20T13:00:00.000Z", { verdict: verdict("pass") }),
          testRun("plain", "2026-10-20T14:00:00.000Z"),
          testRun("cancelled", "2026-10-20T15:00:00.000Z", { status: "cancelled" }),
          testRun("running", "2026-10-20T16:00:00.000Z", { status: "running", finishedAt: null }),
          testRun("retried", "2026-10-20T17:00:00.000Z", { status: "failed" }),
          testRun("dismissed", "2026-10-20T18:00:00.000Z", { status: "failed" }),
        ];
        for (const run of fixture) {
          yield* store.insertRun(run);
          if (run.verdict) yield* store.saveRun(run);
        }
        yield* store.setRetriedBy("retried", "failed");
        yield* store.setDismissed(["dismissed"], "2026-10-20T19:00:00.000Z");

        const stored = (yield* store.listRuns({ limit: 20 })).runs;
        const expected = stored.filter(isBotInboxRun).map((run) => run.id);
        expect(expected).toEqual(["unsure", "timed", "failed"]);
        const first = yield* store.inbox({ dismissed: false, limit: 2 });
        expect(first).toMatchObject({ total: 3, hasMore: true });
        const rest = yield* store.inbox({
          dismissed: false,
          before: first.runs.at(-1)!.createdAt,
          limit: 2,
        });
        expect(rest).toMatchObject({ total: 3, hasMore: false });
        expect([...first.runs, ...rest.runs].map((run) => run.id)).toEqual(expected);

        const dismissed = yield* store.inbox({ dismissed: true, limit: 5 });
        expect(dismissed.runs.map((run) => run.id)).toEqual(["dismissed"]);
        expect(dismissed.runs[0]!.dismissedAt).toBe("2026-10-20T19:00:00.000Z");
      }),
    ),
  );
});
