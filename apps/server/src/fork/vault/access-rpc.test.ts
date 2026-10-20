import { expect, it } from "@effect/vitest";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthSessionId,
  ThreadId,
} from "@t3tools/contracts";
import { VAULT_ACCESS_WS_METHODS as V, VaultError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeForkRpcAuth } from "../rpcAuthorization.ts";
import { VaultAccessInspector } from "./VaultAccessInspector.ts";
import { VaultReadiness } from "./VaultReadiness.ts";
import { VaultAccess } from "./VaultAccess.ts";
import { makeVaultAccessRpcHandlers } from "./access-rpc.ts";
it.effect("keeps access explanations readable and rejects policy writes before service work", () =>
  Effect.gen(function* () {
    let invoked = 0;
    const work = Effect.sync(() => {
      invoked++;
    }).pipe(Effect.andThen(Effect.fail(new VaultError({ reason: "unavailable" }))));
    const service = Layer.mock(VaultAccess)({
      snapshot: work,
      catalog: work,
      apply: () => work,
      preview: () => work,
      explain: () => work,
      readiness: () => work,
    });
    const handlers = yield* makeVaultAccessRpcHandlers(
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("access-reader"),
        subject: "human",
        method: "bearer-access-token",
        scopes: [AuthAccessReadScope],
      }),
      "human",
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          service,
          Layer.mock(VaultReadiness)({ check: () => work }),
          Layer.mock(VaultAccessInspector)({ explain: () => work }),
        ),
      ),
    );
    const input = {
      operationId: "a".repeat(32),
      expectedRevision: 0,
      change: { type: "state" as const, id: "b".repeat(32), state: "revoked" as const },
    };
    expect(yield* handlers[V.apply](input).pipe(Effect.flip)).toMatchObject({
      requiredScope: AuthAccessWriteScope,
    });
    expect(invoked).toBe(0);
    expect(
      (yield* handlers[V.explain]({
        threadId: ThreadId.make("thread"),
        itemId: "b".repeat(32),
        action: "use",
        destination: null,
      }).pipe(Effect.flip))._tag,
    ).toBe("VaultError");
    expect(
      (yield* handlers[V.readiness]({ threadId: ThreadId.make("thread"), requirements: [] }).pipe(
        Effect.flip,
      ))._tag,
    ).toBe("VaultError");
    expect((yield* handlers[V.preview](input).pipe(Effect.flip))._tag).toBe("VaultError");
    expect(invoked).toBe(3);
  }),
);
