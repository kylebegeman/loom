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
      applyBatch: () => work,
      previewBatch: () => work,
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
    expect(
      yield* handlers[V.applyBatch]({
        operationId: input.operationId,
        expectedRevision: 0,
        changes: [input.change],
      }).pipe(Effect.flip),
    ).toMatchObject({ requiredScope: AuthAccessWriteScope });
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
    expect(
      (yield* handlers[V.previewBatch]({
        operationId: input.operationId,
        expectedRevision: 0,
        changes: [input.change],
      }).pipe(Effect.flip))._tag,
    ).toBe("VaultError");
    expect(invoked).toBe(4);
  }),
);

it.effect(
  "rejects batch previews without read scope and agent policy writes before service work",
  () =>
    Effect.gen(function* () {
      let invoked = 0;
      const work = Effect.sync(() => {
        invoked++;
      }).pipe(Effect.andThen(Effect.fail(new VaultError({ reason: "unavailable" }))));
      const layers = Layer.mergeAll(
        Layer.mock(VaultAccess)({
          apply: () => work,
          applyBatch: () => work,
          previewBatch: () => work,
        }),
        Layer.mock(VaultReadiness)({ check: () => work }),
        Layer.mock(VaultAccessInspector)({ explain: () => work }),
      );
      const input = {
        operationId: "a".repeat(32),
        expectedRevision: 0,
        changes: [{ type: "state" as const, id: "b".repeat(32), state: "revoked" as const }],
      };
      for (const actor of ["thread:agent", "mcp-client"]) {
        const handlers = yield* makeVaultAccessRpcHandlers(
          makeForkRpcAuth({
            sessionId: AuthSessionId.make("agent"),
            subject: actor,
            method: "bearer-access-token",
            scopes: [AuthAccessWriteScope],
          }),
          actor,
        ).pipe(Effect.provide(layers));
        expect(yield* handlers[V.applyBatch](input).pipe(Effect.flip)).toMatchObject({
          reason: "denied",
        });
        expect(
          yield* handlers[V.apply]({ ...input, change: input.changes[0]! }).pipe(Effect.flip),
        ).toMatchObject({ reason: "denied" });
        expect(yield* handlers[V.previewBatch](input).pipe(Effect.flip)).toMatchObject({
          requiredScope: AuthAccessReadScope,
        });
      }
      expect(invoked).toBe(0);
    }),
);
it.effect("rechecks live write authorization through the batch service callback", () =>
  Effect.gen(function* () {
    const scopes = [AuthAccessWriteScope];
    let checks = 0;
    const handlers = yield* makeVaultAccessRpcHandlers(
      makeForkRpcAuth({
        sessionId: AuthSessionId.make("human"),
        subject: "human",
        method: "bearer-access-token",
        scopes,
      }),
      "human",
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(VaultAccess)({
            applyBatch: (_input, _actor, authorize) =>
              Effect.gen(function* () {
                yield* authorize!;
                checks++;
                scopes.length = 0;
                yield* authorize!;
                checks++;
                return yield* new VaultError({ reason: "unavailable" });
              }),
          }),
          Layer.mock(VaultReadiness)({}),
          Layer.mock(VaultAccessInspector)({}),
        ),
      ),
    );
    expect(
      yield* handlers[V.applyBatch]({
        operationId: "a".repeat(32),
        expectedRevision: 0,
        changes: [{ type: "state", id: "b".repeat(32), state: "revoked" }],
      }).pipe(Effect.flip),
    ).toMatchObject({ reason: "denied" });
    expect(checks).toBe(1);
  }),
);
