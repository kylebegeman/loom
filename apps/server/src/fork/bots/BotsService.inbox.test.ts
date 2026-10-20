import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { isBotRunThreadId } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { makeBotBatchesStore } from "./BotBatchesStore.ts";
import { promotedTitle, USER_CALLER } from "./BotsService.ts";
import { model, projectId, reviewer, withHarness, type Harness } from "./testing/BotsHarness.ts";

const WAIT_MS = 60_000;
const otherModel: ModelSelection = {
  instanceId: ProviderInstanceId.make("claude"),
  model: "other",
};

/** Starts a run of `reviewer` on `file` and ends its thread as failed. */
const failedRun = (harness: Harness, file: string) =>
  Effect.gen(function* () {
    const bots = yield* harness.service;
    const run = yield* bots.run({ botId: "reviewer", inputs: { file }, projectId }, USER_CALLER);
    yield* harness.end(run.threadId, { status: "failed", reply: null });
    return yield* bots.awaitRun(run.id, WAIT_MS);
  });

describe("BotsService inbox", () => {
  it.effect("lists runs that need a person, with a total across pages", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ output: "verdict", maxConcurrentRuns: 8 }), USER_CALLER);
        const failed = yield* failedRun(harness, "a.ts");
        const unsure = yield* bots.run(
          { botId: "reviewer", inputs: { file: "b.ts" }, projectId },
          USER_CALLER,
        );
        yield* harness.end(unsure.threadId, { status: "completed", reply: "Not sure." });
        yield* bots.awaitRun(unsure.id, WAIT_MS);
        const answered = yield* bots.run(
          { botId: "reviewer", inputs: { file: "c.ts" }, projectId },
          USER_CALLER,
        );
        yield* harness.end(answered.threadId, {
          status: "completed",
          reply: '{"verdict":"fail","summary":"A bug."}',
        });
        yield* bots.awaitRun(answered.id, WAIT_MS);

        const page = yield* bots.inbox({ limit: 1 });
        expect(page).toMatchObject({ total: 2, hasMore: true });
        const all = yield* bots.inbox({ limit: 10 });
        expect(all.runs.map((run) => run.id).toSorted()).toEqual([failed.id, unsure.id].toSorted());
        expect(all.runs[0]!.modelSelection).toEqual(model);
      }),
    ),
  );

  it.effect("retries a run once, on another model when asked, and drops the old one", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        const old = yield* failedRun(harness, "a.ts");
        yield* harness.nextLaunch;

        const retried = yield* bots.retry(
          { runId: old.id, modelSelection: otherModel },
          USER_CALLER,
        );
        expect(retried).toMatchObject({
          retryOf: old.id,
          inputs: { file: "a.ts" },
          projectId,
          modelSelection: otherModel,
        });
        expect((yield* harness.nextLaunch).modelSelection).toEqual(otherModel);
        expect(yield* bots.getRun(old.id)).toMatchObject({ retriedBy: retried.id });
        expect((yield* bots.get("reviewer")).modelSelection).toEqual(model);
        expect((yield* bots.inbox({ limit: 10 })).total).toBe(0);

        const again = yield* Effect.flip(bots.retry({ runId: old.id }, USER_CALLER));
        expect(again.message).toBe("This run was already retried; retry the newer run.");

        yield* harness.end(retried.threadId, { status: "completed", reply: "Fine." });
        yield* bots.awaitRun(retried.id, WAIT_MS);
        const notInbox = yield* Effect.flip(bots.retry({ runId: retried.id }, USER_CALLER));
        expect(notInbox.reason).toBe("invalid");
      }),
    ),
  );

  it.effect("moves a batch item onto the run that retried it", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        const bot = yield* bots.save(reviewer(), USER_CALLER);
        const batches = yield* makeBotBatchesStore;
        yield* batches.insertBatch(
          {
            batch: {
              id: "batch-1",
              botId: bot.id,
              botVersion: bot.version,
              botName: bot.name,
              projectId,
              sourceType: "lines",
              sourceSummary: "Pasted lines, 1 item",
              itemParameter: "file",
              sharedInputs: {},
              status: "finished",
              note: null,
              startedBy: "user",
              callerThreadId: null,
              createdAt: "2026-10-20T10:00:00.000Z",
              finishedAt: "2026-10-20T10:01:00.000Z",
            },
            definition: bot,
            source: { type: "lines", text: "a.ts" },
            checkoutThreadId: null,
          },
          [{ label: "a.ts", inputs: { file: "a.ts" } }],
        );
        const old = yield* bots.startRunWith(
          bot,
          { botId: bot.id, inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
          {
            batchId: "batch-1",
            onInserted: (inserted) => batches.setItemState("batch-1", 0, "started", inserted.id),
          },
        );
        yield* harness.end(old.threadId, { status: "failed", reply: null });
        yield* bots.awaitRun(old.id, WAIT_MS);

        const retried = yield* bots.retry({ runId: old.id }, USER_CALLER);
        expect(retried.batchId).toBe("batch-1");
        expect(yield* batches.getItem("batch-1", 0)).toMatchObject({
          runId: retried.id,
          previousRunIds: [old.id],
        });
      }),
    ),
  );

  it.effect("dismisses and restores finished runs, never running ones", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ maxConcurrentRuns: 2 }), USER_CALLER);
        const failed = yield* failedRun(harness, "a.ts");

        const [dismissed] = yield* bots.dismiss({ runIds: [failed.id], dismissed: true });
        expect(dismissed?.dismissedAt).not.toBeNull();
        expect((yield* bots.inbox({ limit: 10 })).total).toBe(0);
        expect((yield* bots.inbox({ dismissed: true, limit: 10 })).runs).toMatchObject([
          { id: failed.id },
        ]);

        yield* bots.dismiss({ runIds: [failed.id], dismissed: false });
        const restored = (yield* bots.inbox({ limit: 10 })).runs;
        expect(restored.map((run) => run.id)).toEqual([failed.id]);
        expect(restored[0]!.dismissedAt).toBeUndefined();

        const running = yield* bots.run(
          { botId: "reviewer", inputs: { file: "b.ts" }, projectId },
          USER_CALLER,
        );
        const refused = yield* Effect.flip(
          bots.dismiss({ runIds: [failed.id, running.id], dismissed: true }),
        );
        expect(refused.reason).toBe("invalid");
        expect((yield* bots.inbox({ limit: 10 })).total).toBe(1);
      }),
    ),
  );

  it.effect("opens a finished run as one ordinary thread", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ maxConcurrentRuns: 2 }), USER_CALLER);
        const running = yield* bots.run(
          { botId: "reviewer", inputs: { file: "b.ts" }, projectId },
          USER_CALLER,
        );
        expect((yield* Effect.flip(bots.promote(running.id, USER_CALLER))).reason).toBe("invalid");

        const failed = yield* failedRun(harness, "src/a.ts");
        const opened = yield* bots.promote(failed.id, USER_CALLER);
        expect(opened.created).toBe(true);
        expect(isBotRunThreadId(opened.threadId)).toBe(false);
        expect(harness.dispatched).toEqual([
          {
            type: "thread.fork",
            commandId: `bot-promote:${failed.id}`,
            sourceThreadId: failed.threadId,
            targetThreadId: opened.threadId,
            sourcePoint: { type: "latest_stable" },
            title: "Reviewer: src/a.ts",
            createdBy: "user",
            creationSource: "server",
          },
        ]);
        expect(yield* bots.getRun(failed.id)).toMatchObject({ promotedThreadId: opened.threadId });

        harness.shells.set(opened.threadId, { projectId });
        expect(yield* bots.promote(failed.id, USER_CALLER)).toEqual({
          threadId: opened.threadId,
          created: false,
        });
        expect(harness.dispatched).toHaveLength(1);

        // A thread deleted since is opened again under a new id.
        harness.shells.delete(opened.threadId);
        const reopened = yield* bots.promote(failed.id, USER_CALLER);
        expect(reopened.created).toBe(true);
        expect(reopened.threadId).not.toBe(opened.threadId);
      }),
    ),
  );

  it("names an opened run after its bot and first input, within the limit", () => {
    const run = { botName: "Reviewer", inputs: {} } as Parameters<typeof promotedTitle>[0];
    expect(promotedTitle(run)).toBe("Reviewer");
    expect(promotedTitle({ ...run, inputs: { file: "a\n  b" } })).toBe("Reviewer: a b");
    expect(promotedTitle({ ...run, inputs: { file: "x".repeat(200) } })).toHaveLength(120);
  });
});
