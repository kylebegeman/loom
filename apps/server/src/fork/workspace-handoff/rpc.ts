import {
  WORKSPACE_HANDOFF_WS_METHODS as H,
  type WorkspaceHandoffPrepareInput,
  type WorkspaceHandoffFinishInput,
} from "@t3tools/contracts/fork";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as WorkspaceHandoff from "./WorkspaceHandoffService.ts";

export const makeWorkspaceHandoffRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* WorkspaceHandoff.WorkspaceHandoffService;
    return {
      [H.offer]: (input: { threadId: ThreadId; requestId: string }) =>
        auth.effect(H.offer, service.offer(input)),
      [H.prepare]: (input: WorkspaceHandoffPrepareInput) =>
        auth.effect(H.prepare, service.prepare(input)),
      [H.finish]: (input: WorkspaceHandoffFinishInput) =>
        auth.effect(H.finish, service.finish(input)),
      [H.resume]: (input: WorkspaceHandoffFinishInput) =>
        auth.effect(H.resume, service.resume(input)),
    };
  });
