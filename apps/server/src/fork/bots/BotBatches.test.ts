import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type {
  BotDefinition,
  BotRun,
  BotsBatchInput,
  BotLibraryStatusReport,
  BotsSaveInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import { PullRequestService } from "../../pullRequest/PullRequestService.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { WorkspaceEntries } from "../../workspace/WorkspaceEntries.ts";
import { make } from "./BotBatches.ts";
import { inProcessClient } from "./BotLibraryClient.ts";
import { BotLibraryService, layer as libraryLayer } from "./BotLibraryService.ts";
import { makeSharing } from "./BotSharing.ts";
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
      get: () => Effect.succeedSome({ workspaceRoot: "/repo", deletedAt: null }),
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

const laptop = EnvironmentId.make("env-laptop");
const studio = EnvironmentId.make("env-studio");
const libraryProject = "library-project-a";

const makeRemoteBatches = (harness: Harness, fields: Partial<BotsSaveInput> = {}) =>
  Effect.gen(function* () {
    const { bots, batches } = yield* makeBatches(harness);
    const built = yield* Layer.build(
      libraryLayer.pipe(
        Layer.provide(
          ConfigProvider.layer(ConfigProvider.fromEnv({ env: { LOOM_LIBRARY_AUTHORITY: "true" } })),
        ),
      ),
    );
    const library = Context.get(built, BotLibraryService);
    const submitted = yield* Queue.unbounded<string>();
    const client = inProcessClient(library, laptop, Effect.succeed("Laptop"));
    const sharing = yield* makeSharing({
      bots,
      client: {
        ...client,
        submit: (input) =>
          client
            .submit(input)
            .pipe(Effect.andThen(Queue.offer(submitted, input.request.requestId)), Effect.asVoid),
      },
      projects: {
        toLibrary: () => Effect.succeed(libraryProject),
        toLocal: () => Effect.succeed(projectId),
        libraryProjects: Effect.succeed([libraryProject]),
        readiness: () => Effect.succeed([]),
      },
      vault: {
        status: Effect.succeed({ backend: "openbao", state: "ready", origin: null }),
        describe: () => Effect.succeed(null),
      },
      modelEnabled: () => Effect.succeed(true),
      modelReadiness: () => Effect.succeed([]),
    });
    yield* bots.setAnywhereHooks(sharing.hooks);
    yield* bots.save(reviewer(fields), USER_CALLER);
    yield* sharing.share("reviewer");
    const report = (freeSlots: number, activeRequestIds: readonly string[] = []) =>
      library.reportStatus(studio, {
        label: "Studio",
        acceptRemote: true,
        runtimeModeCeiling: "auto",
        freeSlots,
        activeRequestIds,
        projects: [{ libraryProjectId: libraryProject, ready: true, reasons: [] }],
        bots: [{ libraryBotId: "reviewer", revision: 1, ready: true, reasons: [], freeSlots }],
      } satisfies BotLibraryStatusReport);
    const finish = (id: string) =>
      bots.applyRemoteUpdate(id, {
        _tag: "terminal",
        label: "Studio",
        status: "completed",
        startedAt: null,
        finishedAt: "1970-01-01T00:00:00.000Z",
        result: "Reviewed.",
        resultTruncated: false,
        error: null,
        verdict: null,
        usage: null,
        modelSelection: null,
      });
    return { bots, batches, library, sharing, report, finish, next: Queue.take(submitted) };
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

  it.effect("adapts a remote batch to changing target slots without requester permits", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches, report, finish, next } = yield* makeRemoteBatches(harness);
        yield* report(1);
        const batch = yield* batches.runBatch(
          {
            ...lines("a.ts\nb.ts\nc.ts\nd.ts"),
            target: { type: "environment", environmentId: studio },
          },
          USER_CALLER,
        );
        const first = yield* next;
        expect((yield* batches.get(batch.id)).items.map((item) => item.state)).toEqual([
          "started",
          "pending",
          "pending",
          "pending",
        ]);
        expect(yield* bots.activeRuns).toBe(0);
        // The target can expand the window while the first remote run is still in flight.
        yield* report(2, [first]);
        yield* TestClock.adjust("5 seconds");
        const second = yield* next;
        const third = yield* next;
        expect((yield* batches.get(batch.id)).items.map((item) => item.state)).toEqual([
          "started",
          "started",
          "started",
          "pending",
        ]);
        // A lower capacity holds the remaining item even when a previous run finishes.
        yield* report(0, [second, third]);
        yield* finish(first);
        yield* TestClock.adjust("5 seconds");
        expect((yield* batches.get(batch.id)).items[3]?.state).toBe("pending");
        expect((yield* batches.get(batch.id)).batch.counts.failed).toBe(0);
        yield* report(1, [second, third]);
        yield* TestClock.adjust("5 seconds");
        const fourth = yield* next;
        yield* finish(second);
        yield* finish(third);
        yield* finish(fourth);
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { completed: 4, failed: 0 },
        });
        expect(harness.launches).toHaveLength(0);
      }),
    ),
  );

  it.effect("reselects Best for each pending item as local and remote slots change", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { batches, report, finish, next } = yield* makeRemoteBatches(harness);
        yield* report(1);
        const batch = yield* batches.runBatch(
          { ...lines("a.ts\nb.ts\nc.ts"), target: { type: "best" } },
          USER_CALLER,
        );
        const local = yield* harness.nextLaunch;
        const remote = yield* next;
        const { items } = yield* batches.get(batch.id);
        expect(items.map((item) => item.state)).toEqual(["started", "started", "pending"]);
        expect(items[0]?.run?.ranOn).toBeUndefined();
        expect(items[1]?.run?.ranOn?.environmentId).toBe(studio);
        yield* harness.end(local.threadId!, { status: "completed", reply: "Local review." });
        yield* endNext(harness, "completed", "Another local review.");
        yield* finish(remote);
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { completed: 3 },
        });
      }),
    ),
  );

  it.effect("keeps remote items pending at the requester's budget despite spare target slots", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches, report, next } = yield* makeRemoteBatches(harness, {
          budget: { runsPerDay: 1 },
        });
        yield* report(3);
        const paused = yield* batches.changes.pipe(
          Stream.filter((change) => change._tag === "batch" && change.batch.pausedUntil != null),
          Stream.runHead,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const batch = yield* batches.runBatch(
          { ...lines("a.ts\nb.ts"), target: { type: "environment", environmentId: studio } },
          USER_CALLER,
        );
        const remote = yield* next;
        yield* Fiber.join(paused);
        const { batch: waiting, items } = yield* batches.get(batch.id);
        expect(waiting.pausedUntil).toBe(
          isoAt(Date.parse((yield* bots.getRun(remote)).createdAt) + BUDGET_WINDOW_MS),
        );
        expect(items.map((item) => item.state)).toEqual(["started", "pending"]);
        expect((yield* batches.cancel(batch.id)).status).toBe("cancelled");
      }),
    ),
  );

  it.effect("recovers a remote batch without resubmitting its in-flight item", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches, report, finish, next } = yield* makeRemoteBatches(harness);
        yield* report(1);
        const definition = yield* bots.get("reviewer");
        const store = yield* makeBotBatchesStore;
        const stored = {
          ...storedBatch(definition, "remote-recovery", "running", 0),
          target: { type: "environment" as const, environmentId: studio },
        };
        yield* store.insertBatch(stored, [
          { label: "a.ts", inputs: { file: "a.ts" } },
          { label: "b.ts", inputs: { file: "b.ts" } },
        ]);
        yield* bots.startRunWith(
          definition,
          { botId: "reviewer", projectId, inputs: { file: "a.ts" }, target: stored.target },
          USER_CALLER,
          {
            batchId: stored.batch.id,
            onInserted: (run) => store.setItemState(stored.batch.id, 0, "started", run.id),
          },
        );
        const first = yield* next;
        yield* bots.markRecovered;
        yield* batches.recover();
        yield* TestClock.adjust("5 seconds");
        expect((yield* batches.get(stored.batch.id)).items.map((item) => item.state)).toEqual([
          "started",
          "pending",
        ]);
        yield* finish(first);
        const second = yield* next;
        yield* finish(second);
        expect(yield* batches.awaitBatch(stored.batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { completed: 2 },
        });
        expect(
          (yield* bots.listRuns({ botId: "reviewer", limit: 10 })).runs.map((run) => run.id).sort(),
        ).toEqual([first, second].sort());
      }),
    ),
  );

  it.effect("cancels a remote batch waiting for a busy target without creating runs", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches, report } = yield* makeRemoteBatches(harness);
        yield* report(0);
        const batch = yield* batches.runBatch(
          { ...lines("a.ts\nb.ts"), target: { type: "environment", environmentId: studio } },
          USER_CALLER,
        );
        yield* TestClock.adjust("5 seconds");
        expect((yield* batches.get(batch.id)).items.map((item) => item.state)).toEqual([
          "pending",
          "pending",
        ]);
        expect(yield* batches.cancel(batch.id)).toMatchObject({
          status: "cancelled",
          counts: { skipped: 2 },
        });
        yield* report(2);
        yield* TestClock.adjust("5 seconds");
        expect((yield* bots.listRuns({ botId: "reviewer", limit: 10 })).runs).toHaveLength(0);
        expect(harness.launches).toHaveLength(0);
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

  it.effect("retries completed items with a fail verdict without rerunning passing items", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches } = yield* makeBatches(harness);
        yield* bots.save(reviewer({ output: "verdict" }), USER_CALLER);
        const batch = yield* batches.runBatch(lines("a.ts\nb.ts"), USER_CALLER);
        yield* endNext(harness, "completed", '{"verdict":"fail","summary":"Bug found."}');
        yield* endNext(harness, "completed", '{"verdict":"pass","summary":"Fine."}');
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { fail: 1, pass: 1 },
        });

        expect(
          yield* batches.retry({ batchId: batch.id, include: "failed" }, USER_CALLER),
        ).toMatchObject({ retried: 1 });
        expect(
          yield* endNext(harness, "completed", '{"verdict":"pass","summary":"Fixed."}'),
        ).toContain("Review a.ts.");
        expect(yield* batches.awaitBatch(batch.id, WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { pass: 2 },
        });
        expect(harness.launches).toHaveLength(3);
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
        // The feeder reruns the item, so the inbox offers no retry of the run that never started.
        expect((yield* bots.inbox({ limit: 10 })).runs).toEqual([]);
        // Even put back from the dismissed view, it cannot run the item a second time.
        yield* bots.dismiss({ runIds: [queued.id], dismissed: false });
        const retried = yield* bots.retry({ runId: queued.id }, USER_CALLER).pipe(Effect.flip);
        expect(retried.message).toBe("Its batch already runs this item again.");

        expect(yield* endNext(harness, "completed", "Fine.")).toBe("Review a.ts.");
        expect(yield* batches.awaitBatch("batch-1", WAIT_MS)).toMatchObject({
          status: "finished",
          counts: { completed: 1 },
        });
      }),
    ),
  );

  it.effect(
    "retries an inbox run whose batch is gone, and keeps a retry its batch did not requeue",
    () =>
      withHarness((harness) =>
        Effect.gen(function* () {
          const { bots } = yield* makeBatches(harness);
          const bot = yield* bots.save(reviewer(), USER_CALLER);
          const batchStore = yield* makeBotBatchesStore;
          const failedRun = (id: string, batchId: string): BotRun => ({
            id,
            botId: bot.id,
            botVersion: 1,
            botName: bot.name,
            threadId: ThreadId.make(`bot-run-${id}`),
            projectId,
            inputs: { file: "a.ts" },
            status: "failed",
            startedBy: "user",
            callerThreadId: null,
            createdAt: "2026-10-20T10:00:01.000Z",
            startedAt: "2026-10-20T10:00:02.000Z",
            finishedAt: "2026-10-20T10:00:03.000Z",
            result: null,
            resultTruncated: false,
            error: "It broke.",
            batchId,
          });
          // A pruned batch took its items with it; nothing else reruns the run.
          yield* (yield* makeBotsStore).insertRun(failedRun("pruned-run", "pruned-batch"));
          const retried = yield* bots.retry({ runId: "pruned-run" }, USER_CALLER);
          expect(retried).toMatchObject({ retryOf: "pruned-run", batchId: "pruned-batch" });

          // A requeue for a run the item no longer holds leaves the item on its newer run.
          yield* batchStore.insertBatch(storedBatch(bot, "batch-1", "running", 0), [
            { label: "a.ts", inputs: { file: "a.ts" } },
          ]);
          yield* batchStore.setItemState("batch-1", 0, "started", "newer-run");
          yield* batchStore.requeueItem("batch-1", 0, [], "older-run");
          expect((yield* batchStore.getItems("batch-1"))[0]).toMatchObject({ state: "started" });
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
