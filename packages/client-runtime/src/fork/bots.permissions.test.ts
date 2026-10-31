import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthSessionState,
  type AuthEnvironmentScope,
} from "@t3tools/contracts";
import { BOTS_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createBotsAtoms } from "./bots.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("bots-destination");
const grant = (permission: AuthEnvironmentScope): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: [AuthOrchestrationReadScope],
  permissions: [permission],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each([
  { method: "setBadgePreferences", permission: AuthSettingsWriteScope },
  { method: "completionConfigure", permission: AuthSettingsWriteScope },
  { method: "completionSetEnabled", permission: AuthSettingsWriteScope },
  { method: "completionRemove", permission: AuthSettingsWriteScope },
  { method: "completionAcknowledge", permission: AuthOrchestrationOperateScope },
  { method: "setOperationMode", permission: AuthSettingsWriteScope },
  { method: "stopAll", permission: AuthOrchestrationOperateScope },
] as const)("bot %s uses the destination computer's grant", ({ method, permission }) =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      registry.mount(sessions(env));
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const command = createBotsAtoms(runtime)[method];
      const policy = createCommandPermissions(runtime, BOTS_WS_METHODS[method]);
      expect(policy.requiredScopes()).toEqual([permission]);
      registry.set(sessions(env), AsyncResult.success(grant(AuthOrchestrationReadScope)));
      expect(registry.get(command.permissionAtom(env))).toBe(false);
      expect(yield* policy.authorize(registry, env).pipe(Effect.flip)).toMatchObject({
        requiredPermission: permission,
      });
      registry.set(sessions(env), AsyncResult.success(grant(permission)));
      expect(registry.get(command.permissionAtom(env))).toBe(true);
      yield* policy.authorize(registry, env);
      expect(registry.get(command.permissionAtom(EnvironmentId.make("other-computer")))).toBe(
        false,
      );
    }),
  ),
);
