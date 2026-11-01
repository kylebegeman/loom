import { AuthStandardClientScopes } from "@t3tools/contracts";
import {
  UPSTREAM_WS_METHODS as U,
  UpstreamSupervisorError,
  type UpstreamSupervisorConfigInput,
  type UpstreamSupervisorDispatchInput,
  type UpstreamSupervisorStatusInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as Upstream from "./UpstreamSupervisor.ts";

export const makeUpstreamRpcHandlers = Effect.fn("Upstream.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  session: AuthenticatedSession,
) {
  const service = yield* Upstream.UpstreamSupervisor;
  const owner =
    !/^(thread:|client:|broker:|host:|library:|mcp-client$)/.test(session.subject) &&
    AuthStandardClientScopes.every((scope) => session.scopes.includes(scope));
  const actor: Upstream.UpstreamSupervisorActor = {
    sessionId: session.sessionId,
    owner,
    authorize: Effect.suspend(() =>
      owner
        ? auth
            .effect(U.configure, Effect.void)
            .pipe(Effect.mapError(() => new UpstreamSupervisorError({ reason: "denied" })))
        : Effect.fail(new UpstreamSupervisorError({ reason: "denied" })),
    ),
  };
  return {
    [U.status]: (input: UpstreamSupervisorStatusInput) =>
      auth.effect(U.status, service.status(input.projectId, actor, input.runIds)),
    [U.configure]: (input: UpstreamSupervisorConfigInput) =>
      auth.effect(U.configure, service.configure(input, actor)),
    [U.dispatch]: (input: UpstreamSupervisorDispatchInput) =>
      auth.effect(U.dispatch, service.dispatch(input, actor)),
  };
});
