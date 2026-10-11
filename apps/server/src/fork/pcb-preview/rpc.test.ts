import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { PCB_PREVIEW_WS_METHODS as M, PcbPreviewError } from "@t3tools/contracts/fork";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { PcbPreviewService } from "./PcbPreviewService.ts";
import { makePcbPreviewRpcHandlers } from "./rpc.ts";
it.effect(
  "requires terminal permission before enclosure planning and reference exports can execute CAD",
  () =>
    Effect.gen(function* () {
      let started = 0;
      const work = () =>
        Effect.sync(() => {
          started++;
        }).pipe(
          Effect.andThen(
            Effect.fail(
              new PcbPreviewError({ reason: "tool-missing", message: "Backend reached" }),
            ),
          ),
        );
      const service = {
        enclosure: work,
        exportReference: work,
      } as unknown as PcbPreviewService["Service"];
      const handlers = (terminal: boolean) =>
        makePcbPreviewRpcHandlers(
          makeForkRpcAuth({
            sessionId: AuthSessionId.make("pcb-reference-auth"),
            subject: "test",
            method: "bearer-access-token",
            scopes: terminal ? [AuthTerminalOperateScope] : [AuthOrchestrationOperateScope],
          }),
        ).pipe(Effect.provideService(PcbPreviewService, service));
      const operate = yield* handlers(false),
        input = { threadId: ThreadId.make("pcb-thread"), designId: "board.circuit.tsx" };
      expect((yield* operate[M.enclosure](input).pipe(Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      expect((yield* operate[M.exportReference](input).pipe(Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
      expect(started).toBe(0);
      const terminal = yield* handlers(true);
      expect((yield* terminal[M.enclosure](input).pipe(Effect.flip))._tag).toBe("PcbPreviewError");
      expect((yield* terminal[M.exportReference](input).pipe(Effect.flip))._tag).toBe(
        "PcbPreviewError",
      );
      expect(started).toBe(2);
    }),
);
