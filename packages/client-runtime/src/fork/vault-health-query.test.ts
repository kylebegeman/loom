import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, RunId, ThreadId } from "@t3tools/contracts";
import {
  VaultError,
  VAULT_HEALTH_WS_METHODS,
  type VaultHealthRetainedInput,
  type VaultHealthRetainedPage,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createVaultHealthAtoms } from "./vault-health.ts";

it.effect.each(["unavailable", "invalid-response"] as const)(
  "refreshes the same retained-history page after %s without converting it to empty success",
  (reason) =>
    Effect.scoped(
      Effect.gen(function* () {
        const environmentId = EnvironmentId.make("history-recovery"),
          projectId = ProjectId.make("history-project");
        const page: VaultHealthRetainedPage = {
          itemId: "a".repeat(32),
          projectId,
          checkedAt: 1,
          inspectedSelections: 1,
          unattributableSelections: 0,
          nextCursor: null,
          coverage: {
            scope: "retained-page",
            externalConsumers: "not-discovered",
            providerCopies: "unknown",
            authorization: "not-evaluated",
          },
          items: [
            {
              id: "b".repeat(64),
              threadId: ThreadId.make("stopped-thread"),
              runId: RunId.make("stopped-run"),
              version: 1,
              runState: "completed",
              canRetire: true,
              profileId: "c".repeat(32),
              profileLabel: "Previous staging",
              profileVersion: 3,
              bindings: [{ name: "checkout", itemVersion: 4 }],
            },
          ],
        };
        let failed = false;
        const calls: VaultHealthRetainedInput[] = [];
        const session = {
          client: {
            [VAULT_HEALTH_WS_METHODS.retained]: (input: VaultHealthRetainedInput) =>
              Effect.suspend(() => {
                calls.push(input);
                return failed
                  ? Effect.fail(new VaultError({ reason }))
                  : Effect.succeed({ ...page, checkedAt: calls.length });
              }),
          },
        } as unknown as RpcSession;
        const supervisor = {
          target: { environmentId, label: "History recovery" },
          state: yield* SubscriptionRef.make({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
          session: yield* SubscriptionRef.make(Option.some(session)),
        } as EnvironmentSupervisor["Service"];
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry, {
            run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
            followStream: (_id, stream) =>
              Stream.provideService(stream, EnvironmentSupervisor, supervisor),
          } as EnvironmentRegistry["Service"]),
        );
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const input = { itemId: page.itemId, projectId, cursor: "d".repeat(64) };
        const atom = createVaultHealthAtoms(runtime).retained({ environmentId, input });
        registry.mount(atom);
        const first = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
        expect(first.items[0]?.bindings[0]?.itemVersion).toBe(4);
        failed = true;
        registry.refresh(atom);
        expect(
          yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true }).pipe(
            Effect.flip,
          ),
        ).toMatchObject({ reason });
        const failure = registry.get(atom);
        expect(failure._tag).toBe("Failure");
        expect(Option.getOrThrow(AsyncResult.value(failure)).items).toEqual(first.items);
        failed = false;
        registry.refresh(atom);
        const recovered = yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true });
        expect(recovered.items).toEqual(first.items);
        expect(recovered.coverage).toEqual(first.coverage);
        expect(recovered.checkedAt).toBeGreaterThan(first.checkedAt);
        expect(calls).toEqual([input, input, input]);
      }),
    ),
);
