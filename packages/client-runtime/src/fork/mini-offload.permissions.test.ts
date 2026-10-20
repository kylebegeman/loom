import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthEnvironmentMaintainScope,
  AuthOrchestrationReadScope,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { MINI_OFFLOAD_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createMiniOffloadAtoms } from "./mini-offload.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const destination = EnvironmentId.make("mini-host");
const other = EnvironmentId.make("other-host");
const grant = (maintain: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: maintain ? [AuthEnvironmentMaintainScope] : [AuthOrchestrationReadScope],
  permissions: maintain ? [AuthEnvironmentMaintainScope] : [AuthOrchestrationReadScope],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each(["register", "setEnabled", "updateWorker", "removeWorker"] as const)(
  "Mini worker %s requires its destination's environment:maintain grant and observes revocation",
  (method) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        registry.mount(sessions(destination));
        registry.mount(sessions(other));
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const command = createMiniOffloadAtoms(runtime)[method];
        const policy = createCommandPermissions(runtime, MINI_OFFLOAD_WS_METHODS[method]);
        registry.mount(command.permissionAtom(destination));
        expect(policy.requiredScopes()).toEqual([AuthEnvironmentMaintainScope]);

        registry.set(sessions(destination), AsyncResult.success(grant(false)));
        registry.set(sessions(other), AsyncResult.success(grant(true)));
        expect(registry.get(command.permissionAtom(destination))).toBe(false);
        expect(registry.get(command.permissionAtom(other))).toBe(true);
        expect(yield* policy.authorize(registry, destination).pipe(Effect.flip)).toMatchObject({
          requiredPermission: AuthEnvironmentMaintainScope,
        });

        registry.set(sessions(destination), AsyncResult.success(grant(true)));
        registry.set(sessions(other), AsyncResult.success(grant(false)));
        expect(registry.get(command.permissionAtom(destination))).toBe(true);
        yield* policy.authorize(registry, destination);
        expect(registry.get(command.permissionAtom(other))).toBe(false);

        registry.set(sessions(destination), AsyncResult.success(grant(false)));
        expect(registry.get(command.permissionAtom(destination))).toBe(false);
        expect(yield* policy.authorize(registry, destination).pipe(Effect.flip)).toMatchObject({
          requiredPermission: AuthEnvironmentMaintainScope,
        });
      }),
    ),
);
