import { MODEL_PREVIEW_3D_WS_METHODS as M } from "@t3tools/contracts/fork";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { FORK_WS_METHODS, type ForkRpcMethod } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import { observeRpcEffect, observeRpcStream } from "../observability/RpcInstrumentation.ts";

/** One scope per fork RPC. Exhaustive: a fork method without a scope fails typecheck. */
export const FORK_RPC_REQUIRED_SCOPES = {
  [FORK_WS_METHODS.coreInfo]: AuthOrchestrationReadScope,
  [FORK_WS_METHODS.limits]: AuthOrchestrationReadScope,
  [M.workspace]: AuthOrchestrationReadScope,
  [M.updateWorkspace]: AuthOrchestrationOperateScope,
  [M.cancelVariant]: AuthOrchestrationOperateScope,
  [M.status]: AuthOrchestrationReadScope,
  [M.listModels]: AuthOrchestrationReadScope,
  [M.fileUrl]: AuthOrchestrationReadScope,
  [M.watch]: AuthOrchestrationReadScope,
  [M.parameters]: AuthOrchestrationReadScope,
  [M.renderScad]: AuthOrchestrationOperateScope,
  [M.saveParameterSet]: AuthOrchestrationOperateScope,
  [M.getSettings]: AuthOrchestrationReadScope,
  [M.updateSettings]: AuthOrchestrationOperateScope,
  [M.clearCache]: AuthOrchestrationOperateScope,
} as const satisfies Readonly<Record<ForkRpcMethod, AuthEnvironmentScope>>;

const denied = (scope: AuthEnvironmentScope) =>
  new EnvironmentAuthorizationError({
    message: `The authenticated token is missing required scope: ${scope}.`,
    requiredScope: scope,
  });

/** Authorization and instrumentation for fork handlers, bound to one connection. */
export const makeForkRpcAuth = (session: AuthenticatedSession) => ({
  effect: <A, E, R>(method: ForkRpcMethod, effect: Effect.Effect<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return observeRpcEffect<A, E | EnvironmentAuthorizationError, R>(
      method,
      session.scopes.includes(scope) ? effect : Effect.fail(denied(scope)),
    );
  },
  stream: <A, E, R>(method: ForkRpcMethod, stream: Stream.Stream<A, E, R>) => {
    const scope = FORK_RPC_REQUIRED_SCOPES[method];
    return observeRpcStream<A, E | EnvironmentAuthorizationError, R>(
      method,
      session.scopes.includes(scope) ? stream : Stream.fail(denied(scope)),
    );
  },
});
export type ForkRpcAuth = ReturnType<typeof makeForkRpcAuth>;
