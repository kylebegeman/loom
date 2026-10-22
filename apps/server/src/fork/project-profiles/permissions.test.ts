import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  PROJECT_PROFILES_WS_METHODS as PP,
  FORK_CLIENT_GUARDED_RPC_SCOPES,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
it.effect("requires terminal permission before validation or run preparation can execute", () =>
  Effect.gen(function* () {
    const auth = (scopes: readonly AuthEnvironmentScope[]) =>
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("profile-test"),
        subject: "test",
        method: "bearer-access-token",
        scopes,
      });
    let executions = 0;
    const work = Effect.sync(() => ++executions);
    for (const method of [PP.varlockValidate, PP.varlockCommand]) {
      expect(FORK_CLIENT_GUARDED_RPC_SCOPES[method]).toBe(AuthTerminalOperateScope);
      expect(
        (yield* Effect.flip(
          auth([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]).effect(method, work),
        )).requiredScope,
      ).toBe(AuthTerminalOperateScope);
      expect(executions).toBe(0);
      yield* auth([AuthTerminalOperateScope]).effect(method, Effect.void);
    }
    for (const method of [PP.update, PP.reset, PP.updateSettings]) {
      expect(
        (yield* Effect.flip(auth([AuthOrchestrationReadScope]).effect(method, work))).requiredScope,
      ).toBe(AuthOrchestrationOperateScope);
    }
    expect(executions).toBe(0);
    expect(
      yield* auth([AuthOrchestrationReadScope]).effect(PP.envReport, Effect.succeed("read")),
    ).toBe("read");
  }),
);
