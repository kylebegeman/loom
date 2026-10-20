import {
  VAULT_GITHUB_WS_METHODS as G,
  VaultError,
  type VaultGitHubSave,
  type VaultGitHubTarget,
  type VaultGitHubReadinessInput,
  type VaultItemChange,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultGitHub from "./VaultGitHub.ts";
export const makeVaultGitHubRpcHandlers = Effect.fn("VaultGitHub.makeRpcHandlers")(function* (
  auth: ForkRpcAuth,
  actor: string,
) {
  const service = yield* VaultGitHub.VaultGitHub;
  const authorize = (
    method: typeof G.save | typeof G.test | typeof G.change | typeof G.readiness,
  ) =>
    Effect.suspend(() => auth.effect(method, Effect.void)).pipe(
      Effect.mapError(() => new VaultError({ reason: "denied" })),
    );
  return {
    [G.readiness]: (input: VaultGitHubReadinessInput) =>
      auth.effect(G.readiness, service.readiness(input, authorize(G.readiness))),
    [G.info]: (input: { id: string }) => auth.effect(G.info, service.info(input.id)),
    [G.list]: (input: { cursor: string | null }) => auth.effect(G.list, service.list(input.cursor)),
    [G.save]: (input: VaultGitHubSave) =>
      auth.effect(G.save, service.save(input, actor, authorize(G.save))),
    [G.test]: (input: VaultGitHubTarget) =>
      auth.effect(G.test, service.test(input, authorize(G.test))),
    [G.change]: (input: VaultItemChange) =>
      auth.effect(G.change, service.change(input, actor, authorize(G.change))),
  };
});
