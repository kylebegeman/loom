import {
  VAULT_ACCESS_WS_METHODS as V,
  VaultError,
  type VaultOwnerPolicyChange,
  type VaultApprovalCreate,
  type VaultApprovalChange,
  type VaultGrantMutation,
  type VaultGrantBatchMutation,
  type VaultDecisionInput,
  type VaultReadinessInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import { AuthStandardClientScopes } from "@t3tools/contracts";
import type { AuthenticatedSession } from "../../auth/EnvironmentAuth.ts";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultAccessInspector from "./VaultAccessInspector.ts";
import * as VaultReadiness from "./VaultReadiness.ts";
import * as VaultAccess from "./VaultAccess.ts";
export const makeVaultAccessRpcHandlers = Effect.fn("VaultAccess.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  actor: string,
  session?: AuthenticatedSession,
) {
  const access = yield* VaultAccess.VaultAccess;
  const readiness = yield* VaultReadiness.VaultReadiness;
  const inspector = yield* VaultAccessInspector.VaultAccessInspector;
  const authorizeGrant = (method: typeof V.apply | typeof V.applyBatch) =>
    Effect.suspend(() =>
      actor.startsWith("thread:") || actor === "mcp-client"
        ? Effect.fail(new VaultError({ reason: "denied" }))
        : auth
            .effect(method, Effect.void)
            .pipe(Effect.mapError(() => new VaultError({ reason: "denied" }))),
    );
  // Declaring an environment personal requires its human administrator, not a scoped
  // client, provider workload, broker or Library replication identity.
  const authorizeOwner = Effect.suspend(() =>
    !session ||
    session.subject !== actor ||
    /^(thread:|client:|broker:|host:|library:|mcp-client$)/.test(actor) ||
    !AuthStandardClientScopes.every((scope) => session.scopes.includes(scope))
      ? Effect.fail(new VaultError({ reason: "denied" }))
      : auth.effect(V.setOwnerPolicy, Effect.void).pipe(
          Effect.andThen(auth.effect(V.apply, Effect.void)),
          Effect.mapError(() => new VaultError({ reason: "denied" })),
        ),
  );
  return {
    [V.setOwnerPolicy]: (input: VaultOwnerPolicyChange) =>
      auth.effect(
        V.setOwnerPolicy,
        authorizeOwner.pipe(
          Effect.andThen(() => access.setOwnerPolicy(input, actor, authorizeOwner)),
        ),
      ),
    [V.approvalInbox]: () => auth.effect(V.approvalInbox, access.approvalInbox),
    [V.approvalCreate]: (input: VaultApprovalCreate) =>
      auth.effect(
        V.approvalCreate,
        access.approvalCreate(
          input,
          actor,
          Effect.suspend(() => auth.effect(V.approvalCreate, Effect.void)).pipe(
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          ),
        ),
      ),
    [V.approvalChange]: (input: VaultApprovalChange) =>
      auth.effect(
        V.approvalChange,
        access.approvalChange(
          input,
          actor,
          Effect.suspend(() => auth.effect(V.approvalChange, Effect.void)).pipe(
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          ),
        ),
      ),
    [V.catalog]: () => auth.effect(V.catalog, access.catalog),
    [V.snapshot]: () => auth.effect(V.snapshot, access.snapshot),
    [V.apply]: (input: VaultGrantMutation) =>
      auth.effect(
        V.apply,
        authorizeGrant(V.apply).pipe(
          Effect.andThen(() => access.apply(input, actor, authorizeGrant(V.apply))),
        ),
      ),
    [V.applyBatch]: (input: VaultGrantBatchMutation) =>
      auth.effect(
        V.applyBatch,
        authorizeGrant(V.applyBatch).pipe(
          Effect.andThen(() => access.applyBatch(input, actor, authorizeGrant(V.applyBatch))),
        ),
      ),
    [V.previewBatch]: (input: VaultGrantBatchMutation) =>
      auth.effect(V.previewBatch, access.previewBatch(input, actor)),
    [V.preview]: (input: VaultGrantMutation) =>
      auth.effect(V.preview, access.preview(input, actor)),
    [V.explain]: (input: VaultDecisionInput) => auth.effect(V.explain, inspector.explain(input)),
    [V.readiness]: (input: VaultReadinessInput) => auth.effect(V.readiness, readiness.check(input)),
  };
});
