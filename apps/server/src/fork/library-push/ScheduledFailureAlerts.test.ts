import { describe, expect, it } from "@effect/vitest";
import { ScheduledTaskId } from "@t3tools/contracts";
import type { LibraryPushActivityRequest } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Logger from "effect/Logger";
import { makeScheduledFailureAlerts } from "./ScheduledFailureAlerts.ts";

const task = (status: "failed" | "running" | "succeeded", at: string, id = "task-1") => ({
  id: ScheduledTaskId.make(id),
  lastRunAt: at,
  lastRunStatus: status,
});

describe("ScheduledFailureAlerts", () => {
  it.effect("logs an older Library refusal only once across later failed runs", () =>
    Effect.gen(function* () {
      const alerts = yield* makeScheduledFailureAlerts(() => Effect.succeed("unsupported-kind"));
      yield* alerts.observe([]);
      const messages: unknown[] = [];
      yield* Effect.gen(function* () {
        yield* alerts.observe([task("failed", "first")]);
        yield* alerts.observe([task("failed", "second")]);
      }).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make((entry) => {
              messages.push(entry.message);
            }),
          ]),
        ),
      );
      expect(messages).toHaveLength(1);
    }),
  );

  it.effect("posts each newly failed run once and leaves initial history and successes quiet", () =>
    Effect.gen(function* () {
      const posts: LibraryPushActivityRequest[] = [];
      const alerts = yield* makeScheduledFailureAlerts((request) =>
        Effect.sync(() => {
          posts.push(request);
          return "sent" as const;
        }),
      );
      yield* alerts.observe([task("failed", "old")]);
      yield* alerts.observe([task("running", "new")]);
      yield* alerts.observe([task("failed", "new")]);
      yield* alerts.observe([task("failed", "new")]);
      yield* alerts.observe([task("succeeded", "newer")]);
      yield* alerts.observe([task("failed", "newest"), task("failed", "added", "task-2")]);
      expect(posts).toEqual([
        { kind: "scheduled-failed", taskId: "task-1" },
        { kind: "scheduled-failed", taskId: "task-1" },
        { kind: "scheduled-failed", taskId: "task-2" },
      ]);
    }),
  );
});
