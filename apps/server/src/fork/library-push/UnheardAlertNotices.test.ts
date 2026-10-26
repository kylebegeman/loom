import { describe, expect, it } from "@effect/vitest";
import { type OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as EventSink from "../../orchestration-v2/EventSink.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadCommandExecutor from "../../orchestration-v2/ThreadCommandExecutor.ts";
import { layer, UnheardAlertNotices } from "./UnheardAlertNotices.ts";

type Commit = Parameters<EventSink.EventSinkV2["Service"]["commitCommand"]>[0];

const LIVE = ThreadId.make("thread-live");
const DELETED = ThreadId.make("thread-deleted");

const setup = Effect.fn("test.setup")(function* () {
  const commits: Array<Commit> = [];
  const notices = yield* UnheardAlertNotices.pipe(
    Effect.provide(
      layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(EventSink.EventSinkV2)({
              commitCommand: (input) =>
                Effect.sync(() => {
                  commits.push(input);
                  return { committed: true } as never;
                }),
            }),
            Layer.mock(ProjectionStore.ProjectionStoreV2)({
              getThreadShell: (threadId) =>
                Effect.succeed(
                  threadId === LIVE
                    ? ({ id: LIVE, deletedAt: null } as OrchestrationV2ThreadShell)
                    : threadId === DELETED
                      ? ({ id: DELETED, deletedAt: "2026-10-20T00:00:00.000Z" } as never)
                      : null,
                ),
            }),
            ThreadCommandExecutor.layer,
          ),
        ),
      ),
    ),
  );
  return { notices, commits };
});

describe("UnheardAlertNotices", () => {
  it.effect("adds one notice per thread, kind and day to the thread", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.UTC(2026, 9, 26, 9));
      const { notices, commits } = yield* setup();
      yield* notices.post(LIVE, "agent");
      yield* notices.post(LIVE, "agent");
      yield* notices.post(LIVE, "vault");
      yield* TestClock.adjust("1 day");
      yield* notices.post(LIVE, "agent");

      const ids = commits.map((commit) => commit.commandId);
      // The repeat names the same command, so the event sink's receipt drops it.
      expect(ids).toEqual([
        `library-push-unheard:agent:2026-10-26:${LIVE}`,
        `library-push-unheard:agent:2026-10-26:${LIVE}`,
        `library-push-unheard:vault:2026-10-26:${LIVE}`,
        `library-push-unheard:agent:2026-10-27:${LIVE}`,
      ]);
      const [event] = commits[0]!.events;
      expect(event).toMatchObject({
        type: "turn-item.updated",
        threadId: LIVE,
        payload: { type: "system_notice", status: "completed", title: "No iPhone got this alert" },
      });
      const vault = commits[2]!.events[0];
      if (vault?.type !== "turn-item.updated" || vault.payload.type !== "system_notice")
        throw new Error("expected a system notice");
      expect(vault.payload.message).toContain("Vault request");
      expect(vault.payload.message).toContain("passkey");
      expect(vault.payload.message).not.toContain("—");
    }),
  );

  it.effect("leaves deleted and missing threads alone", () =>
    Effect.gen(function* () {
      const { notices, commits } = yield* setup();
      yield* notices.post(DELETED, "agent");
      yield* notices.post(ThreadId.make("thread-missing"), "vault");
      expect(commits).toEqual([]);
    }),
  );
});
