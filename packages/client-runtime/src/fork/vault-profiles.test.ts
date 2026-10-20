import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthAccessWriteScope,
  ProjectId,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { VAULT_PROFILE_WS_METHODS as P } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createVaultProfileAtoms } from "./vault-profiles.ts";

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

it.effect("refreshes profile lists across factories and denies writes after permission loss", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("profiles-refresh"),
        projectId = ProjectId.make("project");
      let revision = 0,
        calls = 0;
      const snapshot = () => ({ projectId, revision, activeProfileId: null, profiles: [] });
      const session = {
        client: {
          [P.list]: () => Effect.sync(snapshot),
          [P.apply]: () =>
            Effect.sync(() => {
              calls++;
              revision++;
              return snapshot();
            }),
        },
      } as unknown as RpcSession;
      const supervisor = {
        target: { environmentId, label: "test" },
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
      const editor = createVaultProfileAtoms(runtime),
        other = createVaultProfileAtoms(runtime),
        list = other.list({ environmentId, input: { projectId } });
      registry.mount(list);
      expect(
        (yield* AtomRegistry.getResult(registry, list, { suspendOnWaiting: true })).revision,
      ).toBe(0);
      const input = {
        environmentId,
        input: {
          projectId,
          operationId: "a".repeat(32),
          expectedRevision: 0,
          change: { type: "activate" as const, id: null },
        },
      };
      expect((yield* Effect.promise(() => editor.apply.run(registry, input)))._tag).toBe("Success");
      expect(
        (yield* AtomRegistry.getResult(registry, list, { suspendOnWaiting: true })).revision,
      ).toBe(1);
      const current = registry.get(sessionState);
      expect(current._tag).toBe("Success");
      if (current._tag !== "Success") return;
      registry.set(
        sessionState,
        AsyncResult.success({ ...current.value, permissions: [], scopes: [] }),
      );
      expect(registry.get(editor.apply.permissionAtom(environmentId))).toBe(false);
      expect((yield* Effect.promise(() => editor.apply.run(registry, input)))._tag).toBe("Failure");
      expect(calls).toBe(1);
    }),
  ),
);
