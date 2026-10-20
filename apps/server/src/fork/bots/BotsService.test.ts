import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotRun, BotsSaveInput } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { make, USER_CALLER } from "./BotsService.ts";
import { BotsMigrations } from "./migrations.ts";

const projectId = ProjectId.make("project-a");

const reviewer = (fields: Partial<BotsSaveInput> = {}): BotsSaveInput => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews one file.",
  instructions: "Review {{file}}.",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "project", projectId: null, worktree: false },
  timeoutMinutes: 5,
  maxConcurrentRuns: 1,
  scopeProjectId: null,
  ...fields,
});

interface ThreadOutcome {
  readonly status: "completed" | "failed" | "interrupted";
  readonly reply: string | null;
}

/** Fake launch and thread services: a test decides when and how each run thread ends. */
const makeHarness = Effect.gen(function* () {
  const launched = yield* Queue.unbounded<ThreadLaunch.ThreadLaunchInput>();
  const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
  const interrupted: Array<string> = [];
  const outcomes = new Map<string, Deferred.Deferred<ThreadOutcome>>();
  const replies = new Map<string, string>();
  const state = { timeOut: false };
  const outcomeFor = (threadId: string) => {
    const existing = outcomes.get(threadId);
    if (existing !== undefined) return existing;
    const created = Deferred.makeUnsafe<ThreadOutcome>();
    outcomes.set(threadId, created);
    return created;
  };
  const end = (threadId: string, outcome: ThreadOutcome) =>
    Effect.sync(() => {
      if (outcome.reply !== null && !replies.has(threadId)) replies.set(threadId, outcome.reply);
    }).pipe(Effect.andThen(Deferred.succeed(outcomeFor(threadId), outcome)), Effect.asVoid);

  const threads = {
    waitForThread: (input: ThreadManagement.ThreadManagementWaitInput) =>
      Effect.gen(function* () {
        if (state.timeOut && !interrupted.includes(input.threadId))
          return { threadId: input.threadId, run: { status: "running" }, timedOut: true };
        const outcome = yield* Deferred.await(outcomeFor(input.threadId));
        return { threadId: input.threadId, run: { status: outcome.status }, timedOut: false };
      }),
    interruptThread: (input: ThreadManagement.ThreadManagementInterruptInput) =>
      Effect.gen(function* () {
        interrupted.push(input.threadId);
        yield* end(input.threadId, { status: "interrupted", reply: "Partial notes." });
        return {};
      }),
    getProjectThreadRecords: (input: { readonly threadId: ThreadId }) =>
      Effect.sync(() => {
        const reply = replies.get(input.threadId);
        return {
          messages: [
            { role: "user", text: "brief" },
            ...(reply === undefined ? [] : [{ role: "assistant", text: reply }]),
          ],
        };
      }),
  } as unknown as ThreadManagement.ThreadManagementService["Service"];

  const launchService = {
    launch: (input: ThreadLaunch.ThreadLaunchInput) =>
      Effect.gen(function* () {
        launches.push(input);
        yield* Queue.offer(launched, input);
        return {
          threadId: input.threadId!,
          projection: { runs: [{ id: `run-${input.threadId}`, ordinal: 1, status: "running" }] },
          resumed: false,
        };
      }),
    checkWorktreeBase: () => Effect.void,
  } as unknown as ThreadLaunch.ThreadLaunchService["Service"];

  const folders = {
    ensureScratchProject: Effect.succeed({ projectId: ProjectId.make("scratch") }),
  } as unknown as ManagedProjectFolders.ManagedProjectFolders["Service"];

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ThreadManagement.ThreadManagementService, threads),
      Effect.provideService(ThreadLaunch.ThreadLaunchService, launchService),
      Effect.provideService(ManagedProjectFolders.ManagedProjectFolders, folders),
    );

  return {
    launches,
    interrupted,
    state,
    end,
    nextLaunch: Queue.take(launched),
    service: provide(make),
  };
});

type Harness = Effect.Success<typeof makeHarness>;

const withHarness = <A, E>(
  use: (harness: Harness) => Effect.Effect<A, E, SqlClient.SqlClient | Scope.Scope>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(BotsMigrations);
    return yield* use(yield* makeHarness);
  }).pipe(Effect.scoped, Effect.provide(SqlitePersistenceMemory));

describe("BotsService", () => {
  it.effect("launches a run with the bot's pinned settings and records its reply", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        const bot = yield* bots.save(reviewer(), USER_CALLER);
        expect(bot).toMatchObject({ version: 1, createdBy: "user", archivedAt: null });

        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        expect(run).toMatchObject({ status: "queued", threadId: `bot-run-${run.id}` });
        const launch = yield* harness.nextLaunch;
        expect(launch).toMatchObject({
          threadId: run.threadId,
          commandId: `bot-run:${run.id}`,
          projectId,
          title: "Reviewer",
          generateTitle: false,
          runtimeMode: "auto",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: { text: "Review a.ts.", attachments: [] },
          createdBy: "user",
          creationSource: "server",
        });

        yield* harness.end(run.threadId, { status: "completed", reply: "Looks fine." });
        expect(yield* bots.awaitRun(run.id, 60_000)).toMatchObject({
          status: "completed",
          result: "Looks fine.",
          error: null,
        });
        expect((yield* bots.listRuns({ limit: 10 })).runs).toHaveLength(1);
      }),
    ),
  );

  it.effect("queues runs past the bot's concurrency limit and cancels a queued one", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const start = (file: string) =>
          bots.run({ botId: "reviewer", inputs: { file }, projectId }, USER_CALLER);
        const first = yield* start("a.ts");
        const second = yield* start("b.ts");
        const third = yield* start("c.ts");
        expect((yield* harness.nextLaunch).threadId).toBe(first.threadId);
        expect(yield* bots.getRun(second.id)).toMatchObject({ status: "queued" });
        expect(bots.activeRunCount("reviewer")).toBe(3);

        expect(yield* bots.cancel(second.id)).toMatchObject({ status: "cancelled" });
        yield* harness.end(first.threadId, { status: "completed", reply: "A" });
        expect((yield* harness.nextLaunch).threadId).toBe(third.threadId);
        yield* harness.end(third.threadId, { status: "failed", reply: null });
        expect(yield* bots.awaitRun(third.id, 60_000)).toMatchObject({
          status: "failed",
          error: "The run ended as failed.",
        });
        expect(harness.launches.map((launch) => launch.threadId)).toEqual([
          first.threadId,
          third.threadId,
        ]);
      }),
    ),
  );

  it.effect("interrupts a run that passes its time limit and keeps the partial reply", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        harness.state.timeOut = true;
        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        expect(yield* bots.awaitRun(run.id, 60_000)).toMatchObject({
          status: "timed_out",
          result: "Partial notes.",
          error: "The run passed its 5 minute limit and was stopped.",
        });
        expect(harness.interrupted).toEqual([run.threadId]);
      }),
    ),
  );

  it.effect("cancels a running run by interrupting its thread", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        yield* harness.nextLaunch;
        yield* bots.cancel(run.id);
        expect(yield* bots.awaitRun(run.id, 60_000)).toMatchObject({
          status: "cancelled",
          result: "Partial notes.",
        });
      }),
    ),
  );

  it.effect("refuses broader agents, stale edits, archived bots and bad inputs", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const agent = {
          actor: "agent" as const,
          threadId: ThreadId.make("caller"),
          projectId,
          runtimeMode: "approval-required" as const,
        };
        expect(
          yield* Effect.flip(bots.run({ botId: "reviewer", inputs: { file: "a" } }, agent)),
        ).toMatchObject({ reason: "permission" });
        expect(yield* Effect.flip(bots.save(reviewer({ name: "Edited" }), agent))).toMatchObject({
          reason: "permission",
        });
        expect(
          yield* Effect.flip(bots.save(reviewer({ expectedVersion: 0 }), USER_CALLER)),
        ).toMatchObject({ reason: "invalid" });
        expect(yield* bots.save(reviewer({ expectedVersion: 1 }), USER_CALLER)).toMatchObject({
          version: 2,
        });
        expect(
          yield* Effect.flip(bots.run({ botId: "reviewer", inputs: {}, projectId }, USER_CALLER)),
        ).toMatchObject({ reason: "invalid", message: "File is required." });
        expect(
          yield* Effect.flip(bots.run({ botId: "reviewer", inputs: { file: "a" } }, USER_CALLER)),
        ).toMatchObject({ reason: "invalid", message: "Choose a project to run Reviewer in." });
        yield* bots.archive("reviewer", true);
        expect(
          yield* Effect.flip(
            bots.run({ botId: "reviewer", inputs: { file: "a" }, projectId }, USER_CALLER),
          ),
        ).toMatchObject({ reason: "archived" });
        expect(harness.launches).toEqual([]);
      }),
    ),
  );

  it.effect("settles runs a stopped server left behind", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const left = (id: string, status: BotRun["status"]): BotRun => ({
          id,
          botId: "reviewer",
          botVersion: 1,
          botName: "Reviewer",
          threadId: ThreadId.make(`bot-run-${id}`),
          projectId,
          inputs: { file: "a.ts" },
          status,
          startedBy: "user",
          callerThreadId: null,
          createdAt: "2026-10-20T10:00:00.000Z",
          startedAt: status === "running" ? "2026-10-20T10:00:01.000Z" : null,
          finishedAt: null,
          result: null,
          resultTruncated: false,
          error: null,
        });
        yield* store.insertRun(left("queued-run", "queued"));
        yield* store.insertRun(left("running-run", "running"));

        yield* bots.recover();
        expect(yield* bots.getRun("queued-run")).toMatchObject({
          status: "failed",
          error: "The server restarted before this run started.",
        });
        yield* harness.end("bot-run-running-run", { status: "completed", reply: "Done." });
        expect(yield* bots.awaitRun("running-run", 60_000)).toMatchObject({
          status: "completed",
          result: "Done.",
        });
        expect(harness.launches).toEqual([]);
      }),
    ),
  );
});
