import { describe, expect, it } from "@effect/vitest";
import type { BotRun } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { BotsService, USER_CALLER } from "../BotsService.ts";
import { projectId, reviewer, withHarness, type Harness } from "../testing/BotsHarness.ts";
import { make } from "./BotVersions.ts";
import { SUGGEST_RESULT_MAX_BYTES, suggestEditPrompt } from "./suggestEdit.ts";

const WAIT_MS = 60_000;
const EDITED = "Review {{file}} for security bugs.";

const makeVersions = (harness: Harness) =>
  Effect.gen(function* () {
    const bots = yield* harness.service;
    const versions = yield* harness.provide(make).pipe(Effect.provideService(BotsService, bots));
    return { bots, versions };
  });

/** Runs the reviewer on `file` and ends its thread with `reply`. */
const finishedRun = (harness: Harness, file: string, reply: string) =>
  Effect.gen(function* () {
    const bots = yield* harness.service;
    const run = yield* bots.run({ botId: "reviewer", inputs: { file }, projectId }, USER_CALLER);
    yield* harness.nextLaunch;
    yield* harness.end(run.threadId, { status: "completed", reply });
    return yield* bots.awaitRun(run.id, WAIT_MS);
  });

const endNext = (harness: Harness, reply: string) =>
  Effect.gen(function* () {
    const launch = yield* harness.nextLaunch;
    yield* harness.end(launch.threadId!, { status: "completed", reply });
    return launch;
  });

describe("BotVersions replay", () => {
  it.effect("reruns past inputs with a saved version and compares each result", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const a = yield* finishedRun(harness, "a.ts", "Looks fine.");
        const b = yield* finishedRun(harness, "b.ts", "Looks fine.");
        yield* bots.save(reviewer({ instructions: EDITED }), USER_CALLER);

        const started = yield* versions.replay(
          { botId: "reviewer", runIds: [a.id, b.id], version: 1 },
          USER_CALLER,
        );
        expect(started).toMatchObject({
          status: "running",
          source: { kind: "version", version: 1 },
          baseVersion: 2,
        });
        expect(started.items.map((item) => item.comparison)).toEqual(["pending", "pending"]);

        const first = yield* endNext(harness, "Looks fine.");
        expect(first.initialMessage?.text).toMatch(/^Review a\.ts\./);
        yield* endNext(harness, "SQL injection on line 4.");
        const done = yield* versions.awaitReplay(started.id);
        expect(done.status).toBe("done");
        expect(done.items.map((item) => [item.originalRunId, item.comparison])).toEqual([
          [a.id, "same"],
          [b.id, "changed"],
        ]);

        const replayRun = yield* bots.getRun(done.items[0]!.replayRunId!);
        expect(replayRun).toMatchObject({ replayId: started.id, botVersion: 1 });
        const again = yield* Effect.flip(
          versions.replay({ botId: "reviewer", runIds: [replayRun.id], version: 2 }, USER_CALLER),
        );
        expect(again.message).toBe("A replay run cannot be replayed.");
      }),
    ),
  );

  it.effect("runs an unsaved draft without changing the bot", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        const saved = yield* bots.save(reviewer(), USER_CALLER);
        const a = yield* finishedRun(harness, "a.ts", "Looks fine.");
        const { expectedVersion: _, ...draft } = reviewer({ instructions: EDITED });

        const started = yield* versions.replay(
          { botId: "reviewer", runIds: [a.id], draft },
          USER_CALLER,
        );
        expect(started.source).toEqual({ kind: "draft" });
        const launch = yield* endNext(harness, "Looks fine.");
        expect(launch.initialMessage?.text).toMatch(/^Review a\.ts for security bugs\./);
        expect((yield* versions.awaitReplay(started.id)).items[0]?.comparison).toBe("same");
        expect((yield* bots.get("reviewer")).version).toBe(saved.version);

        const other = yield* Effect.flip(
          versions.replay(
            { botId: "reviewer", runIds: [a.id], draft: { ...draft, id: "other" } },
            USER_CALLER,
          ),
        );
        expect(other.message).toBe("The draft belongs to another bot.");
      }),
    ),
  );

  it.effect("refuses a replay without exactly one source or with another bot's runs", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        yield* bots.save(reviewer({ id: "other", name: "Other" }), USER_CALLER);
        const a = yield* finishedRun(harness, "a.ts", "Looks fine.");

        const neither = yield* Effect.flip(
          versions.replay({ botId: "reviewer", runIds: [a.id] }, USER_CALLER),
        );
        expect(neither.message).toBe("Replay either a draft or a saved version.");
        const foreign = yield* Effect.flip(
          versions.replay({ botId: "other", runIds: [a.id], version: 1 }, USER_CALLER),
        );
        expect(foreign.message).toBe("Replay only runs of Other.");
      }),
    ),
  );

  it.effect("fails inputs the version cannot take and finishes when nothing is left to run", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const a = yield* finishedRun(harness, "a.ts", "Looks fine.");
        yield* bots.save(
          reviewer({
            instructions: "Review {{file}} against {{rule}}.",
            parameters: [
              { name: "file", label: "File", type: "string", required: true },
              { name: "rule", label: "Rule", type: "string", required: true },
            ],
          }),
          USER_CALLER,
        );

        const replay = yield* versions.replay(
          { botId: "reviewer", runIds: [a.id], version: 2 },
          USER_CALLER,
        );
        expect(replay.status).toBe("done");
        expect(replay.items[0]).toMatchObject({ comparison: "failed", replayRunId: null });
        expect(replay.items[0]?.reason).toBeTruthy();
        expect(harness.launches).toHaveLength(1);
      }),
    ),
  );

  it.effect("checks the whole replay against the daily run budget up front", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(
          reviewer({ maxConcurrentRuns: 4, budget: { runsPerDay: 3 } }),
          USER_CALLER,
        );
        const a = yield* finishedRun(harness, "a.ts", "A");
        const b = yield* finishedRun(harness, "b.ts", "B");

        const refused = yield* Effect.flip(
          versions.replay({ botId: "reviewer", runIds: [a.id, b.id], version: 1 }, USER_CALLER),
        );
        expect(refused.message).toBe(
          "Reviewer has room for 1 more run today; this replay needs 2.",
        );
        expect(harness.launches).toHaveLength(2);
      }),
    ),
  );

  it.effect("cancels waiting items and the runs in flight", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const a = yield* finishedRun(harness, "a.ts", "A");
        const b = yield* finishedRun(harness, "b.ts", "B");

        const started = yield* versions.replay(
          { botId: "reviewer", runIds: [a.id, b.id], version: 1 },
          USER_CALLER,
        );
        // One run at a time: the first is in flight and the second waits.
        const inFlight = yield* harness.nextLaunch;
        const cancelled = yield* versions.cancel(started.id);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.items[1]).toMatchObject({
          comparison: "failed",
          reason: "The replay was cancelled before this run started.",
        });
        expect(harness.interrupted).toContain(inFlight.threadId);
        const replayRun: BotRun = yield* bots.awaitRun(cancelled.items[0]!.replayRunId!, WAIT_MS);
        expect(replayRun.status).toBe("cancelled");
        expect(harness.launches).toHaveLength(3);
      }),
    ),
  );
});

describe("BotVersions suggestEdit", () => {
  it.effect("needs a bad run to learn from", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(reviewer(), USER_CALLER);
        const error = yield* Effect.flip(versions.suggestEdit({ botId: "reviewer" }));
        expect(error).toMatchObject({
          reason: "invalid",
          message: "Mark a run as bad first, so there is something to learn from.",
        });
      }),
    ),
  );

  it.effect("asks the bot's model for an edit from the rated runs", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const { bots, versions } = yield* makeVersions(harness);
        yield* bots.save(reviewer({ maxConcurrentRuns: 2 }), USER_CALLER);
        const bad = yield* finishedRun(harness, "a.ts", "Looks fine.");
        yield* bots.rateRun({ runId: bad.id, rating: "down", note: "Missed the SQL injection." });

        const suggesting = yield* Effect.forkChild(versions.suggestEdit({ botId: "reviewer" }));
        const launch = yield* endNext(harness, JSON.stringify({ instructions: EDITED }));
        expect(launch.initialMessage?.text).toContain("Their note: Missed the SQL injection.");
        const result = yield* Fiber.join(suggesting);
        expect(result).toMatchObject({
          draft: { instructions: EDITED },
          sourceThreadId: bad.threadId,
          notes: [],
        });
      }),
    ),
  );
});

describe("suggestEditPrompt", () => {
  const run = (fields: Partial<BotRun>) => ({ ...fields }) as BotRun;

  it("lists bad runs, then good ones, and cuts long replies", () => {
    const prompt = suggestEditPrompt(
      { ...reviewer(), id: "reviewer" },
      [
        run({
          status: "completed",
          inputs: { file: "a.ts" },
          result: "x".repeat(SUGGEST_RESULT_MAX_BYTES + 10),
          error: null,
          note: "Too vague.",
        }),
      ],
      [run({ status: "completed", inputs: { file: "b.ts" }, result: "Good.", error: null })],
    );
    expect(prompt.indexOf("## Bad runs")).toBeLessThan(prompt.indexOf("## Good runs"));
    expect(prompt).toContain('Inputs: {"file":"a.ts"}');
    expect(prompt).toContain("Their note: Too vague.");
    expect(prompt).toContain(`${"x".repeat(SUGGEST_RESULT_MAX_BYTES)}\n(cut)`);
    expect(prompt).not.toContain("x".repeat(SUGGEST_RESULT_MAX_BYTES + 1));
  });

  it("leaves out the good runs section when there are none", () => {
    const prompt = suggestEditPrompt(
      { ...reviewer(), id: "reviewer" },
      [run({ status: "failed", inputs: {}, result: null, error: "Timed out." })],
      [],
    );
    expect(prompt).toContain("Error: Timed out.");
    expect(prompt).toContain("(no reply)");
    expect(prompt).not.toContain("## Good runs");
  });
});
