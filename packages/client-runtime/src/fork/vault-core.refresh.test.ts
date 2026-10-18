import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { AuthAccessWriteScope, EnvironmentId, type AuthSessionState } from "@t3tools/contracts";
import { VAULT_CORE_WS_METHODS as V, type VaultItemSummary } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createVaultCoreAtoms } from "./vault-core.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: () => sessionState }),
}));
const sessionState = Atom.make(
  AsyncResult.success({
    authenticated: true,
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "test",
    },
    permissions: [AuthAccessWriteScope],
    scopes: [AuthAccessWriteScope],
  } satisfies AuthSessionState),
);

it.effect(
  "refreshes mounted archived and active pickers across factories after save and archive",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const environmentId = EnvironmentId.make("vault-list-refresh");
        let item: VaultItemSummary | null = null;
        const session = {
          client: {
            [V.list]: ({ includeArchived }: { includeArchived: boolean }) =>
              Effect.sync(() => ({
                items: item && (includeArchived || item.state === "active") ? [item] : [],
                nextCursor: null,
              })),
            [V.save]: () =>
              Effect.sync(() => {
                item = {
                  id: "a".repeat(32),
                  kind: "secret",
                  label: "Created after picker mounted",
                  state: "active",
                  version: 1,
                  createdAt: "2026-10-18T00:00:00Z",
                  updatedAt: "2026-10-18T00:00:00Z",
                };
                return item;
              }),
            [V.change]: () =>
              Effect.sync(() => {
                item = { ...item!, state: "archived", version: 2 };
                return item;
              }),
          },
        } as unknown as RpcSession;
        const supervisor = {
          target: { environmentId, label: "Vault test" },
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
        const editor = createVaultCoreAtoms(runtime),
          picker = createVaultCoreAtoms(runtime);
        const active = editor.list({
          environmentId,
          input: { includeArchived: false, cursor: null },
        });
        const archived = picker.list({
          environmentId,
          input: { includeArchived: true, cursor: null },
        });
        registry.mount(active);
        registry.mount(archived);
        expect(
          (yield* AtomRegistry.getResult(registry, active, { suspendOnWaiting: true })).items,
        ).toEqual([]);
        expect(
          (yield* AtomRegistry.getResult(registry, archived, { suspendOnWaiting: true })).items,
        ).toEqual([]);
        const saved = yield* Effect.promise(() =>
          editor.save.run(registry, {
            environmentId,
            input: {
              id: "a".repeat(32),
              operationId: "b".repeat(32),
              expectedVersion: 0,
              label: "New item",
              kind: "secret",
              value: Redacted.make("synthetic"),
            },
          }),
        );
        expect(saved._tag).toBe("Success");
        expect(
          (yield* AtomRegistry.getResult(registry, archived, { suspendOnWaiting: true })).items,
        ).toHaveLength(1);
        yield* Effect.promise(() =>
          editor.change.run(registry, {
            environmentId,
            input: {
              id: "a".repeat(32),
              operationId: "c".repeat(32),
              expectedVersion: 1,
              action: "archive",
            },
          }),
        );
        expect(
          (yield* AtomRegistry.getResult(registry, active, { suspendOnWaiting: true })).items,
        ).toEqual([]);
        expect(
          (yield* AtomRegistry.getResult(registry, archived, { suspendOnWaiting: true })).items[0]
            ?.state,
        ).toBe("archived");
      }),
    ),
);
