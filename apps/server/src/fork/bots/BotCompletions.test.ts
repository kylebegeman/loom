import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, SecretRef } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as SqlClient from "effect/sql/SqlClient";
import type * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { ServerEnvironmentIdentity } from "../../environment/ServerEnvironment.ts";
import * as SecretRequests from "../../secrets/SecretRequests.ts";
import * as BotCompletions from "./BotCompletions.ts";
import * as BotOperations from "./BotOperations.ts";
import { makeBotCompletionStore } from "./BotCompletionStore.ts";
import { USER_CALLER } from "./BotsService.ts";
import { makeBotsStore } from "./BotsStore.ts";
import { makeBotBatchesStore, type StoredBatch } from "./BotBatchesStore.ts";
import { makePipelinesStore, type StoredPipelineRun } from "./pipelines/PipelinesStore.ts";
import { testBot, testRun } from "./testing/fixtures.ts";
import { projectId, reviewer, withHarness, type Harness } from "./testing/BotsHarness.ts";

const fixture = <A, E>(
  use: (f: {
    service: BotCompletions.BotCompletions["Service"];
    store: Effect.Success<typeof makeBotCompletionStore>;
    harness: Harness;
    secrets: Map<string, Uint8Array>;
    requests: Array<{ url: string; init: RequestInit | undefined }>;
    state: { statuses: number[]; loseResponse: boolean; badgeChanges: number };
  }) => Effect.Effect<A, E, SqlClient.SqlClient | Scope.Scope>,
) =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const secrets = new Map<string, Uint8Array>();
      const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
      const state = { statuses: [200], loseResponse: false, badgeChanges: 0 };
      const fetch: typeof globalThis.fetch = async (url, init) => {
        requests.push({ url: String(url), init });
        if (state.loseResponse) throw new Error("Fixture reply was lost.");
        return new Response(null, { status: state.statuses.shift() ?? 200 });
      };
      const values = new Map([
        ["secret-ref:url", "https://api2.cursor.sh/private/routine"],
        ["secret-ref:key", "fixture-routine-key"],
      ]);
      const dependencies = Layer.mergeAll(
        Layer.mock(BotOperations.BotOperations)({
          notifyBadgeChange: () =>
            Effect.sync(() => {
              state.badgeChanges++;
            }),
        }),
        FetchHttpClient.layer,
        Layer.succeed(FetchHttpClient.Fetch, fetch),
        Layer.succeed(ServerEnvironmentIdentity, {
          getEnvironmentId: Effect.succeed(EnvironmentId.make("fixture-computer")),
        }),
        Layer.mock(ServerSecretStore.ServerSecretStore)({
          get: (name) => Effect.succeed(Option.fromNullishOr(secrets.get(name))),
          set: (name, bytes) =>
            Effect.sync(() => {
              secrets.set(name, bytes);
            }),
          remove: (name) =>
            Effect.sync(() => {
              secrets.delete(name);
            }),
        }),
        Layer.mock(SecretRequests.SecretRequests)({
          transfer: (input, useValue) => {
            const value = values.get(input.ref);
            return value === undefined ? Effect.die("Missing fixture ref.") : useValue(value);
          },
        }),
      );
      const context = yield* Layer.build(BotCompletions.layer.pipe(Layer.provide(dependencies)));
      const service = Context.get(context, BotCompletions.BotCompletions);
      const store = yield* makeBotCompletionStore;
      return yield* use({ service, store, harness, secrets, requests, state }).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
      );
    }),
  );
const configure = (service: BotCompletions.BotCompletions["Service"], enabled = true) =>
  service.configureFromRefs({
    id: "grok-primary",
    label: "Grok main Bot",
    projectId,
    enabled,
    urlSecretRef: SecretRef.make("secret-ref:url"),
    keySecretRef: SecretRef.make("secret-ref:key"),
  });
const finishedRun = (f: {
  harness: Harness;
  store: Effect.Success<typeof makeBotCompletionStore>;
}) =>
  Effect.gen(function* () {
    const bots = yield* f.harness.service;
    yield* bots.save(reviewer(), USER_CALLER);
    const run = yield* bots.run(
      { botId: "reviewer", inputs: { file: "private-input.ts" }, projectId },
      USER_CALLER,
    );
    yield* f.store.prepare("run", run.id, projectId, "grok-primary");
    yield* f.harness.nextLaunch;
    yield* f.harness.end(run.threadId, {
      status: "completed",
      reply: "Private result that stays in Loom.",
    });
    yield* bots.awaitRun(run.id, 60_000);
    return run;
  });

it.effect(
  "private completion destinations reject unsupported URLs and store only safe metadata in SQLite",
  () =>
    fixture((f) =>
      Effect.gen(function* () {
        for (const url of [
          "http://api2.cursor.sh/private",
          "https://unrelated.example/private",
          "https://user:password@api2.cursor.sh/private",
          "https://api2.cursor.sh/private#secret",
        ])
          expect(
            yield* f.service
              .configure({
                id: "bad",
                label: "Bad",
                projectId,
                enabled: true,
                url: Redacted.make(url),
                key: Redacted.make("fixture-key"),
              })
              .pipe(Effect.flip),
          ).toMatchObject({ reason: "invalid" });
        expect(f.secrets.size).toBe(0);
        const configured = yield* configure(f.service);
        expect(configured).toEqual({
          id: "grok-primary",
          label: "Grok main Bot",
          projectId,
          host: "api2.cursor.sh",
          enabled: true,
          createdAt: expect.any(String),
          deletedAt: null,
        });
        const sql = yield* SqlClient.SqlClient;
        const stored = yield* sql`SELECT * FROM fork_bots_completion_destinations`;
        const visible = JSON.stringify([configured, stored]);
        expect(visible).not.toContain("/private/routine");
        expect(visible).not.toContain("fixture-routine-key");
        expect(f.secrets.size).toBe(1);
      }),
    ),
);

it.effect(
  "completion intent commits with admission and sends only terminal metadata with a stable correlation",
  () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* configure(f.service);
        const sql = yield* SqlClient.SqlClient;
        yield* sql
          .withTransaction(
            f.store
              .prepare("run", "rolled-back", projectId, "grok-primary")
              .pipe(Effect.andThen(Effect.fail("rollback"))),
          )
          .pipe(Effect.flip);
        expect((yield* f.service.deliveries({})).deliveries).toEqual([]);
        expect(
          yield* f.store
            .prepare("run", "other-project", ProjectId.make("other-project"), "grok-primary")
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "permission" });
        const bots = yield* f.harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "private-input.ts" }, projectId },
          USER_CALLER,
        );
        yield* f.store.prepare("run", run.id, projectId, "grok-primary");
        yield* f.harness.nextLaunch;
        yield* f.service.drain();
        expect(f.requests).toEqual([]);
        yield* f.harness.end(run.threadId, {
          status: "completed",
          reply: "Private result that stays in Loom.",
        });
        yield* bots.awaitRun(run.id, 60_000);
        yield* f.service.drain();
        expect(f.requests).toHaveLength(1);
        const request = f.requests[0]!;
        expect(request.init).toMatchObject({ redirect: "manual", credentials: "omit" });
        const body = JSON.parse(String(request.init?.body));
        expect(body).toMatchObject({
          event: "loom.bot.completed",
          deliveryId: `bot-completion:run:${run.id}`,
          projectId,
          job: { id: run.id, status: "completed" },
          statusTool: "loom_bots_run_status",
        });
        expect(body.links).toEqual([`<t3-thread://v2/fixture-computer/${run.threadId}>`]);
        expect(String(request.init?.body)).not.toContain("private-input.ts");
        expect(String(request.init?.body)).not.toContain("Private result");
        let delivery = (yield* f.service.deliveries({})).deliveries[0]!;
        expect(delivery).toMatchObject({
          status: "accepted",
          attempts: 1,
          acknowledgedAt: null,
          receiverOutcome: null,
        });
        yield* f.service.drain();
        expect(f.requests).toHaveLength(1);
        delivery = yield* f.service.acknowledge({
          deliveryId: delivery.id,
          projectId,
          outcome: "completed",
        });
        expect(delivery).toMatchObject({
          status: "acknowledged",
          receiverOutcome: "completed",
          acknowledgedAt: expect.any(String),
        });
        expect(
          yield* f.service.acknowledge({
            deliveryId: delivery.id,
            projectId,
            outcome: "completed",
          }),
        ).toEqual(delivery);
      }),
    ),
);

it.effect.each(["transport", "restart"] as const)(
  "uncertain %s delivery is never automatically resent",
  (cause) =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* configure(f.service);
        yield* finishedRun(f);
        const before = (yield* f.service.deliveries({})).deliveries[0]!;
        if (cause === "transport") f.state.loseResponse = true;
        else yield* f.store.claim(before.id);
        yield* f.service.drain();
        expect((yield* f.service.deliveries({})).deliveries[0]).toMatchObject({
          status: "needs_attention",
          reason: "outcome_unknown",
          attempts: 1,
        });
        const count = f.requests.length;
        yield* f.service.drain();
        expect(f.requests).toHaveLength(count);
        expect(
          yield* f.service
            .acknowledge({
              deliveryId: before.id,
              projectId: ProjectId.make("wrong"),
              outcome: "completed",
            })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "permission" });
      }),
    ),
);

it.effect("known webhook refusal retries are bounded", () =>
  fixture((f) =>
    Effect.gen(function* () {
      yield* configure(f.service);
      yield* finishedRun(f);
      f.state.statuses = [429, 503, 503];
      yield* f.service.drain();
      expect((yield* f.service.deliveries({})).deliveries[0]).toMatchObject({
        status: "retrying",
        attempts: 1,
      });
      yield* f.service.drain();
      expect(f.requests).toHaveLength(1);
      yield* TestClock.adjust("30 seconds");
      yield* f.service.drain();
      yield* TestClock.adjust("60 seconds");
      yield* f.service.drain();
      expect((yield* f.service.deliveries({})).deliveries[0]).toMatchObject({
        status: "failed",
        attempts: 3,
      });
      expect(f.requests).toHaveLength(3);
    }),
  ),
);

it.effect(
  "disabling holds deliveries, re-enabling resumes, and removal cancels pending work and deletes credentials",
  () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* configure(f.service);
        yield* finishedRun(f);
        yield* f.service.setEnabled({ id: "grok-primary", enabled: false });
        yield* f.service.drain();
        expect(f.requests).toEqual([]);
        yield* f.service.setEnabled({ id: "grok-primary", enabled: true });
        f.state.statuses = [302];
        yield* f.service.drain();
        expect(f.requests).toHaveLength(1);
        expect((yield* f.service.deliveries({})).deliveries[0]).toMatchObject({
          status: "failed",
          lastHttpStatus: 302,
        });
        yield* f.store.prepare("run", "pending-future", projectId, "grok-primary");
        yield* f.service.remove({ id: "grok-primary" });
        expect((yield* f.service.list({})).destinations).toEqual([]);
        expect(
          (yield* f.service.deliveries({})).deliveries.find(
            (item) => item.jobId === "pending-future",
          ),
        ).toMatchObject({ status: "cancelled", reason: "destination_removed" });
        expect(f.secrets.size).toBe(0);
      }),
    ),
);

it.effect.each(["credentials_unavailable", "destination_invalid", "job_unavailable"])(
  "an unsent %s failure cannot be acknowledged as receiver completion",
  (reason) =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* configure(f.service);
        yield* finishedRun(f);
        const pending = (yield* f.service.deliveries({})).deliveries[0]!;
        yield* f.store.claim(pending.id);
        yield* f.store.settle(pending.id, "needs_attention", reason, null);
        expect(
          yield* f.service
            .acknowledge({ deliveryId: pending.id, projectId, outcome: "completed" })
            .pipe(Effect.flip),
        ).toMatchObject({ reason: "invalid" });
        yield* f.service.remove({ id: "grok-primary" });
        expect((yield* f.service.deliveries({})).deliveries[0]).toMatchObject({
          status: "cancelled",
          reason: "destination_removed",
        });
      }),
    ),
);

const storedBatch = (id: string, pipelineRunId?: string): StoredBatch => ({
  batch: {
    id,
    botId: "reviewer",
    botVersion: 1,
    botName: "Reviewer",
    projectId,
    sourceType: "lines",
    sourceSummary: "One file",
    itemParameter: "file",
    sharedInputs: {},
    status: "finished",
    note: null,
    startedBy: "user",
    callerThreadId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:01:00.000Z",
    ...(pipelineRunId === undefined ? {} : { pipelineRunId }),
  },
  definition: testBot(),
  source: { type: "lines", text: "cache.ts" },
  checkoutThreadId: null,
  target: null,
});
const storedPipeline = (
  id: string,
  status: StoredPipelineRun["run"]["status"] = "failed",
): StoredPipelineRun => ({
  run: {
    id,
    pipelineId: "review-pipeline",
    pipelineVersion: 1,
    pipelineName: "Review pipeline",
    inputs: {},
    projectId,
    checkoutThreadId: null,
    status,
    retryAt: null,
    cursorStepId: null,
    finalVerdict: "fail",
    stoppedRunId: null,
    error: "Private failure that stays in Loom.",
    startedBy: "user",
    callerThreadId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    finishedAt: status === "running" ? null : "2026-01-01T00:01:00.000Z",
  },
  pipeline: {
    id: "review-pipeline",
    name: "Review pipeline",
    description: "",
    parameters: [],
    steps: [{ id: "review", botId: "reviewer", inputs: { file: "cache.ts" } }],
    version: 1,
    createdBy: "user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  bots: { review: testBot() },
  callerRuntimeMode: null,
  triggerId: null,
});

it.effect.each(["pending", "retrying", "sending", "accepted", "needs_attention"])(
  "%s delivery retains its parent jobs and child runs during pruning",
  (status) =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* configure(f.service, false);
        yield* f.service.setEnabled({ id: "grok-primary", enabled: true });
        const runs = yield* makeBotsStore;
        const batches = yield* makeBotBatchesStore;
        const pipelines = yield* makePipelinesStore;
        const at = "2026-01-01T00:00:00.000Z";
        yield* runs.insertRun(testRun("held-run", at));
        yield* batches.insertBatch(storedBatch("held-batch"), []);
        yield* pipelines.insertRun(storedPipeline("held-pipeline"), "review");
        yield* batches.insertBatch(storedBatch("fanout-batch", "held-pipeline"), []);
        yield* runs.insertRun(testRun("batch-child", at, { batchId: "held-batch" }));
        yield* runs.insertRun(testRun("pipeline-child", at, { pipelineRunId: "held-pipeline" }));
        yield* runs.insertRun(testRun("fanout-child", at, { batchId: "fanout-batch" }));
        for (const [kind, id] of [
          ["run", "held-run"],
          ["batch", "held-batch"],
          ["pipeline", "held-pipeline"],
        ] as const)
          yield* f.store.prepare(kind, id, projectId, "grok-primary");
        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE fork_bots_completion_deliveries SET status = ${status}`;
        yield* f.service.setEnabled({ id: "grok-primary", enabled: false });
        yield* runs.pruneRuns("reviewer", 0, false);
        yield* batches.pruneBatches("reviewer", 0);
        yield* pipelines.pruneRuns("review-pipeline", 0);
        expect(
          (yield* sql<{ id: string }>`SELECT id FROM fork_bots_runs ORDER BY id`).map(
            (row) => row.id,
          ),
        ).toEqual(["batch-child", "fanout-child", "held-run", "pipeline-child"]);
        expect((yield* sql`SELECT id FROM fork_bots_batches`).length).toBe(2);
        expect((yield* sql`SELECT id FROM fork_bots_pipeline_runs`).length).toBe(1);
        yield* sql`UPDATE fork_bots_completion_deliveries SET status = 'acknowledged'`;
        yield* runs.pruneRuns("reviewer", 0, false);
        yield* batches.pruneBatches("reviewer", 0);
        yield* pipelines.pruneRuns("review-pipeline", 0);
        expect(yield* sql`SELECT id FROM fork_bots_runs`).toEqual([]);
        expect(yield* sql`SELECT id FROM fork_bots_batches`).toEqual([]);
        expect(yield* sql`SELECT id FROM fork_bots_pipeline_runs`).toEqual([]);
      }),
    ),
);

it.effect(
  "a pipeline failure is frozen before resume and delivered even when the worker sees it running again",
  () =>
    fixture((f) =>
      Effect.gen(function* () {
        yield* configure(f.service);
        const pipelines = yield* makePipelinesStore;
        yield* pipelines.insertRun(storedPipeline("resumed-pipeline", "running"), "review");
        yield* f.store.prepare("pipeline", "resumed-pipeline", projectId, "grok-primary");
        const first = {
          status: "failed" as const,
          retryAt: null,
          cursorStepId: null,
          finalVerdict: "fail" as const,
          stoppedRunId: null,
          error: "Private first failure.",
          finishedAt: "2026-01-01T00:01:00.000Z",
        };
        yield* pipelines.updateRun("resumed-pipeline", first);
        yield* pipelines.updateRun("resumed-pipeline", {
          ...first,
          status: "running",
          error: null,
          finishedAt: null,
        });
        yield* f.service.drain();
        expect(f.requests).toHaveLength(1);
        const body = JSON.parse(String(f.requests[0]?.init?.body));
        expect(body.job).toMatchObject({
          id: "resumed-pipeline",
          status: "failed",
          finishedAt: first.finishedAt,
        });
        expect(String(f.requests[0]?.init?.body)).not.toContain("Private first failure");
      }),
    ),
);

it.effect("completion badge notifications follow changes without idle sweep re-emissions", () =>
  fixture((f) =>
    Effect.gen(function* () {
      yield* configure(f.service);
      expect(f.state.badgeChanges).toBe(1);
      yield* f.service.drain();
      yield* f.service.setEnabled({ id: "grok-primary", enabled: true });
      expect(f.state.badgeChanges).toBe(1);
      yield* finishedRun(f);
      yield* f.service.drain();
      expect(f.state.badgeChanges).toBe(2);
      yield* f.service.drain();
      expect(f.state.badgeChanges).toBe(2);
      const delivery = (yield* f.service.deliveries({})).deliveries[0]!;
      yield* f.service.acknowledge({ deliveryId: delivery.id, projectId, outcome: "completed" });
      expect(f.state.badgeChanges).toBe(3);
      yield* f.service.acknowledge({ deliveryId: delivery.id, projectId, outcome: "completed" });
      expect(f.state.badgeChanges).toBe(3);
    }),
  ),
);
