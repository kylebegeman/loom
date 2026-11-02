import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  AuthSessionId,
} from "@t3tools/contracts";
import {
  DEV_ENVIRONMENT_WS_METHODS as D,
  FORK_CLIENT_GUARDED_RPC_SCOPES,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
it.effect(
  "allows readers to inspect development state and requires terminal authority before mutations or credential release",
  () =>
    Effect.gen(function* () {
      const read = makeForkRpcAuth({
        sessionId: AuthSessionId.make("dev-read"),
        subject: "test",
        method: "bearer-access-token",
        scopes: [AuthOrchestrationReadScope],
      });
      let executions = 0;
      for (const method of [
        D.start,
        D.control,
        D.compose,
        D.database,
        D.databaseUrl,
        D.httpSend,
        D.httpHistory,
        D.httpClear,
      ]) {
        expect(FORK_CLIENT_GUARDED_RPC_SCOPES[method]).toBe(AuthTerminalOperateScope);
        expect(
          (yield* read
            .effect(
              method,
              Effect.sync(() => ++executions),
            )
            .pipe(Effect.flip)).requiredScope,
        ).toBe(AuthTerminalOperateScope);
      }
      expect(
        (yield* read.effect(D.httpHistory, Effect.succeed("private")).pipe(Effect.flip))
          .requiredScope,
      ).toBe(AuthTerminalOperateScope);
      expect(executions).toBe(0);
      for (const method of [D.snapshot, D.containers, D.diagnostics])
        expect(yield* read.effect(method, Effect.succeed("read"))).toBe("read");
    }),
);
