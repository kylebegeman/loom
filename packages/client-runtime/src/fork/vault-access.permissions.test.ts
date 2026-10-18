import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { VAULT_ACCESS_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createVaultAccessAtoms } from "./vault-access.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const destination = EnvironmentId.make("vault-destination");
const other = EnvironmentId.make("other-host");
const grant = (write: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: write ? [AuthAccessWriteScope] : [AuthAccessReadScope],
  permissions: write ? [AuthAccessWriteScope] : [AuthAccessReadScope],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each(["apply"] as const)(
  "Vault %s requires its destination's access:write grant and observes revocation",
  (method) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        registry.mount(sessions(destination));
        registry.mount(sessions(other));
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const command = createVaultAccessAtoms(runtime)[method];
        const policy = createCommandPermissions(runtime, VAULT_ACCESS_WS_METHODS[method]);
        registry.mount(command.permissionAtom(destination));
        expect(policy.requiredScopes()).toEqual([AuthAccessWriteScope]);

        registry.set(sessions(destination), AsyncResult.success(grant(false)));
        registry.set(sessions(other), AsyncResult.success(grant(true)));
        expect(registry.get(command.permissionAtom(destination))).toBe(false);
        expect(registry.get(command.permissionAtom(other))).toBe(true);
        expect(yield* policy.authorize(registry, destination).pipe(Effect.flip)).toMatchObject({
          requiredPermission: AuthAccessWriteScope,
        });

        registry.set(sessions(destination), AsyncResult.success(grant(true)));
        registry.set(sessions(other), AsyncResult.success(grant(false)));
        expect(registry.get(command.permissionAtom(destination))).toBe(true);
        yield* policy.authorize(registry, destination);
        expect(registry.get(command.permissionAtom(other))).toBe(false);

        registry.set(sessions(destination), AsyncResult.success(grant(false)));
        expect(registry.get(command.permissionAtom(destination))).toBe(false);
        expect(yield* policy.authorize(registry, destination).pipe(Effect.flip)).toMatchObject({
          requiredPermission: AuthAccessWriteScope,
        });
      }),
    ),
);
