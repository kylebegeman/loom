import {
  PROJECT_LIFECYCLE_WS_METHODS as L,
  type LaneFreeScope,
  type ProjectLifecycleSettings,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { ProjectLifecycleService } from "./ProjectLifecycleService.ts";

export const makeProjectLifecycleRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* ProjectLifecycleService;
    return {
      [L.getSettings]: () => auth.effect(L.getSettings, service.getSettings),
      [L.updateSettings]: (input: ProjectLifecycleSettings) =>
        auth.effect(L.updateSettings, service.updateSettings(input)),
      [L.watch]: () => auth.stream(L.watch, service.changes),
      [L.free]: (input: { laneId: string; scope: LaneFreeScope }) =>
        auth.effect(L.free, service.free(input.laneId, input.scope)),
      [L.grow]: (input: { laneId: string }) => auth.effect(L.grow, service.grow(input.laneId)),
      [L.mount]: (input: { laneId: string }) => auth.effect(L.mount, service.mount(input.laneId)),
      [L.discard]: (input: { laneId: string }) =>
        auth.effect(L.discard, service.discard(input.laneId)),
      [L.installShell]: () => auth.effect(L.installShell, service.installShell()),
      [L.removeShell]: () => auth.effect(L.removeShell, service.removeShell()),
    };
  });
