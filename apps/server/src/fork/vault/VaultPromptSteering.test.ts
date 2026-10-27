import { expect, it } from "@effect/vitest";
import {
  MessageId,
  ProviderSessionId,
  ProviderThreadId,
  ProviderTurnId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Control from "../../orchestration-v2/ProviderTurnControlService.ts";
import * as Projections from "../../orchestration-v2/ProjectionStore.ts";
import * as Sessions from "../../orchestration-v2/ProviderSessionManager.ts";
it.effect(
  "rejects unavailable Vault requirements before steering, while ordinary messages still reach the active provider",
  () =>
    Effect.gen(function* () {
      const input = {
        threadId: ThreadId.make("thread"),
        providerSessionId: ProviderSessionId.make("session"),
        providerThreadId: ProviderThreadId.make("provider"),
        providerTurnId: ProviderTurnId.make("turn"),
        messageId: MessageId.make("message"),
      };
      let text =
          "[Vault reference: Synthetic](loom-vault:unconfigured:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)",
        calls = 0;
      const session = {
        steerTurn: () =>
          Effect.sync(() => {
            calls++;
          }),
      } as unknown as ProviderAdapter.ProviderAdapterV2SessionRuntime;
      type SteeringContext = Effect.Success<
        ReturnType<Projections.ProjectionStoreV2["Service"]["getProviderControlContext"]>
      >;
      const layer = Control.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Sessions.ProviderSessionManagerV2)({
              get: () => Effect.succeedSome(session),
            }),
            Layer.mock(Projections.ProjectionStoreV2)({
              getProviderControlContext: () =>
                Effect.sync(
                  () =>
                    ({
                      providerThread: {
                        id: input.providerThreadId,
                        providerSessionId: input.providerSessionId,
                      },
                      providerTurn: {
                        id: input.providerTurnId,
                        providerThreadId: input.providerThreadId,
                        status: "running",
                      },
                      message: { id: input.messageId, text, attachments: [] },
                      run: { id: RunId.make("active-run") },
                    }) as unknown as SteeringContext,
                ),
            }),
          ),
        ),
      );
      const control = yield* Control.ProviderTurnControlServiceV2.pipe(Effect.provide(layer));
      const error = yield* control.steer(input).pipe(Effect.flip);
      expect(error.operation).toBe("steer");
      expect(error.cause).toMatchObject({ _tag: "VaultPromptError", reason: "unavailable" });
      expect(calls).toBe(0);
      text = "Keep working on the existing task";
      yield* control.steer(input);
      expect(calls).toBe(1);
    }),
);
