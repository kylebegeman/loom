import {
  VAULT_PROFILE_WS_METHODS as P,
  VAULT_REFERENCE_WS_METHODS as R,
  VaultError,
  type VaultProfileMutation,
  type VaultProfilePreviewInput,
  type VaultReferenceSearch,
} from "@t3tools/contracts/fork";
import type { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultReferences from "./VaultReferences.ts";
export const makeVaultProfileRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const profiles = yield* VaultProfiles.VaultProfiles;
    return {
      [P.list]: (input: { projectId: ProjectId }) =>
        auth.effect(P.list, profiles.list(input.projectId)),
      [P.preview]: (input: VaultProfilePreviewInput) =>
        auth.effect(P.preview, profiles.preview(input)),
      [P.apply]: (input: VaultProfileMutation) =>
        auth.effect(
          P.apply,
          profiles.apply(
            input,
            actor,
            Effect.suspend(() => auth.effect(P.apply, Effect.void)).pipe(
              Effect.mapError(() => new VaultError({ reason: "denied" })),
            ),
          ),
        ),
    };
  });
export const makeVaultReferenceRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const references = yield* VaultReferences.VaultReferences;
    return {
      [R.search]: (input: VaultReferenceSearch) => auth.effect(R.search, references.search(input)),
      [R.describe]: (input: { id: string }) =>
        auth.effect(R.describe, references.describe(input.id)),
    };
  });
