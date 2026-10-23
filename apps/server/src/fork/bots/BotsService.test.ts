import { describe, expect, it } from "@effect/vitest";
import {
  DEFAULT_TEXT_GENERATION_MODEL,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  BOTS_MAX_ACTIVE_RUNS,
  BOTS_RESULT_MAX_BYTES,
  type BotRun,
  type BotStarterId,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { USER_CALLER, versionInput } from "./BotsService.ts";
import { NO_PROVIDERS, model, projectId, reviewer, withHarness } from "./testing/BotsHarness.ts";
import { starterById } from "./starters.ts";

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

  it.effect("cancels a run recovered after a restart by interrupting its thread", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const store = yield* makeBotsStore;
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        yield* store.insertRun({
          ...storedRun("running-run", "reviewer", 1),
          status: "running",
          finishedAt: null,
        });

        // A cancel that arrives before recovery waits for it instead of finding no live run.
        const cancelling = yield* Effect.forkChild(bots.cancel("running-run"));
        yield* Effect.yieldNow;
        yield* bots.recover();
        yield* bots.markRecovered;
        yield* Fiber.join(cancelling);
        expect(harness.interrupted).toEqual(["bot-run-running-run"]);
        expect(yield* bots.awaitRun("running-run", 60_000)).toMatchObject({
          status: "cancelled",
          result: "Partial notes.",
        });
      }),
    ),
  );

  it.effect("recovers a run with the output format of the version that started it", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ output: "verdict" }), USER_CALLER);
        yield* bots.save(reviewer({ output: "text" }), USER_CALLER);
        yield* (yield* makeBotsStore).insertRun({
          ...storedRun("running-run", "reviewer", 1),
          status: "running",
          finishedAt: null,
        });

        yield* bots.recover();
        yield* harness.end("bot-run-running-run", {
          status: "completed",
          reply: '{"verdict":"fail","summary":"One bug."}',
        });
        expect(yield* bots.awaitRun("running-run", 60_000)).toMatchObject({
          status: "completed",
          verdict: { verdict: "fail", summary: "One bug." },
        });
      }),
    ),
  );

  it.effect("counts a recovered run against the bot's concurrency limit", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        yield* (yield* makeBotsStore).insertRun({
          ...storedRun("running-run", "reviewer", 1),
          status: "running",
          finishedAt: null,
        });
        yield* bots.recover();
        const next = yield* bots.run(
          { botId: "reviewer", inputs: { file: "next.ts" }, projectId },
          USER_CALLER,
        );
        yield* Effect.yieldNow;
        expect((yield* bots.getRun(next.id)).status).toBe("queued");
        yield* harness.end("bot-run-running-run", { status: "completed", reply: "Recovered." });
        expect((yield* harness.nextLaunch).threadId).toBe(next.threadId);
        yield* harness.end(next.threadId, { status: "completed", reply: "Next." });
        expect((yield* bots.awaitRun(next.id)).status).toBe("completed");
      }),
    ),
  );

  it.effect("counts recovered runs against the shared environment limit", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ maxConcurrentRuns: BOTS_MAX_ACTIVE_RUNS }), USER_CALLER);
        yield* bots.save(reviewer({ id: "another-bot" }), USER_CALLER);
        const store = yield* makeBotsStore;
        for (let index = 0; index < BOTS_MAX_ACTIVE_RUNS; index++)
          yield* store.insertRun({
            ...storedRun(`recovered-${index}`, "reviewer", 1),
            status: "running",
            finishedAt: null,
          });
        yield* bots.recover();
        const next = yield* bots.run(
          { botId: "another-bot", inputs: { file: "next.ts" }, projectId },
          USER_CALLER,
        );
        yield* Effect.yieldNow;
        expect((yield* bots.getRun(next.id)).status).toBe("queued");
        yield* harness.end("bot-run-recovered-0", { status: "completed", reply: "Recovered." });
        expect((yield* harness.nextLaunch).threadId).toBe(next.threadId);
        yield* harness.end(next.threadId, { status: "completed", reply: "Next." });
        expect((yield* bots.awaitRun(next.id)).status).toBe("completed");
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

const namedProviderInstances = {
  ...NO_PROVIDERS,
  [ProviderInstanceId.make("grok")]: {
    driver: ProviderDriverKind.make("grok"),
    enabled: true,
    config: {},
  },
  [ProviderInstanceId.make("claude_1")]: {
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    config: {},
  },
  [ProviderInstanceId.make("codex_disabled")]: {
    driver: ProviderDriverKind.make("codex"),
    enabled: false,
    config: {},
  },
  [ProviderInstanceId.make("codex_1")]: {
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    config: {},
  },
  [ProviderInstanceId.make("codex_2")]: {
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    config: {},
  },
} satisfies ServerSettings["providerInstances"];

describe("BotsService starters", () => {
  it.effect("seeds with an enabled named Codex account before another driver's built-in", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        harness.state.settings = {
          defaultModelSelection: null,
          providerInstances: namedProviderInstances,
        };

        yield* bots.seedStarters();

        const seeded = yield* bots.list();
        expect(seeded).toHaveLength(3);
        for (const bot of seeded)
          expect(bot.modelSelection).toEqual({
            instanceId: "codex_1",
            model: DEFAULT_TEXT_GENERATION_MODEL,
          });
      }),
    ),
  );

  it.effect("keeps an explicitly preferred model and its options on a named account", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        const preferred = {
          instanceId: ProviderInstanceId.make("claude_1"),
          model: "claude-fable-5-1",
          options: [{ id: "effort", value: "max" }],
        };
        harness.state.settings = {
          defaultModelSelection: preferred,
          providerInstances: namedProviderInstances,
        };

        yield* bots.seedStarters();

        const seeded = yield* bots.list();
        expect(seeded).toHaveLength(3);
        for (const bot of seeded) expect(bot.modelSelection).toEqual(preferred);
      }),
    ),
  );

  it.effect("falls back to an enabled named account when the preferred account is disabled", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        harness.state.settings = {
          defaultModelSelection: model,
          providerInstances: namedProviderInstances,
        };

        const restored = yield* bots.restoreStarter("reviewer", USER_CALLER);

        expect(restored.modelSelection).toEqual({
          instanceId: "codex_1",
          model: DEFAULT_TEXT_GENERATION_MODEL,
        });
      }),
    ),
  );

  it.effect("keeps saved bot models when starter defaults change", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.seedStarters();
        const current = (yield* bots.list()).find((bot) => bot.id === "reviewer")!;
        const saved = yield* bots.save(
          { ...current, modelSelection: { ...model, model: "chosen-model" } },
          USER_CALLER,
        );
        harness.state.settings = {
          defaultModelSelection: null,
          providerInstances: namedProviderInstances,
        };

        yield* bots.seedStarters();
        expect((yield* bots.list()).find((bot) => bot.id === "reviewer")).toEqual(saved);
        expect((yield* bots.restoreStarter("reviewer", USER_CALLER)).modelSelection).toEqual(
          saved.modelSelection,
        );
      }),
    ),
  );

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
            origin: { kind: "starter", starterId: bot.id, revision: starterById(bot.id)!.revision },
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
          origin: { starterId: "verifier", revision: 2 },
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

describe("BotsService verdicts", () => {
  it.effect("asks for a verdict, records it, and filters runs by it", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ output: "verdict", maxConcurrentRuns: 4 }), USER_CALLER);
        const input = { botId: "reviewer", inputs: { file: "a.ts" }, projectId };

        const failing = yield* bots.run(input, USER_CALLER);
        const launch = yield* harness.nextLaunch;
        expect(launch.initialMessage?.text).toMatch(/^Review a\.ts\.\n\n## Reply format\n/);
        yield* harness.end(failing.threadId, {
          status: "completed",
          reply:
            '{"verdict":"fail","summary":"One bug.","findings":[{"title":"Off by one","detail":"","path":"a.ts","line":3}]}',
        });
        expect(yield* bots.awaitRun(failing.id, 60_000)).toMatchObject({
          status: "completed",
          verdict: { verdict: "fail", summary: "One bug.", source: "decoded" },
        });

        const prose = yield* bots.run(input, USER_CALLER);
        yield* harness.end(prose.threadId, { status: "completed", reply: "Seems fine." });
        expect(yield* bots.awaitRun(prose.id, 60_000)).toMatchObject({
          result: "Seems fine.",
          verdict: { verdict: "needs_attention", source: "invalid" },
        });

        const broken = yield* bots.run(input, USER_CALLER);
        yield* harness.end(broken.threadId, { status: "failed", reply: '{"verdict":"pass"}' });
        expect((yield* bots.awaitRun(broken.id, 60_000)).verdict).toBeUndefined();

        // The verdict is read from the whole reply, past the stored cap.
        const long = yield* bots.run(input, USER_CALLER);
        yield* harness.end(long.threadId, {
          status: "completed",
          reply: `${"x".repeat(BOTS_RESULT_MAX_BYTES)}\n{"verdict":"pass","summary":"Fine."}`,
        });
        expect(yield* bots.awaitRun(long.id, 60_000)).toMatchObject({
          resultTruncated: true,
          verdict: { verdict: "pass", source: "decoded" },
        });

        // A run keeps the reply format of the version it started with.
        const switched = yield* bots.run(input, USER_CALLER);
        yield* bots.save(reviewer({ maxConcurrentRuns: 4 }), USER_CALLER);
        yield* harness.end(switched.threadId, {
          status: "completed",
          reply: '{"verdict":"pass","summary":"Fine."}',
        });
        expect((yield* bots.awaitRun(switched.id, 60_000)).verdict).toMatchObject({
          verdict: "pass",
        });

        const failed = yield* bots.listRuns({ verdict: "fail", limit: 10 });
        expect(failed.runs.map((run) => run.id)).toEqual([failing.id]);
        expect(failed.runs[0]!.verdict?.findings).toEqual([
          { title: "Off by one", detail: "", path: "a.ts", line: 3 },
        ]);
        expect((yield* bots.listRuns({ limit: 10 })).runs).toHaveLength(5);
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

  it.effect("refuses a bot run changing a bot", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const latest = yield* bots.get("reviewer");
        const refused = yield* Effect.flip(
          bots.save(
            { ...versionInput(latest), instructions: "Something else {{file}}." },
            {
              actor: "agent",
              threadId: ThreadId.make("bot-run-parent"),
              projectId,
              runtimeMode: "full-access",
            },
          ),
        );
        expect(refused.message).toBe("A bot run cannot change bots.");
        expect((yield* bots.get("reviewer")).version).toBe(latest.version);
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
