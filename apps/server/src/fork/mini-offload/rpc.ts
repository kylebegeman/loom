import {
  MINI_OFFLOAD_WS_METHODS as M,
  type MiniWorker,
  type MiniSubmit,
  type MiniRef,
  type MiniWorkerRef,
  type MiniWorkerConnection,
} from "@t3tools/contracts/fork";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as Mini from "./MiniOffloadService.ts";
export const makeMiniOffloadRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* Mini.MiniOffloadService;
    return {
      [M.workers]: () => auth.effect(M.workers, service.workers),
      [M.register]: (input: MiniWorker) => auth.effect(M.register, service.register(input)),
      [M.setEnabled]: (input: { workerId: string; enabled: boolean }) =>
        auth.effect(M.setEnabled, service.setEnabled(input)),
      [M.submit]: (input: MiniSubmit) => auth.effect(M.submit, service.submit(input)),
      [M.recover]: (input: MiniRef) => auth.effect(M.recover, service.recover(input)),
      [M.list]: (input: { threadId: ThreadId }) =>
        auth.effect(M.list, service.list(input.threadId)),
      [M.inspect]: (input: MiniRef) => auth.effect(M.inspect, service.inspect(input)),
      [M.cancel]: (input: MiniRef) => auth.effect(M.cancel, service.cancel(input)),
      [M.patch]: (input: MiniRef) => auth.effect(M.patch, service.patch(input)),
      [M.check]: (input: MiniWorkerRef) => auth.effect(M.check, service.check(input)),
      [M.prepare]: (input: MiniWorkerRef) => auth.effect(M.prepare, service.prepare(input)),
      [M.updateWorker]: (input: MiniWorkerConnection) =>
        auth.effect(M.updateWorker, service.updateWorker(input)),
      [M.removeWorker]: (input: MiniWorkerRef) =>
        auth.effect(M.removeWorker, service.removeWorker(input)),
      [M.artifacts]: (input: MiniRef) => auth.effect(M.artifacts, service.artifacts(input)),
    };
  });
