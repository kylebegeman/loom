import { expect, it } from "@effect/vitest";
import {
  type EnvironmentAuthorizationError,
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import {
  VAULT_SSH_WS_METHODS as V,
  VaultError,
  VaultSshError,
  VaultWorkloadError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import * as VaultSsh from "./VaultSsh.ts";
import { makeVaultSshRpcHandlers } from "./ssh-rpc.ts";
it.effect(
  "requires destination Vault write access for key/trust mutations and probes before backend work",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const work = Effect.sync(() => {
        calls++;
      }).pipe(Effect.andThen(Effect.fail(new VaultError({ reason: "unavailable" }))));
      const service = Layer.mock(VaultSsh.VaultSsh)({
        generate: () => work,
        info: () => work,
        trust: () => work,
        probe: () => work,
      });
      const handlers = (scopes: readonly AuthEnvironmentScope[]) =>
        makeVaultSshRpcHandlers(
          makeForkRpcAuth({
            sessionId: AuthSessionId.make("ssh-rpc"),
            subject: "human",
            method: "bearer-access-token",
            scopes,
          }),
          "human",
        ).pipe(Effect.provide(service));
      const reader = yield* handlers([AuthAccessReadScope]),
        id = "a".repeat(32);
      const operations: readonly Effect.Effect<
        unknown,
        EnvironmentAuthorizationError | VaultError | VaultSshError | VaultWorkloadError
      >[] = [
        reader[V.generate]({
          id,
          operationId: id,
          label: "SSH",
          target: { hostname: "example.test", username: "git", port: 22, hostKey: null },
        }),
        reader[V.trust]({ id, operationId: id, expectedVersion: 1, hostKey: null }),
        reader[V.probe]({ id, expectedVersion: 1 }),
      ];
      for (const operation of operations)
        expect(
          yield* operation.pipe(
            Effect.match({ onFailure: (error) => error._tag, onSuccess: () => null }),
          ),
        ).toBe("EnvironmentAuthorizationError");
      expect(calls).toBe(0);
      expect((yield* reader[V.info]({ id }).pipe(Effect.flip))._tag).toBe("VaultError");
      const writer = yield* handlers([AuthAccessWriteScope]);
      expect((yield* writer[V.probe]({ id, expectedVersion: 1 }).pipe(Effect.flip))._tag).toBe(
        "VaultError",
      );
      expect(calls).toBe(2);
    }).pipe(Effect.scoped),
);
