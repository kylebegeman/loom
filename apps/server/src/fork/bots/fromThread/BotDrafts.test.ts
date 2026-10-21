import { describe, expect, it } from "@effect/vitest";
import { ScheduledTaskId, ThreadId } from "@t3tools/contracts";
import { BotsError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import { message, scratchId, withDraftsHarness } from "../testing/DraftsHarness.ts";
import { REFINE_TIMEOUT_MS, UNUSABLE_REFINEMENT } from "./BotDrafts.ts";

const source = ThreadId.make("thread-a");

describe("BotDrafts.draftFromThread", () => {
  it.effect("refuses bot runs and threads without a request", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        harness.addThread("bot-run-1", [message("bot-run-1", "Review a.ts")]);
        harness.addThread("empty", [message("empty", "Done.", { role: "assistant" })]);
        for (const threadId of ["bot-run-1", "empty"]) {
          const error = yield* drafts.draftFromThread(ThreadId.make(threadId)).pipe(Effect.flip);
          expect(error).toBeInstanceOf(BotsError);
          expect(error.reason).toBe("invalid");
        }
      }),
    ),
  );

  it.effect("skips scheduled and notification messages and notes attachments", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        harness.addThread("thread-a", [
          message("thread-a", "Nightly sweep", { scheduledTaskId: ScheduledTaskId.make("task") }),
          message("thread-a", "A run finished", {
            notification: { kind: "bot-run", summary: "Done" },
          } as never),
          message("thread-a", "Review PR #12 in src/a.ts", {
            attachments: [{ type: "image" }] as never,
          }),
        ]);
        const result = yield* drafts.draftFromThread(source);
        expect(result.draft.instructions).toBe("Review PR #{{pr}} in {{file}}");
        expect(result.sourceThreadId).toBe(source);
        expect(result.notes).toContain(
          "The first message had attachments, which a bot cannot carry; they were left out.",
        );
      }),
    ),
  );

  it.effect("gives a thread in the scratch project a scratch workspace", () =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        harness.addThread("thread-a", [message("thread-a", "Summarize the news")], {
          projectId: scratchId,
        });
        const { draft } = yield* drafts.draftFromThread(source);
        expect(draft.workspace).toEqual({ type: "scratch" });
      }),
    ),
  );
});

describe("BotDrafts.refine", () => {
  const refineWith = (reply: string | null, hang = false) =>
    withDraftsHarness((harness) =>
      Effect.gen(function* () {
        const drafts = yield* harness.service;
        harness.addThread("thread-a", [message("thread-a", "Review PR #12 in src/a.ts")]);
        harness.state.reply = reply;
        harness.state.hang = hang;
        const { draft } = yield* drafts.draftFromThread(source);
        const fiber = yield* drafts.refine({ threadId: source, draft }).pipe(Effect.forkChild);
        if (hang) yield* TestClock.adjust(REFINE_TIMEOUT_MS);
        const result = yield* Fiber.join(fiber);
        return { harness, draft, result };
      }),
    );

  it.effect("launches a hidden read-only thread in scratch and merges the four fields", () =>
    Effect.gen(function* () {
      const { harness, draft, result } = yield* refineWith(
        'Here it is:\n```json\n{"name":"PR reviewer","description":"Reviews a pull request.","instructions":"Review PR {{pr}}.","parameters":[{"name":"pr","label":"Pull request","type":"number","required":true}],"runtimeMode":"full-access","timeoutMinutes":99}\n```',
      );
      const launch = harness.launches[0]!;
      expect(launch.threadId?.startsWith("bot-run-draft-")).toBe(true);
      expect(launch).toMatchObject({
        projectId: scratchId,
        runtimeMode: "approval-required",
        interactionMode: "default",
        modelSelection: { model: "opus" },
      });
      expect(result.draft).toEqual({
        ...draft,
        name: "PR reviewer",
        description: "Reviews a pull request.",
        instructions: "Review PR {{pr}}.",
        parameters: [{ name: "pr", label: "Pull request", type: "number", required: true }],
      });
      expect(result.notes).toEqual([]);
      expect(harness.dispatched).toEqual([
        expect.objectContaining({ type: "thread.archive", threadId: launch.threadId }),
      ]);
    }),
  );

  it.effect("keeps the original on an unparseable or unusable reply", () =>
    Effect.gen(function* () {
      for (const reply of [
        "I could not do that.",
        '{"name":"x","parameters":[{"name":"a","label":"A","type":"choice","required":true}]}',
      ]) {
        const { harness, draft, result } = yield* refineWith(reply);
        expect(result).toMatchObject({ draft, notes: [UNUSABLE_REFINEMENT] });
        expect(harness.dispatched.map((command) => command.type)).toEqual(["thread.archive"]);
      }
    }),
  );

  it.effect("stops the drafting thread at the time limit and archives it", () =>
    Effect.gen(function* () {
      const { harness, draft, result } = yield* refineWith(null, true);
      expect(result.draft).toEqual(draft);
      expect(result.notes).toEqual(["The model took too long; showing the original."]);
      expect(harness.interrupted).toEqual([harness.launches[0]!.threadId]);
      expect(harness.dispatched.map((command) => command.type)).toEqual(["thread.archive"]);
    }),
  );
});
