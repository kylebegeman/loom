import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotRun, BotsBatchInput } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { PullRequestService } from "../../pullRequest/PullRequestService.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { make } from "./BotBatches.ts";
import { BUDGET_WINDOW_MS, isoAt } from "./BotBudgets.ts";
import { makeBotBatchesStore, type StoredBatch } from "./BotBatchesStore.ts";
import { BotsService, RESTARTED_BEFORE_START, USER_CALLER } from "./BotsService.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { projectId, reviewer, withHarness, type Harness } from "./testing/BotsHarness.ts";

const WAIT_MS = 60_000;

/** Bots plus batches over the harness; git lists `conflicted` for any conflicts source. */
const makeBatches = (harness: Harness, conflicted: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const bots = yield* harness.service;
    const projects = {
      get: () => Effect.succeed(Option.some({ workspaceRoot: "/repo", deletedAt: null })),
    } as unknown as ProjectStore.ProjectStoreV2["Service"];
    const git = {
      execute: () => Effect.succeed({ stdout: conflicted.join("\0"), stdoutTruncated: false }),
    } as unknown as GitVcsDriver["Service"];
    const batches = yield* harness
      .provide(make)
      .pipe(
        Effect.provideService(BotsService, bots),
        Effect.provideService(ProjectStore.ProjectStoreV2, projects),
        Effect.provideService(GitVcsDriver, git),
        Effect.provideService(PullRequestService, {} as PullRequestService["Service"]),
        Effect.provideService(WorkspaceEntries, {} as WorkspaceEntries["Service"]),
      );
    return { bots, batches };
  });

const lines = (text: string): BotsBatchInput => ({
  botId: "reviewer",
  projectId,
  source: { type: "lines", text },
  itemParameter: "file",
});

/** Ends the next launched run thread and returns its brief. */
const endNext = (harness: Harness, status: "completed" | "failed", reply: string | null) =>
  Effect.gen(function* () {
    const launch = yield* harness.nextLaunch;
    yield* harness.end(launch.threadId!, { status, reply });
    return launch.initialMessage?.text;
  });

/** A batch as a previous server would have stored it, `minute` minutes into the day. */
const storedBatch = (
  bot: BotDefinition,
  id: string,
  status: StoredBatch["batch"]["status"],
  minute: number,
): StoredBatch => ({
  batch: {
    id,
    botId: bot.id,
    botVersion: bot.version,
    botName: bot.name,
    projectId,
    sourceType: "lines",
    sourceSummary: "Pasted lines, 1 item",
    itemParameter: "file",
    sharedInputs: {},
    status,
    note: null,
    startedBy: "user",
    callerThreadId: null,
    createdAt: `2026-10-20T10:${String(minute).padStart(2, "0")}:00.000Z`,
    finishedAt: null,
  },
  definition: bot,
  source: { type: "lines", text: "a.ts" },
  checkoutThreadId: null,
  target: null,
});

describe("BotBatches", () => {
  it.effect("feeds items through the bot's window with the definition it started with", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(reviewer({ maxConcurrentRuns: 2 }), USER_CALLER);
        const batch = yield* batches.runBatch(lines("a.ts\nb.ts\nb.ts\nc.ts"), USER_CALLER);
        expect(batch).toMatchObject({ total: 3, status: "running", botVersion: 1 });

        const first = yield* harness.nextLaunch;
        yield* harness.nextLaunch;
        const { items } = yield* batches.get(batch.id);
        expect(items.map((item) => item.state)).toEqual(["started", "started", "pending"]);

        // A save mid-batch does not change what the remaining items run.
        yield* bots.save(
          reviewer({ maxConcurrentRuns: 2, instructions: "Rewrite {{file}}.", expectedVersion: 1 }),
          USER_CALLER,
        );
        yield* harness.end(first.threadId!, { status: "completed", reply: "A" });
        expect(yield* endNext(harness, "completed", "C")).toBe("Review c.ts.");
        yield* harness.end(harness.launches[1]!.threadId!, { status: "completed", reply: "B" });

        const done = yield* batches.awaitBatch(batch.id, WAIT_MS);
        expect(done).toMatchObject({ status: "finished", counts: { completed: 3, pending: 0 } });
        expect((yield* batches.report(batch.id)).markdown).toContain(
          "## Passed\n\n- a.ts\n- b.ts\n- c.ts",
        );
      }),
    ),
  );

  it.effect("pauses at the bot's budget and resumes when the window allows", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(
          reviewer({ maxConcurrentRuns: 2, budget: { runsPerDay: 1 } }),
          USER_CALLER,
        );
        const paused = yield* batches.changes.pipe(
          Stream.filter((change) => change._tag === "batch" && change.batch.pausedUntil != null),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const batch = yield* batches.runBatch(lines("a.ts\nb.ts"), USER_CALLER);
        const first = yield* harness.nextLaunch;
        yield* Fiber.join(paused);

        const { batch: waiting, items } = yield* batches.get(batch.id);
        const firstRun = yield* bots.getRun(items[0]!.runId!);
        expect(waiting.pausedUntil).toBe(isoAt(Date.parse(firstRun.createdAt) + BUDGET_WINDOW_MS));
        expect(items.map((item) => item.state)).toEqual(["started", "pending"]);
        yield* harness.end(first.threadId!, { status: "completed", reply: "A" });

        yield* TestClock.adjust("24 hours");
        expect(yield* endNext(harness, "completed", "B")).toBe("Review b.ts.");
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { completed: 2 },
        });
      }),
    ),
  );

  it.effect("cancels a batch: waiting items are skipped and runs in flight cancelled", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const batch = yield* batches.runBatch(lines("a.ts\nb.ts\nc.ts"), USER_CALLER);
        yield* harness.nextLaunch;

        expect(yield* batches.cancel(batch.id)).toMatchObject({
          status: "cancelled",
          counts: { skipped: 2 },
        });
        const { items } = yield* batches.get(batch.id);
        expect(yield* bots.awaitRun(items[0]!.runId!, WAIT_MS)).toMatchObject({
          status: "cancelled",
        });
        expect(harness.launches).toHaveLength(1);
      }),
    ),
  );

  it.effect("retries failed items up to the attempt limit", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const batch = yield* batches.runBatch(lines("a.ts\nb.ts"), USER_CALLER);
        yield* endNext(harness, "failed", null);
        yield* endNext(harness, "completed", "Fine.");
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { failed: 1, completed: 1 },
        });

        for (let attempt = 2; attempt <= 5; attempt++) {
          const retried = yield* batches.retry(
            { batchId: batch.id, include: "failed" },
            USER_CALLER,
          );
          expect(retried).toMatchObject({
            retried: 1,
            exhausted: [],
            batch: { status: "running" },
          });
          yield* endNext(harness, "failed", null);
          yield* batches.awaitBatch(batch.id, WAIT_MS);
        }
        const { items } = yield* batches.get(batch.id);
        expect(items[0]!.previousRunIds).toHaveLength(4);
        expect(items[1]!.previousRunIds).toHaveLength(0);
        const refused = yield* Effect.flip(
          batches.retry({ batchId: batch.id, include: "failed" }, USER_CALLER),
        );
        expect(refused.message).toBe("Every item to retry has run 5 times already.");
      }),
    ),
  );

  it.effect("refuses a batch with an invalid item and says which", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const input: BotsBatchInput = {
          botId: "reviewer",
          projectId,
          source: { type: "inputs", items: [{ file: "a.ts" }, { other: "x" }] },
        };
        const preview = yield* batches.preview(input, USER_CALLER);
        expect(preview).toMatchObject({ total: 2, items: [{ label: "a.ts" }] });
        expect(preview.invalid).toHaveLength(1);

        const refused = yield* Effect.flip(batches.runBatch(input, USER_CALLER));
        expect(refused.message).toMatch(/^1 item is not valid\. x: /u);
        const missing = yield* Effect.flip(
          batches.runBatch(
            { botId: "reviewer", projectId, source: { type: "lines", text: "a.ts" } },
            USER_CALLER,
          ),
        );
        expect(missing.message).toBe("Choose the input each item fills.");
        expect((yield* batches.list({ limit: 10 })).batches).toEqual([]);
      }),
    ),
  );

  it.effect("resolves conflicts only with a bot that opens the same checkout", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness, ["a.ts", "b.ts"]);
        const input: BotsBatchInput = {
          botId: "reviewer",
          projectId,
          source: { type: "conflicts" },
          itemParameter: "file",
        };
        yield* bots.save(
          reviewer({ workspace: { type: "project", projectId: null, worktree: true } }),
          USER_CALLER,
        );
        const refused = yield* Effect.flip(batches.preview(input, USER_CALLER));
        expect(refused.message).toBe(
          "This bot runs in its own worktree, so it would not see these conflicts.",
        );

        yield* bots.save(reviewer({ expectedVersion: 1 }), USER_CALLER);
        expect(yield* batches.preview(input, USER_CALLER)).toMatchObject({
          total: 2,
          sourceSummary: "Merge conflicts, 2 files",
        });
      }),
    ),
  );

  it.effect("cancels a running batch when its bot is archived", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const batch = yield* batches.runBatch(lines("a.ts\nb.ts"), USER_CALLER);
        yield* harness.nextLaunch;

        yield* bots.archive("reviewer", true);
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "cancelled",
          note: "The bot was archived.",
          counts: { skipped: 1 },
        });
      }),
    ),
  );

  it.effect("puts an item whose run never started back to wait after a restart", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        const bot = yield* bots.save(reviewer(), USER_CALLER);
        const batchStore = yield* makeBotBatchesStore;
        yield* batchStore.insertBatch(storedBatch(bot, "batch-1", "running", 0), [
          { label: "a.ts", inputs: { file: "a.ts" } },
        ]);
        const queued: BotRun = {
          id: "queued-run",
          botId: bot.id,
          botVersion: 1,
          botName: bot.name,
          threadId: ThreadId.make("bot-run-queued-run"),
          projectId,
          inputs: { file: "a.ts" },
          status: "queued",
          startedBy: "user",
          callerThreadId: null,
          createdAt: "2026-10-20T10:00:01.000Z",
          startedAt: null,
          finishedAt: null,
          result: null,
          resultTruncated: false,
          error: null,
          batchId: "batch-1",
        };
        yield* (yield* makeBotsStore).insertRun(queued);
        yield* batchStore.setItemState("batch-1", 0, "started", queued.id);

        yield* bots.recover();
        expect(yield* bots.getRun(queued.id)).toMatchObject({ error: RESTARTED_BEFORE_START });
        yield* bots.markRecovered;
        yield* batches.recover();

        expect(yield* endNext(harness, "completed", "Fine.")).toBe("Review a.ts.");
        expect(yield* batches.awaitBatch("batch-1", WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { completed: 1 },
        });
      }),
    ),
  );

  it.effect("keeps the newest batches of a bot and every running one", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        const bot = yield* bots.save(reviewer(), USER_CALLER);
        const batchStore = yield* makeBotBatchesStore;
        const item = { label: "a.ts", inputs: { file: "a.ts" } };
        yield* batchStore.insertBatch(storedBatch(bot, "running-old", "running", 0), [item]);
        for (const minute of [1, 2, 3])
          yield* batchStore.insertBatch(storedBatch(bot, `done-${minute}`, "finished", minute), [
            item,
          ]);

        yield* batchStore.pruneBatches(bot.id, 2);
        const kept = (yield* batches.list({ limit: 10 })).batches.map((batch) => batch.id);
        expect(kept).toEqual(["done-3", "done-2", "running-old"]);
        expect(yield* batchStore.getItems("done-1")).toEqual([]);
      }),
    ),
  );
});
