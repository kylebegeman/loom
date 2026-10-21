import { expect, it } from "@effect/vitest";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthSessionId,
  type AuthEnvironmentScope,
  type EnvironmentAuthorizationError,
} from "@t3tools/contracts";
import { VAULT_CORE_WS_METHODS as V, VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { VaultCore } from "./VaultCore.ts";
import { VaultAccess } from "./VaultAccess.ts";
import { makeVaultCoreRpcHandlers } from "./rpc.ts";

it.effect("keeps metadata readable while denying reveal and mutations before backend work", () =>
  Effect.gen(function* () {
    let invoked = 0;
    const work = Effect.sync(() => {
      invoked++;
    }).pipe(Effect.andThen(Effect.fail(new VaultError({ reason: "unavailable" }))));
    const service = Layer.merge(
      Layer.mock(VaultCore)({
        status: Effect.succeed({
          backend: "openbao",
          state: "ready",
          origin: "https://vault.example.test",
        }),
        list: () => work,
        save: () => work,
        change: () => work,
        reveal: () => work,
      }),
      Layer.mock(VaultAccess)({ reveal: () => work }),
    );
    const handlers = (scopes: readonly AuthEnvironmentScope[]) =>
      makeVaultCoreRpcHandlers(
        makeForkRpcAuth({
          sessionId: AuthSessionId.make("vault-rpc"),
          subject: "human",
          method: "bearer-access-token",
          scopes,
        }),
        "human",
      ).pipe(Effect.provide(service));
    const reader = yield* handlers([AuthAccessReadScope]);
    const id = "a".repeat(32);
    const requests: readonly Effect.Effect<unknown, EnvironmentAuthorizationError | VaultError>[] =
      [
        reader[V.save]({
          id,
          operationId: id,
          expectedVersion: 0,
          label: "Token",
          kind: "secret",
          value: Redacted.make("private"),
        }),
        reader[V.change]({ id, operationId: id, expectedVersion: 1, action: "delete" }),
        reader[V.reveal]({ id, expectedVersion: 1 }),
      ];
    for (const request of requests)
      expect((yield* request.pipe(Effect.asVoid, Effect.flip))._tag).toBe(
        "EnvironmentAuthorizationError",
      );
    expect(invoked).toBe(0);
    expect(
      (yield* reader[V.list]({ cursor: null, includeArchived: false }).pipe(Effect.flip))._tag,
    ).toBe("VaultError");
    const writer = yield* handlers([AuthAccessWriteScope]);
    expect((yield* writer[V.reveal]({ id, expectedVersion: 1 }).pipe(Effect.flip))._tag).toBe(
      "VaultError",
    );
    expect(invoked).toBe(2);
  }),
);
