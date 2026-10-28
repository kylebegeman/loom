import {
  PROJECT_LIFECYCLE_WS_METHODS as L,
  type LaneFreeScope,
  type LaneLeaseKind,
  type ProjectLifecycleSettings,
} from "@t3tools/contracts/fork";
import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as StorageCleanup from "../../storageCleanup.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { ProjectLifecycleService } from "./ProjectLifecycleService.ts";

export const makeProjectLifecycleRpcHandlers = Effect.fn("ProjectLifecycle.makeRpcHandlers")(
  function* (auth: ForkRpcAuth) {
    const service = yield* ProjectLifecycleService;
    const storageCleanup = yield* StorageCleanup.StorageCleanup;
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
      [L.discardUnrecorded]: (input: { path: string }) =>
        auth.effect(L.discardUnrecorded, service.discardUnrecorded(input.path)),
      [L.installShell]: () => auth.effect(L.installShell, service.installShell()),
      [L.removeShell]: () => auth.effect(L.removeShell, service.removeShell()),
      [L.releaseLease]: (input: { laneId: string; kind: LaneLeaseKind; ref: string }) =>
        auth.effect(L.releaseLease, service.releaseLease(input.laneId, input.kind, input.ref)),
      [L.restoreCheckout]: (input: { threadId: ThreadId }) =>
        auth.effect(L.restoreCheckout, service.restoreCheckout(input.threadId)),
      [L.releaseCheckout]: (input: { threadId: ThreadId }) =>
        auth.effect(
          L.releaseCheckout,
          storageCleanup
            .releaseCheckout(input.threadId)
            .pipe(Effect.tap(() => service.refreshCheckouts())),
        ),
    };
  },
);
