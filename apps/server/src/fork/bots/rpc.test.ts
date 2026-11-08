import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { BOTS_WS_METHODS as B, BotsError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { BotCompletions } from "./BotCompletions.ts";
import { BotOperations } from "./BotOperations.ts";
import { BotsService, USER_CALLER } from "./BotsService.ts";
import { makeBotsRpcHandlers } from "./rpc.ts";
import { testRun } from "./testing/fixtures.ts";
import { projectId, reviewer, withHarness } from "./testing/BotsHarness.ts";

const sessionWith = (scopes: AuthenticatedSession["scopes"]): AuthenticatedSession => ({
  sessionId: AuthSessionId.make("bot-run-reader"),
  subject: "reader",
  method: "bearer-access-token",
  scopes,
});

it.effect(
  "reads an old run by id with read access and keeps not-found distinct from storage errors",
  () =>
    Effect.gen(function* () {
      const run = testRun("older-run", "2026-10-20T00:00:00Z");
      let calls = 0;
      const layer = Layer.mock(BotsService)({
        activeRunCount: () => 0,
        getRun: (runId) =>
          Effect.suspend(() => {
            calls++;
            return runId === run.id
              ? Effect.succeed(run)
              : Effect.fail(
                  new BotsError({
                    reason: runId === "missing" ? "not_found" : "storage",
                    message: "Could not read this run.",
                  }),
                );
          }),
      });
      const handlers = (read: boolean) => {
        const session = sessionWith(read ? [AuthOrchestrationReadScope] : []);
        return makeBotsRpcHandlers(makeForkRpcAuth(session), session).pipe(
          Effect.provide(
            Layer.mergeAll(layer, Layer.mock(BotOperations)({}), Layer.mock(BotCompletions)({})),
          ),
        );
      };
      const reader = yield* handlers(true);
      expect(yield* reader[B.getRun]({ runId: run.id })).toEqual({ run });
      expect(yield* reader[B.getRun]({ runId: "missing" })).toEqual({ run: null });
      expect(yield* reader[B.getRun]({ runId: "storage" }).pipe(Effect.flip)).toMatchObject({
        reason: "storage",
      });
      const denied = yield* handlers(false);
      expect(yield* denied[B.getRun]({ runId: run.id }).pipe(Effect.flip)).toMatchObject({
        requiredScope: AuthOrchestrationReadScope,
      });
      expect(calls).toBe(3);
    }),
);

it.effect("runs and retries a person starts launch as their session, also from a thread", () =>
  withHarness((harness) =>
    Effect.gen(function* () {
      const bots = yield* harness.service;
      yield* bots.save(reviewer(), USER_CALLER);
      harness.shells.set("chat", { projectId, worktreePath: null, branch: null });
      const session = sessionWith([AuthOrchestrationOperateScope]);
      const handlers = yield* makeBotsRpcHandlers(makeForkRpcAuth(session), session).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(BotsService, bots),
            Layer.mock(BotOperations)({}),
            Layer.mock(BotCompletions)({}),
          ),
        ),
      );
      const libraryCaller = { sessionId: session.sessionId };
      const input = { botId: "reviewer", inputs: { file: "a.ts" }, projectId };

      const first = yield* handlers[B.run](input);
      expect((yield* harness.nextLaunch).libraryCaller).toEqual(libraryCaller);
      yield* harness.end(first.threadId, { status: "failed", reply: null });
      yield* bots.awaitRun(first.id);
      const retried = yield* handlers[B.retry]({ runId: first.id });
      expect((yield* harness.nextLaunch).libraryCaller).toEqual(libraryCaller);
      yield* harness.end(retried.threadId, { status: "completed", reply: "Done." });
      yield* bots.awaitRun(retried.id);
      yield* handlers[B.run]({ ...input, callerThreadId: ThreadId.make("chat") });
      expect(yield* harness.nextLaunch).toMatchObject({
        libraryCaller,
        initialMessage: { senderThreadId: "chat" },
      });
    }),
  ),
);
