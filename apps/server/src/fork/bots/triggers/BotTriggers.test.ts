// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no synchronous HMAC.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import type { BotsSaveTriggerInput } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import * as ProjectStore from "../../../orchestration-v2/ProjectStore.ts";
import { PullRequestService } from "../../../pullRequest/PullRequestService.ts";
import type { WebhookTriggerRequest } from "../../../scheduledTasks/ScheduledTaskService.ts";
import { GitVcsDriver } from "../../../vcs/GitVcsDriver.ts";
import { WorkspaceEntries } from "../../../workspace/WorkspaceEntries.ts";
import { BotBatches, make as makeBotBatches } from "../BotBatches.ts";
import { BotsService, USER_CALLER } from "../BotsService.ts";
import { projectId, reviewer, withHarness, type Harness } from "../testing/BotsHarness.ts";
import { make } from "./BotTriggers.ts";
import type { TriggerEvent } from "./matchers.ts";

const scratchReviewer = reviewer({ workspace: { type: "scratch" } });

const makeTriggers = (harness: Harness) =>
  Effect.gen(function* () {
    const bots = yield* harness.service;
    const projects = {
      get: () => Effect.succeedSome({ workspaceRoot: "/repo", deletedAt: null }),
    } as unknown as ProjectStore.ProjectStoreV2["Service"];
    const provideBatchDeps = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      harness
        .provide(effect)
        .pipe(
          Effect.provideService(BotsService, bots),
          Effect.provideService(ProjectStore.ProjectStoreV2, projects),
          Effect.provideService(GitVcsDriver, {} as GitVcsDriver["Service"]),
          Effect.provideService(PullRequestService, {} as PullRequestService["Service"]),
          Effect.provideService(WorkspaceEntries, {} as WorkspaceEntries["Service"]),
        );
    const batches = yield* provideBatchDeps(makeBotBatches);
    const triggers = yield* provideBatchDeps(make).pipe(Effect.provideService(BotBatches, batches));
    // The service follows bot changes on a forked fiber; let it subscribe.
    yield* Effect.yieldNow;
    return { bots, batches, triggers };
  });

const trigger = (fields: Partial<BotsSaveTriggerInput> = {}): BotsSaveTriggerInput => ({
  botId: "reviewer",
  name: "On failing checks",
  event: { kind: "pull-request-checks-failing" },
  mapping: { file: { field: "url" } },
  enabled: true,
  cooldownMinutes: 0,
  dailyLimit: 10,
  followLatest: false,
  ...fields,
});

const checksFailing = (key: string, url: string, occurredAt?: string): TriggerEvent => ({
  kind: "pull-request-checks-failing",
  key,
  summary: `${url} checks failing`,
  fields: { url },
  repository: "acme/app",
  headBranch: "main",
  projectId,
  ...(occurredAt === undefined ? {} : { occurredAt }),
});

const delivery = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): WebhookTriggerRequest => {
  const [, , , hookId, token] = path.split("/");
  const bodyText = JSON.stringify(body);
  return {
    hookId: decodeURIComponent(hookId!),
    token: token!,
    method: "POST",
    path,
    query: "",
    headers,
    bodyText,
    body: new TextEncoder().encode(bodyText),
  };
};

describe("BotTriggers", () => {
  it.effect("rejects a mapping that misses a required input or names a field the event lacks", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, triggers } = yield* makeTriggers(harness);
        yield* bots.save(scratchReviewer, USER_CALLER);
        const missing = yield* triggers
          .save(trigger({ mapping: {} }), USER_CALLER)
          .pipe(Effect.flip);
        expect(missing.message).toBe("Reviewer needs File; map it to a field or a fixed value.");
        const unknown = yield* triggers
          .save(trigger({ mapping: { file: { field: "body.x" } } }), USER_CALLER)
          .pipe(Effect.flip);
        expect(unknown.message).toBe("This event has no field body.x.");
      }),
    ),
  );

  it.effect("fires once per event, after it was created, within its cooldown and daily limit", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, triggers } = yield* makeTriggers(harness);
        yield* bots.save(reviewer({ maxConcurrentRuns: 5 }), USER_CALLER);
        yield* TestClock.adjust("1 hour");
        const saved = yield* triggers.save(
          trigger({ cooldownMinutes: 10, dailyLimit: 2 }),
          USER_CALLER,
        );

        // Older than the trigger: ignored without a firing.
        yield* triggers.handleEvent(checksFailing("old", "pr/1", "1970-01-01T00:00:00.000Z"));
        yield* triggers.handleEvent(checksFailing("a", "pr/2"));
        yield* triggers.handleEvent(checksFailing("a", "pr/2"));
        const launch = yield* harness.nextLaunch;
        expect(launch.initialMessage?.text).toContain("Review <event-data-");
        expect(launch.initialMessage?.text).toContain("pr/2");

        yield* TestClock.adjust("1 minute");
        yield* triggers.handleEvent(checksFailing("b", "pr/3"));
        yield* TestClock.adjust("10 minutes");
        yield* triggers.handleEvent(checksFailing("c", "pr/4"));
        yield* harness.nextLaunch;
        yield* TestClock.adjust("11 minutes");
        yield* triggers.handleEvent(checksFailing("d", "pr/5"));

        const { firings } = yield* triggers.firings({ triggerId: saved.id, limit: 10 });
        expect(firings.map((firing) => [firing.eventKey, firing.outcome, firing.reason])).toEqual([
          ["d", "skipped", "Already started 2 runs in the last 24 hours."],
          ["c", "run", null],
          ["b", "skipped", "Fired within 10 minutes of its last run."],
          ["a", "run", null],
        ]);
        expect(harness.launches).toHaveLength(2);
      }),
    ),
  );

  it.effect("runs the pinned version after the bot changes, until it is repinned", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, triggers } = yield* makeTriggers(harness);
        yield* bots.save(reviewer({ maxConcurrentRuns: 5 }), USER_CALLER);
        const saved = yield* triggers.save(trigger(), USER_CALLER);
        yield* bots.save(
          reviewer({ maxConcurrentRuns: 5, instructions: "Check {{file}}.", expectedVersion: 1 }),
          USER_CALLER,
        );

        yield* triggers.handleEvent(checksFailing("a", "pr/1"));
        expect((yield* harness.nextLaunch).initialMessage?.text).toContain("Review <event-data-");

        expect(yield* triggers.repin({ triggerId: saved.id })).toMatchObject({ pinnedVersion: 2 });
        yield* triggers.handleEvent(checksFailing("b", "pr/2"));
        expect((yield* harness.nextLaunch).initialMessage?.text).toContain("Check <event-data-");

        // Following stable runs the latest until a version is marked, then that one.
        yield* triggers.repin({ triggerId: saved.id, followStable: true });
        yield* bots.setStable({ botId: "reviewer", version: 1 });
        yield* triggers.handleEvent(checksFailing("c", "pr/3"));
        expect((yield* harness.nextLaunch).initialMessage?.text).toContain("Review <event-data-");

        const both = yield* triggers
          .repin({ triggerId: saved.id, followLatest: true })
          .pipe(Effect.flip);
        expect(both.reason).toBe("invalid");
      }),
    ),
  );

  it.effect("answers webhook deliveries by token, maps body fields and drops repeats", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, triggers } = yield* makeTriggers(harness);
        yield* bots.save(scratchReviewer, USER_CALLER);
        const saved = yield* triggers.save(
          trigger({ event: { kind: "webhook" }, mapping: { file: { field: "body.file" } } }),
          USER_CALLER,
        );
        const path = saved.webhook!.path;
        expect(saved.webhook).toMatchObject({ url: null, hasSecret: false });

        const first = yield* triggers.webhook(delivery(path, { file: "a.ts" }));
        expect(first).toMatchObject({ _tag: "accepted", outcome: "accepted" });
        expect((yield* harness.nextLaunch).initialMessage?.text).toContain("a.ts");
        expect(yield* triggers.webhook(delivery(path, { file: "a.ts" }))).toMatchObject({
          outcome: "duplicate",
        });
        expect(yield* triggers.webhook(delivery(`${path}x`, { file: "b.ts" }))).toEqual({
          _tag: "not_found",
        });

        yield* triggers.setEnabled(saved.id, false);
        expect(yield* triggers.webhook(delivery(path, { file: "b.ts" }))).toEqual({
          _tag: "disabled",
        });
      }),
    ),
  );

  it.effect("rejects a signed webhook delivery whose signature does not match", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, triggers } = yield* makeTriggers(harness);
        yield* bots.save(scratchReviewer, USER_CALLER);
        const saved = yield* triggers.save(
          trigger({
            event: {
              kind: "webhook",
              signature: { header: "x-hub-signature-256", encoding: "hex", prefix: "sha256=" },
            },
            mapping: { file: { field: "body.file" } },
            webhookSecret: "s3cret",
          }),
          USER_CALLER,
        );
        expect(saved.webhook).toMatchObject({ hasSecret: true });
        const body = { file: "a.ts" };
        const sign = (secret: string) =>
          `sha256=${NodeCrypto.createHmac("sha256", secret).update(JSON.stringify(body)).digest("hex")}`;
        const path = saved.webhook!.path;
        expect(
          yield* triggers.webhook(delivery(path, body, { "x-hub-signature-256": sign("wrong") })),
        ).toEqual({ _tag: "rejected_signature" });
        expect(
          yield* triggers.webhook(delivery(path, body, { "x-hub-signature-256": sign("s3cret") })),
        ).toMatchObject({ _tag: "accepted", outcome: "accepted" });
      }),
    ),
  );

  it.effect("runs a merge conflict report as one batch item per file", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, batches, triggers } = yield* makeTriggers(harness);
        yield* bots.save(scratchReviewer, USER_CALLER);
        const saved = yield* triggers.save(
          trigger({ event: { kind: "merge-conflict" }, mapping: { file: { field: "file" } } }),
          USER_CALLER,
        );
        const report = { tag: "v1-nightly", branch: "main", files: ["b.ts", "a.ts", "b.ts"] };
        yield* triggers.webhook(delivery(saved.webhook!.path, report));
        const [firing] = (yield* triggers.firings({ triggerId: saved.id, limit: 1 })).firings;
        expect(firing).toMatchObject({
          outcome: "run",
          reason: "Started a batch of 2 files.",
          eventSummary: "2 conflicting files merging v1-nightly",
        });
        const [batch] = (yield* batches.list({ limit: 1 })).batches;
        expect(batch).toMatchObject({ total: 2, sourceType: "inputs" });
      }),
    ),
  );

  it.effect("deletes a bot's triggers with the bot", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, triggers } = yield* makeTriggers(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* triggers.save(trigger(), USER_CALLER);
        yield* bots.delete("reviewer");
        yield* Effect.yieldNow;
        expect(yield* triggers.list("reviewer")).toEqual([]);
      }),
    ),
  );
});
