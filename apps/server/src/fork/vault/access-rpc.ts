import {
  VAULT_ACCESS_WS_METHODS as V,
  VaultError,
  type VaultApprovalCreate,
  type VaultApprovalChange,
  type VaultGrantMutation,
  type VaultDecisionInput,
  type VaultReadinessInput,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultAccess from "./VaultAccess.ts";
export const makeVaultAccessRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const access = yield* VaultAccess.VaultAccess;
    return {
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
      [V.apply]: (input: VaultGrantMutation) => auth.effect(V.apply, access.apply(input, actor)),
      [V.preview]: (input: VaultGrantMutation) =>
        auth.effect(V.preview, access.preview(input, actor)),
      [V.explain]: (input: VaultDecisionInput) => auth.effect(V.explain, access.explain(input)),
      [V.readiness]: (input: VaultReadinessInput) =>
        auth.effect(V.readiness, access.readiness(input)),
    };
  });
