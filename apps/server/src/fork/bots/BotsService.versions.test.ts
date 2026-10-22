import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import { USER_CALLER, versionInput } from "./BotsService.ts";
import { projectId, reviewer, withHarness } from "./testing/BotsHarness.ts";

const WAIT_MS = 60_000;
const ORIGINAL = "Review {{file}}.";
const EDITED = "Review {{file}} for security bugs.";

describe("BotsService versions", () => {
  it.effect("keeps a newer local shared revision when an earlier sync reaches the write", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        const bot = yield* bots.save(reviewer(), USER_CALLER);
        const link = {
          libraryBotId: bot.id,
          revision: 2,
          libraryProjectId: null,
          syncedAt: "1970-01-01T00:00:00.000Z",
          modelOverride: null,
        };
        yield* bots.setLibraryLink(bot.id, link);
        expect(
          yield* bots.writeFromLibrary(
            { ...versionInput(bot), instructions: "Older shared instructions." },
            { ...link, revision: 1 },
            USER_CALLER,
          ),
        ).toMatchObject({ version: 1, instructions: ORIGINAL, library: { revision: 2 } });
        yield* bots.setLibraryLink(bot.id, null);
        expect(
          yield* bots.writeFromLibrary(versionInput(bot), link, USER_CALLER).pipe(Effect.flip),
        ).toMatchObject({ reason: "invalid" });
        expect((yield* bots.get(bot.id)).library).toBeUndefined();
      }),
    ),
  );

  it.effect("accepts only one concurrent save of the same expected version", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        yield* bots.setLibraryLink("reviewer", {
          libraryBotId: "reviewer",
          revision: 1,
          libraryProjectId: null,
          syncedAt: "1970-01-01T00:00:00.000Z",
          modelOverride: null,
        });
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        yield* bots.setAnywhereHooks({
          publish: (_definition, link) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return { ...link, revision: link.revision + 1 };
            }),
          resolveTarget: () => Effect.succeed(null),
          submit: () => Effect.void,
          cancel: () => Effect.succeed(false),
          vaultLines: () => Effect.succeed([]),
        });
        const first = yield* bots
          .save(reviewer({ name: "First edit", expectedVersion: 1 }), USER_CALLER)
          .pipe(Effect.result, Effect.forkChild);
        yield* Deferred.await(entered);
        const second = yield* bots
          .save(reviewer({ name: "Second edit", expectedVersion: 1 }), USER_CALLER)
          .pipe(Effect.result, Effect.forkChild);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        const results = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
        expect(results.filter(Result.isSuccess)).toHaveLength(1);
        expect(results.filter(Result.isFailure).map((result) => result.failure)).toEqual([
          expect.objectContaining({ reason: "invalid" }),
        ]);
        expect((yield* bots.get("reviewer")).version).toBe(2);
        expect((yield* bots.versions({ botId: "reviewer", limit: 10 })).versions).toHaveLength(2);
      }),
    ),
  );

  it.effect("records each save as a version with the fields it changed", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        yield* bots.save(
          reviewer({ instructions: EDITED, timeoutMinutes: 9, expectedVersion: 1 }),
          USER_CALLER,
        );

        const page = yield* bots.versions({ botId: "reviewer", limit: 10 });
        expect(page.hasMore).toBe(false);
        expect(page.versions.map((entry) => [entry.version, entry.changed])).toEqual([
          [2, ["instructions", "timeoutMinutes"]],
          [1, []],
        ]);
        expect(page.versions[0]).toMatchObject({ savedBy: "user", restoredFrom: null, runs: 0 });

        const first = yield* bots.version({ botId: "reviewer", version: 1 });
        expect(first.definition.instructions).toBe(ORIGINAL);
        expect(yield* bots.definitionAt("reviewer", 1)).toMatchObject({
          version: 1,
          instructions: ORIGINAL,
          timeoutMinutes: 5,
        });
        // Without a stable version, "stable" is the latest.
        expect((yield* bots.definitionAt("reviewer", "stable")).version).toBe(2);
        const missing = yield* Effect.flip(bots.definitionAt("reviewer", 7));
        expect(missing.reason).toBe("not_found");
      }),
    ),
  );

  it.effect("marks a stable version and restores an earlier one as a new version", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        yield* bots.save(reviewer({ instructions: EDITED }), USER_CALLER);

        expect((yield* bots.setStable({ botId: "reviewer", version: 1 })).stableVersion).toBe(1);
        expect((yield* bots.definitionAt("reviewer", "stable")).instructions).toBe(ORIGINAL);
        const unknown = yield* Effect.flip(bots.setStable({ botId: "reviewer", version: 9 }));
        expect(unknown.reason).toBe("not_found");

        const stale = yield* Effect.flip(
          bots.restoreVersion({ botId: "reviewer", version: 1, expectedVersion: 1 }, USER_CALLER),
        );
        expect(stale.reason).toBe("invalid");
        const restored = yield* bots.restoreVersion(
          { botId: "reviewer", version: 1, expectedVersion: 2 },
          USER_CALLER,
        );
        expect(restored).toMatchObject({ version: 3, instructions: ORIGINAL, stableVersion: 1 });
        const [latest] = (yield* bots.versions({ botId: "reviewer", limit: 1 })).versions;
        expect(latest).toMatchObject({
          version: 3,
          savedBy: "restore",
          restoredFrom: 1,
          changed: ["instructions"],
        });

        const cleared = yield* bots.setStable({ botId: "reviewer", version: null });
        expect(cleared.stableVersion).toBeUndefined();
        expect((yield* bots.get("reviewer")).stableVersion ?? null).toBeNull();
      }),
    ),
  );

  it.effect("keeps numbering versions after a bot is deleted and saved again", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer(), USER_CALLER);
        yield* bots.save(reviewer({ instructions: EDITED }), USER_CALLER);
        yield* bots.delete("reviewer");
        const again = yield* bots.save(reviewer(), USER_CALLER);
        expect(again.version).toBe(3);
        expect(
          (yield* bots.versions({ botId: "reviewer", limit: 10 })).versions.map(
            (entry) => entry.version,
          ),
        ).toEqual([3, 2, 1]);
      }),
    ),
  );

  it.effect("rates finished runs and lists them by rating", () =>
    withHarness((harness) =>
      Effect.gen(function* () {
        const bots = yield* harness.service;
        yield* bots.save(reviewer({ maxConcurrentRuns: 2 }), USER_CALLER);
        const run = yield* bots.run(
          { botId: "reviewer", inputs: { file: "a.ts" }, projectId },
          USER_CALLER,
        );
        const early = yield* Effect.flip(
          bots.rateRun({ runId: run.id, rating: "down", note: null }),
        );
        expect(early.reason).toBe("invalid");

        yield* harness.end(run.threadId, { status: "completed", reply: "Looks fine." });
        yield* bots.awaitRun(run.id, WAIT_MS);
        const rated = yield* bots.rateRun({
          runId: run.id,
          rating: "down",
          note: "Missed the SQL injection.",
        });
        expect(rated).toMatchObject({ rating: "down", note: "Missed the SQL injection." });
        expect((yield* bots.ratedRuns("reviewer", "down", 5)).map((entry) => entry.id)).toEqual([
          run.id,
        ]);
        expect(yield* bots.ratedRuns("reviewer", "up", 5)).toEqual([]);

        yield* bots.rateRun({ runId: run.id, rating: null, note: "  " });
        const cleared = yield* bots.getRun(run.id);
        expect(cleared.rating ?? null).toBeNull();
        expect(cleared.note ?? null).toBeNull();
        expect(yield* bots.ratedRuns("reviewer", "down", 5)).toEqual([]);
      }),
    ),
  );
});
