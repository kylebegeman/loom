import { expect, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  AuthSessionId,
  AuthSettingsWriteScope,
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
      expect(FORK_CLIENT_GUARDED_RPC_SCOPES[D.apiLibrary]).toBe(AuthSettingsWriteScope);
      expect((yield* read.effect(D.apiLibrary, Effect.void).pipe(Effect.flip)).requiredScope).toBe(
        AuthSettingsWriteScope,
      );
      let executions = 0;
      for (const method of [
        D.start,
        D.control,
        D.compose,
        D.database,
        D.databaseUrl,
        D.apiWorkflowWatch,
        D.apiWorkflow,
        D.apiAuthor,
        D.apiList,
        D.apiImport,
        D.apiRead,
        D.apiEnvironment,
        D.apiSaveEnvironment,
        D.apiRun,
        D.apiSaveRequest,
        D.apiExport,
        D.apiRemove,
        D.httpSend,
        D.httpHistory,
        D.httpBaseline,
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
