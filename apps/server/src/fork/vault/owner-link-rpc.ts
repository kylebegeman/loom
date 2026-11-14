import {
  VAULT_ACCESS_WS_METHODS as V,
  VaultError,
  type VaultOwnerLinkRequest,
  type VaultOwnerLinkApproval,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { authorizeVaultOwner } from "./access-rpc.ts";
import { VaultOwnerLink } from "./VaultOwnerLink.ts";

export const makeVaultOwnerLinkRpcHandlers = Effect.fn("VaultOwnerLink.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  session: AuthenticatedSession,
) {
  const link = yield* VaultOwnerLink;
  const authorize = (
    method: typeof V.ownerLinkPrepare | typeof V.ownerLinkApprove | typeof V.ownerLinkApply,
  ) =>
    method === V.ownerLinkApprove
      ? auth
          .effect(method, Effect.void)
          .pipe(Effect.mapError(() => new VaultError({ reason: "denied" })))
      : authorizeVaultOwner(auth, session.subject, session, method);
  return {
    [V.ownerLinkPrepare]: (input: { readonly operationId: string }) =>
      auth.effect(
        V.ownerLinkPrepare,
        authorize(V.ownerLinkPrepare).pipe(
          Effect.andThen(link.prepare(input.operationId, session, authorize(V.ownerLinkPrepare))),
        ),
      ),
    [V.ownerLinkApprove]: (input: VaultOwnerLinkRequest) =>
      auth.effect(
        V.ownerLinkApprove,
        authorize(V.ownerLinkApprove).pipe(Effect.andThen(link.approve(input, session))),
      ),
    [V.ownerLinkApply]: (input: VaultOwnerLinkApproval) =>
      auth.effect(
        V.ownerLinkApply,
        authorize(V.ownerLinkApply).pipe(
          Effect.andThen(link.apply(input, session, authorize(V.ownerLinkApply))),
        ),
      ),
  };
});
