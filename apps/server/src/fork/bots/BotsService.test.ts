import { describe, expect, it } from "@effect/vitest";
import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import type { BotRun, BotStarterId, BotsSaveInput } from "@t3tools/contracts/fork";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import * as ThreadLaunch from "../../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { make, USER_CALLER } from "./BotsService.ts";
import { BotsMigrations } from "./migrations.ts";
import { starterById } from "./starters.ts";

const projectId = ProjectId.make("project-a");
const model: ModelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "test" };

/** Settings where no provider a starter could fall back to is enabled. */
const NO_PROVIDERS = Object.fromEntries(
  ["codex", "claudeAgent", "cursor", "grok", "muse", "pi", "opencode", "antigravity"].map(
    (driver) => [driver, { driver, enabled: false, config: {} }],
  ),
);

const reviewer = (fields: Partial<BotsSaveInput> = {}): BotsSaveInput => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews one file.",
  instructions: "Review {{file}}.",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: model,
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
  const sent: Array<ThreadManagement.ThreadManagementSendInput> = [];
  const receipts = new Set<string>();
  const state = {
    timeOut: false,
    sendError: null as unknown,
    settings: { defaultModelSelection: model as ModelSelection | null, providerInstances: {} },
  };
  const shells = new Map<string, Partial<OrchestrationV2ThreadShell>>();
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
    getThreadShell: (threadId: string) =>
      Effect.sync(() => {
        const shell = shells.get(threadId);
        return shell === undefined ? null : { deletedAt: null, archivedAt: null, ...shell };
      }),
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
    hasReceipt: (commandId: string) => Effect.sync(() => receipts.has(commandId)),
    sendToThread: (input: ThreadManagement.ThreadManagementSendInput) =>
      Effect.gen(function* () {
        if (state.sendError !== null) return yield* Effect.fail(state.sendError);
        sent.push(input);
        receipts.add(input.commandId);
        return {};
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

  const settingsService = {
    getSettings: Effect.sync(() => state.settings),
  } as unknown as ServerSettings.ServerSettingsService["Service"];

  const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(ServerSettings.ServerSettingsService, settingsService),
      Effect.provideService(ThreadManagement.ThreadManagementService, threads),
      Effect.provideService(ThreadLaunch.ThreadLaunchService, launchService),
      Effect.provideService(ManagedProjectFolders.ManagedProjectFolders, folders),
    );

  return {
    launches,
    sent,
    receipts,
    interrupted,
    state,
    shells,
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

const storedRun = (id: string, botId: string, botVersion: number): BotRun => ({
  id,
  botId,
  botVersion,
  botName: botId,
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId,
  inputs: {},
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  startedAt: "2026-10-20T10:00:01.000Z",
  finishedAt: "2026-10-20T10:01:00.000Z",
  result: null,
  resultTruncated: false,
  error: null,
});

describe("BotsService starters", () => {
  it.effect("offers each starter once and never brings back a deleted one", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.seedStarters();
        const seeded = yield* bots.list();
        expect(seeded.map((bot) => bot.id).sort()).toEqual([
          "merge-conflict-resolver",
          "reviewer",
          "verifier",
        ]);
        for (const bot of seeded)
          expect(bot).toMatchObject({
            version: 1,
            createdBy: "user",
            modelSelection: model,
            origin: { kind: "starter", starterId: bot.id, revision: 1 },
          });

        yield* bots.delete("reviewer");
        yield* bots.seedStarters();
        expect((yield* bots.list()).map((bot) => bot.id).sort()).toEqual([
          "merge-conflict-resolver",
          "verifier",
        ]);
        expect(
          (yield* bots.listStarters()).map(({ starterId, state }) => [starterId, state]),
        ).toEqual([
          ["merge-conflict-resolver", "present"],
          ["reviewer", "removed"],
          ["verifier", "present"],
        ]);
      }),
    ),
  );

  it.effect("leaves a person's bot that already owns a starter id alone", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ id: "verifier", name: "Mine" }), USER_CALLER);
        yield* bots.seedStarters();
        expect(yield* bots.list()).toContainEqual(
          expect.objectContaining({ id: "verifier", name: "Mine", version: 1 }),
        );
        expect((yield* bots.list()).find((bot) => bot.id === "verifier")?.origin).toBeUndefined();
        expect((yield* bots.listStarters()).find((s) => s.starterId === "verifier")).toMatchObject({
          state: "removed",
        });
      }),
    ),
  );

  it.effect("postpones seeding until a provider can run the starters", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        harness.state.settings = { defaultModelSelection: null, providerInstances: NO_PROVIDERS };
        yield* bots.seedStarters();
        expect(yield* bots.list()).toEqual([]);
        expect(yield* bots.listStarters()).toEqual([]);

        harness.state.settings = { defaultModelSelection: model, providerInstances: {} };
        yield* bots.seedStarters();
        expect(yield* bots.list()).toHaveLength(3);
      }),
    ),
  );

  it.effect("restores the shipped text over edits, keeping the model and unarchiving", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.seedStarters();
        const shipped = starterById("reviewer")!.definition;
        const current = (yield* bots.list()).find((bot) => bot.id === "reviewer")!;
        const otherModel = { ...model, model: "other" };
        const edited = yield* bots.save(
          {
            ...current,
            instructions: "Just look at {{target}} with {{lens}}.",
            modelSelection: otherModel,
          },
          USER_CALLER,
        );
        expect(edited.origin).toMatchObject({ starterId: "reviewer" });
        yield* bots.archive("reviewer", true);
        expect((yield* bots.listStarters()).find((s) => s.starterId === "reviewer")).toMatchObject({
          state: "edited",
        });

        const restored = yield* bots.restoreStarter("reviewer", USER_CALLER);
        expect(restored).toMatchObject({
          version: 3,
          instructions: shipped.instructions,
          modelSelection: otherModel,
          archivedAt: null,
        });
        expect((yield* bots.listStarters()).find((s) => s.starterId === "reviewer")).toMatchObject({
          state: "present",
        });
      }),
    ),
  );

  it.effect("recreates a deleted starter above every version its runs recorded", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const bots = yield* harness.service;
        yield* bots.seedStarters();
        yield* store.insertRun(storedRun("old-run", "verifier", 7));
        yield* bots.delete("verifier");
        expect(yield* bots.restoreStarter("verifier", USER_CALLER)).toMatchObject({
          version: 8,
          origin: { starterId: "verifier", revision: 1 },
        });
      }),
    ),
  );

  it.effect("reports a starter whose shipped text is newer, and refuses unknown starters", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const bots = yield* harness.service;
        yield* bots.seedStarters();
        const resolver = (yield* bots.list()).find((bot) => bot.id === "merge-conflict-resolver")!;
        yield* store.putDefinition({
          ...resolver,
          origin: { kind: "starter", starterId: "merge-conflict-resolver", revision: 0 },
        });
        expect(
          (yield* bots.listStarters()).find((s) => s.starterId === "merge-conflict-resolver"),
        ).toMatchObject({ state: "outdated" });
        expect(
          yield* Effect.flip(bots.restoreStarter("nope" as BotStarterId, USER_CALLER)),
        ).toMatchObject({ reason: "not_found" });
      }),
    ),
  );
});

describe("BotsService caller checkouts", () => {
  const otherProject = ProjectId.make("project-b");
  const inCheckout = reviewer({
    workspace: { type: "project", projectId: null, worktree: false, checkout: "caller" },
  });
  const agentIn = (threadId: string) => ({
    actor: "agent" as const,
    threadId: ThreadId.make(threadId),
    projectId,
    runtimeMode: "full-access" as const,
  });

  it.effect("runs in the calling or chosen thread's checkout", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(inCheckout, USER_CALLER);
        harness.shells.set("integration", {
          projectId,
          worktreePath: "/work/integration",
          branch: "integration",
        });
        harness.shells.set("main-thread", { projectId, worktreePath: null, branch: null });

        const first = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" } },
          agentIn("integration"),
        );
        expect(yield* harness.nextLaunch).toMatchObject({
          projectId,
          workspaceStrategy: {
            type: "existing_worktree",
            worktreePath: "/work/integration",
            branch: "integration",
          },
        });

        yield* harness.end(first.threadId, { status: "completed", reply: "Done." });
        yield* bots.run(
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            checkoutThreadId: ThreadId.make("main-thread"),
          },
          agentIn("integration"),
        );
        expect(yield* harness.nextLaunch).toMatchObject({ workspaceStrategy: { type: "root" } });
      }),
    ),
  );

  it.effect("refuses a checkout from another project or no checkout at all", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(inCheckout, USER_CALLER);
        harness.shells.set("elsewhere", {
          projectId: otherProject,
          worktreePath: "/w",
          branch: null,
        });
        expect(
          yield* Effect.flip(
            bots.run(
              {
                botId: "reviewer",
                inputs: { file: "a.ts" },
                projectId,
                checkoutThreadId: ThreadId.make("elsewhere"),
              },
              USER_CALLER,
            ),
          ),
        ).toMatchObject({ reason: "invalid" });
        expect(
          yield* Effect.flip(
            bots.run({ botId: "reviewer", inputs: { file: "a.ts" } }, USER_CALLER),
          ),
        ).toMatchObject({ reason: "invalid" });
        expect(
          yield* Effect.flip(
            bots.run({ botId: "reviewer", inputs: { file: "a.ts" } }, agentIn("missing")),
          ),
        ).toMatchObject({ reason: "invalid" });
        expect(harness.launches).toEqual([]);

        // A person who picks a project without a checkout gets its root.
        yield* bots.run({ botId: "reviewer", inputs: { file: "a.ts" }, projectId }, USER_CALLER);
        expect(yield* harness.nextLaunch).toMatchObject({ workspaceStrategy: { type: "root" } });
      }),
    ),
  );

  it.effect("ignores a chosen checkout for a bot that runs in the project root", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        harness.shells.set("integration", { projectId, worktreePath: "/w", branch: null });
        yield* bots.run(
          {
            botId: "reviewer",
            inputs: { file: "a.ts" },
            projectId,
            checkoutThreadId: ThreadId.make("integration"),
          },
          USER_CALLER,
        );
        expect(yield* harness.nextLaunch).toMatchObject({ workspaceStrategy: { type: "root" } });
      }),
    ),
  );
});

describe("BotsService invocation", () => {
  const callerId = ThreadId.make("chat");

  it.effect("checks the thread a person runs a bot from", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        harness.shells.set("chat", { projectId, worktreePath: null, branch: null });
        harness.shells.set("old", { projectId, archivedAt: DateTime.makeUnsafe("2026-10-01") });
        harness.shells.set("gone", { projectId, deletedAt: DateTime.makeUnsafe("2026-10-01") });
        expect(yield* bots.threadCaller(callerId)).toEqual({
          actor: "user",
          threadId: callerId,
          projectId,
          runtimeMode: null,
        });
        for (const threadId of ["old", "gone", "missing", "bot-run-x"])
          expect(yield* Effect.flip(bots.threadCaller(ThreadId.make(threadId)))).toMatchObject({
            reason: "invalid",
          });
      }),
    ),
  );

  it.effect("refuses a bot run starting a bot, and notify without a thread", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const input = { botId: "reviewer", inputs: { file: "a.ts" }, projectId };
        expect(
          yield* Effect.flip(
            bots.run(input, {
              actor: "agent",
              threadId: ThreadId.make("bot-run-parent"),
              projectId,
              runtimeMode: "full-access",
            }),
          ),
        ).toMatchObject({ reason: "permission" });
        expect(yield* Effect.flip(bots.run({ ...input, notify: true }, USER_CALLER))).toMatchObject(
          { reason: "invalid" },
        );
        expect(harness.launches).toEqual([]);
      }),
    ),
  );

  it.effect("posts a finished run's result to the calling thread once", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ maxConcurrentRuns: 3 }), USER_CALLER);
        harness.shells.set("chat", { projectId, worktreePath: null, branch: null });
        const caller = yield* bots.threadCaller(callerId);
        const input = { botId: "reviewer", inputs: { file: "a.ts" }, projectId };

        const done = yield* bots.run({ ...input, notify: true }, caller);
        expect(done).toMatchObject({ callerThreadId: callerId, notify: true });
        yield* harness.end(done.threadId, { status: "completed", reply: "Looks fine." });
        expect(yield* bots.awaitRun(done.id, 60_000)).toMatchObject({ status: "completed" });
        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]).toMatchObject({
          projectId,
          threadId: callerId,
          commandId: `bot-run-notify:${done.id}`,
          senderThreadId: done.threadId,
          mode: "auto",
          createdBy: "system",
          creationSource: "server",
        });
        expect(harness.sent[0]!.text).toMatch(/^Bot run finished: Reviewer \(completed, \d+s\)\n/);
        expect(harness.sent[0]!.text).toContain(`Run id: ${done.id}\n\nLooks fine.`);

        const failed = yield* bots.run({ ...input, notify: true }, caller);
        yield* harness.end(failed.threadId, { status: "failed", reply: null });
        yield* bots.awaitRun(failed.id, 60_000);
        expect(harness.sent[1]!.text).toContain("The run ended as failed.");

        const quiet = yield* bots.run(input, caller);
        yield* harness.end(quiet.threadId, { status: "completed", reply: "Shh." });
        yield* bots.awaitRun(quiet.id, 60_000);
        expect(harness.sent).toHaveLength(2);
      }),
    ),
  );

  it.effect("notes a failed delivery on the run without changing its status", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        harness.shells.set("chat", { projectId, worktreePath: null, branch: null });
        const caller = yield* bots.threadCaller(callerId);
        harness.state.sendError = new ThreadManagement.ThreadManagementThreadArchivedError({
          threadId: callerId,
        });
        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" }, projectId, notify: true },
          caller,
        );
        yield* harness.end(run.threadId, { status: "completed", reply: "Done." });
        yield* bots.awaitRun(run.id, 60_000);
        expect(yield* bots.getRun(run.id)).toMatchObject({
          status: "completed",
          result: "Done.",
          error: "Result delivery failed: the calling thread is archived.",
        });
      }),
    ),
  );

  it.effect("delivers a result a stopped server never posted, once", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const bots = yield* harness.service;
        harness.shells.set("chat", { projectId, worktreePath: null, branch: null });
        const pending = {
          ...storedRun("pending", "reviewer", 1),
          callerThreadId: callerId,
          notify: true,
        };
        const replayed = {
          ...storedRun("replayed", "reviewer", 1),
          callerThreadId: callerId,
          notify: true,
        };
        yield* store.insertRun(pending);
        yield* store.insertRun(replayed);
        harness.receipts.add("bot-run-notify:replayed");

        yield* bots.recover();
        expect(harness.sent.map((input) => input.commandId)).toEqual(["bot-run-notify:pending"]);
        yield* bots.recover();
        expect(harness.sent).toHaveLength(1);
      }),
    ),
  );
});
