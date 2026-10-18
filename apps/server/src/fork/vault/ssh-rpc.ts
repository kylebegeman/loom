import {
  VAULT_SSH_WS_METHODS as V,
  VaultError,
  type VaultSshGenerate,
  type VaultSshTrust,
  type VaultSshProbe,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultSsh from "./VaultSsh.ts";
export const makeVaultSshRpcHandlers = (auth: ForkRpcAuth, actor: string) =>
  Effect.gen(function* () {
    const service = yield* VaultSsh.VaultSsh;
    const authorize = (method: typeof V.generate | typeof V.trust | typeof V.probe) =>
      Effect.suspend(() => auth.effect(method, Effect.void)).pipe(
        Effect.mapError(() => new VaultError({ reason: "denied" })),
      );
    return {
      [V.info]: (input: { id: string }) => auth.effect(V.info, service.info(input.id)),
      [V.generate]: (input: VaultSshGenerate) =>
        auth.effect(V.generate, service.generate(input, actor, authorize(V.generate))),
      [V.trust]: (input: VaultSshTrust) =>
        auth.effect(V.trust, service.trust(input, actor, authorize(V.trust))),
      [V.probe]: (input: VaultSshProbe) =>
        auth.effect(V.probe, service.probe(input, authorize(V.probe))),
    };
  });
