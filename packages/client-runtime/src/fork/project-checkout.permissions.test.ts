import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { PROJECT_CHECKOUT_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createProjectCheckoutAtoms } from "./project-checkout.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const destination = EnvironmentId.make("checkout-destination");
const otherHost = EnvironmentId.make("other-computer");
const grant = (scopes: readonly AuthEnvironmentScope[]): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes,
  permissions: scopes,
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each(["adopt", "setRetention"] as const)(
  "checkout %s requires settings write on the selected computer",
  (method) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        registry.mount(sessions(destination));
        registry.mount(sessions(otherHost));
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const command = createProjectCheckoutAtoms(runtime)[method];
        const policy = createCommandPermissions(runtime, PROJECT_CHECKOUT_WS_METHODS[method]);
        expect(policy.requiredScopes()).toEqual([AuthSettingsWriteScope]);

        registry.set(
          sessions(destination),
          AsyncResult.success(grant([AuthOrchestrationReadScope])),
        );
        registry.set(sessions(otherHost), AsyncResult.success(grant([AuthSettingsWriteScope])));
        expect(registry.get(command.permissionAtom(destination))).toBe(false);
        const denied = yield* policy.authorize(registry, destination).pipe(Effect.flip);
        expect(denied.requiredPermission).toBe(AuthSettingsWriteScope);
        expect(denied.requiredScope).toBe("orchestration:operate");
        expect(registry.get(command.permissionAtom(otherHost))).toBe(true);

        registry.set(sessions(destination), AsyncResult.success(grant([AuthSettingsWriteScope])));
        registry.set(sessions(otherHost), AsyncResult.success(grant([AuthOrchestrationReadScope])));
        expect(registry.get(command.permissionAtom(destination))).toBe(true);
        yield* policy.authorize(registry, destination);
        expect(registry.get(command.permissionAtom(otherHost))).toBe(false);
        const otherDenied = yield* policy.authorize(registry, otherHost).pipe(Effect.flip);
        expect(otherDenied.requiredPermission).toBe(AuthSettingsWriteScope);

        registry.set(
          sessions(destination),
          AsyncResult.success(grant([AuthOrchestrationReadScope])),
        );
        expect(registry.get(command.permissionAtom(destination))).toBe(false);
        expect(
          (yield* policy.authorize(registry, destination).pipe(Effect.flip)).requiredPermission,
        ).toBe(AuthSettingsWriteScope);
      }),
    ),
);
