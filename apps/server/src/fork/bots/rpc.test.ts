import { expect, it } from "@effect/vitest";
import { AuthOrchestrationReadScope, AuthSessionId } from "@t3tools/contracts";
import { BOTS_WS_METHODS as B, BotsError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { BotsService } from "./BotsService.ts";
import { makeBotsRpcHandlers } from "./rpc.ts";
import { testRun } from "./testing/fixtures.ts";

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
      const auth = (read: boolean) =>
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("bot-run-reader"),
          subject: "reader",
          method: "bearer-access-token",
          scopes: read ? [AuthOrchestrationReadScope] : [],
        });
      const reader = yield* makeBotsRpcHandlers(auth(true)).pipe(Effect.provide(layer));
      expect(yield* reader[B.getRun]({ runId: run.id })).toEqual({ run });
      expect(yield* reader[B.getRun]({ runId: "missing" })).toEqual({ run: null });
      expect(yield* reader[B.getRun]({ runId: "storage" }).pipe(Effect.flip)).toMatchObject({
        reason: "storage",
      });
      const denied = yield* makeBotsRpcHandlers(auth(false)).pipe(Effect.provide(layer));
      expect(yield* denied[B.getRun]({ runId: run.id }).pipe(Effect.flip)).toMatchObject({
        requiredScope: AuthOrchestrationReadScope,
      });
      expect(calls).toBe(3);
    }),
);
