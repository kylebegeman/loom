import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthSessionId,
  AuthTerminalOperateScope,
  CheckpointId,
  ThreadId,
  type EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { MODEL_PREVIEW_3D_WS_METHODS as M, ModelPreviewError } from "@t3tools/contracts/fork";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { ModelPreviewService } from "./ModelPreviewService.ts";
import { makeModelPreviewRpcHandlers } from "./rpc.ts";

it.effect(
  "requires terminal permission before indirect Python execution while retaining mesh operations",
  () =>
    Effect.gen(function* () {
      let started = 0;
      const work = () =>
        Effect.sync(() => {
          started++;
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new ModelPreviewError({ reason: "unavailable", message: "Backend reached" }),
            ),
          ),
        );
      const service: ModelPreviewService["Service"] = new Proxy(
        {
          checkPrint: work,
          historyVersion: work,
          slice: work,
          updateAssembly: work,
          checkAssembly: work,
        } as Partial<ModelPreviewService["Service"]>,
        {
          get(target, key) {
            if (key in target) return Reflect.get(target, key);
            throw new Error(`Unexpected service call: ${String(key)}`);
          },
        },
      ) as ModelPreviewService["Service"];
      const handlers = (scopes: readonly AuthEnvironmentScope[]) =>
        makeModelPreviewRpcHandlers(
          makeForkRpcAuth({
            sessionId: AuthSessionId.make("cad-rpc-test"),
            subject: "test",
            method: "bearer-access-token",
            scopes,
          }),
        ).pipe(Effect.provideService(ModelPreviewService, service));
      const operate = yield* handlers([AuthOrchestrationReadScope, AuthOrchestrationOperateScope]);
      const python = { threadId: ThreadId.make("cad-thread"), path: "part.b3d.py" },
        mesh = { ...python, path: "part.stl" };
      const denied: readonly Effect.Effect<
        unknown,
        ModelPreviewError | EnvironmentAuthorizationError
      >[] = [
        operate[M.checkPrint]({ file: python }),
        operate[M.historyVersion]({
          file: python,
          checkpointId: CheckpointId.make("cad-checkpoint"),
        }),
        operate[M.slice]({ file: python, overrides: {}, parameterSet: null }),
        operate[M.checkAssembly]({ file: { ...python, path: "kit.loom-assembly.json" } }),
        operate[M.updateAssembly]({
          file: { ...python, path: "kit.loom-assembly.json" },
          operations: [{ op: "align", id: "part", to: "origin", axis: "z", mode: "min" }],
        }),
      ];
      const placement = operate[M.updateAssembly]({
        file: { ...python, path: "kit.loom-assembly.json" },
        operations: [{ op: "place-board", id: "board" }],
      });
      const placementFailure = yield* Effect.flip(placement);
      expect(placementFailure._tag).toBe("EnvironmentAuthorizationError");
      for (const request of denied) {
        const failure = yield* Effect.flip(request.pipe(Effect.asVoid));
        expect(failure._tag).toBe("EnvironmentAuthorizationError");
      }
      expect(started).toBe(0);
      expect((yield* Effect.flip(operate[M.checkPrint]({ file: mesh })))._tag).toBe(
        "ModelPreviewError",
      );
      const terminal = yield* handlers([AuthOrchestrationOperateScope, AuthTerminalOperateScope]);
      expect((yield* Effect.flip(terminal[M.checkPrint]({ file: python })))._tag).toBe(
        "ModelPreviewError",
      );
      expect(started).toBe(2);
    }),
);
