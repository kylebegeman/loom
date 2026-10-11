import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import type { PcbCheckKind, PcbCheckResult } from "@t3tools/contracts/fork";
import { makeAutoChecks } from "./autoChecks.ts";

const setup = Effect.gen(function* () {
  let hash = "one",
    enabled = true,
    slow = false,
    failed = false;
  const stored = new Map<PcbCheckKind, PcbCheckResult>();
  const calls: string[] = [];
  const started = yield* Deferred.make<void>(),
    stopped = yield* Deferred.make<void>(),
    completed = yield* Deferred.make<void>();
  let block = false;
  const scheduler = yield* makeAutoChecks<string>({
    key: (d) => d,
    project: () => "project",
    available: (_d, kind) => kind === "drc",
    settings: () => Effect.succeed({ autoChecks: { erc: false, drc: enabled } }),
    snapshot: () => Effect.succeed(hash),
    stored: (_d, kind) => Effect.succeed(stored.get(kind) ?? null),
    run: (_d, kind, trigger) =>
      Effect.gen(function* () {
        calls.push(`${trigger}:${hash}`);
        if (block) {
          block = false;
          yield* Deferred.succeed(started, undefined);
          return yield* Effect.never.pipe(
            Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
          );
        }
        const result: PcbCheckResult = {
          kind,
          sourceHash: hash,
          outcome: failed ? "failed" : "clean",
          ranAt: "2026-10-11T12:00:00.000Z",
          counts: { errors: 0, warnings: 0, excluded: 0 },
          violations: [],
          truncated: false,
          log: "",
          durationMs: slow ? 60_001 : 50,
        };
        if (!failed || trigger === "manual") stored.set(kind, result);
        yield* Deferred.succeed(completed, undefined);
        return result;
      }),
  });
  return {
    scheduler,
    calls,
    stored,
    started,
    stopped,
    completed,
    setHash: (h: string) => {
      hash = h;
    },
    setBlock: () => {
      block = true;
    },
    setEnabled: (v: boolean) => {
      enabled = v;
    },
    setSlow: (v: boolean) => {
      slow = v;
    },
    setFailed: (v: boolean) => {
      failed = v;
    },
  };
});
it.effect("coalesces save bursts and shares one job for multiple watchers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.scheduler.watching("board");
      yield* t.scheduler.watching("board");
      yield* t.scheduler.notify("board", "one");
      t.setHash("two");
      yield* t.scheduler.notify("board", "two");
      t.setHash("three");
      const job = yield* t.scheduler.notify("board", "three");
      yield* TestClock.adjust("2 seconds");
      if (job) yield* Fiber.join(job);
      expect(t.calls).toEqual(["auto:three"]);
      yield* t.scheduler.ensureFresh("board");
      expect(t.calls).toHaveLength(1);
    }),
  ),
);
it.effect("a save interrupts an obsolete run and manual checks replace automatic work", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.scheduler.watching("board");
      t.setBlock();
      yield* t.scheduler.notify("board", "one");
      yield* TestClock.adjust("2 seconds");
      yield* Deferred.await(t.started);
      t.setHash("two");
      yield* t.scheduler.notify("board", "two");
      yield* Deferred.await(t.stopped);
      yield* t.scheduler.manual("board", "drc");
      yield* TestClock.adjust("2 seconds");
      yield* t.scheduler.ensureFresh("board");
      expect(t.calls).toEqual(["auto:one", "manual:two"]);
    }),
  ),
);
it.effect("closing the last watcher cancels its running process", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const t = yield* setup;
      t.setBlock();
      const watcher = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* t.scheduler.watching("board");
          yield* t.scheduler.notify("board", "one");
          return yield* Effect.never;
        }),
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("2 seconds");
      yield* Deferred.await(t.started);
      yield* Fiber.interrupt(watcher);
      yield* Deferred.await(t.stopped);
      expect(t.calls).toEqual(["auto:one"]);
    }),
  ),
);
it.effect("pauses slow runs until a fast manual check and retries failures only on new files", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.scheduler.watching("board");
      t.setSlow(true);
      yield* t.scheduler.ensureFresh("board");
      t.setHash("two");
      yield* t.scheduler.ensureFresh("board");
      expect(t.calls).toHaveLength(1);
      t.setSlow(false);
      yield* t.scheduler.manual("board", "drc");
      t.setHash("three");
      t.setFailed(true);
      yield* t.scheduler.ensureFresh("board");
      yield* t.scheduler.ensureFresh("board");
      expect(t.calls).toEqual(["auto:one", "manual:two", "auto:three"]);
      t.setHash("four");
      t.setFailed(false);
      yield* t.scheduler.ensureFresh("board");
      expect(t.calls.at(-1)).toBe("auto:four");
    }),
  ),
);
it.effect("settings off cancels queued work and agent reads do not run disabled checks", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const t = yield* setup;
      yield* t.scheduler.watching("board");
      yield* t.scheduler.notify("board", "one");
      t.setEnabled(false);
      yield* t.scheduler.settingsChanged("project");
      yield* TestClock.adjust("2 seconds");
      yield* t.scheduler.ensureFresh("board");
      expect(t.calls).toEqual([]);
    }),
  ),
);
