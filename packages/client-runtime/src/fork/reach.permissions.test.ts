import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthRelayWriteScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { REACH_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createReachAtoms } from "./reach.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("reach-destination");
const grant = (scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: [...scopes],
  permissions: [...scopes],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

const cases = [
  ["applyIdentity", "applyIdentity", AuthSettingsWriteScope],
  ["prepareIdentity", "prepareIdentity", AuthSettingsWriteScope],
  ["set", "set", AuthRelayWriteScope],
  ["remove", "remove", AuthRelayWriteScope],
  ["forget", "forget", AuthRelayWriteScope],
  ["libraryRetire", "libraryRetire", AuthSettingsWriteScope],
] as const;

it.effect.each(cases)("reach %s (%s) requires %s on its destination", ([atom, method, scope]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      registry.mount(sessions(env));
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const command = createReachAtoms(runtime)[atom];
      const policy = createCommandPermissions(runtime, REACH_WS_METHODS[method]);
      registry.mount(command.permissionAtom(env));
      expect(policy.requiredScopes()).toEqual([scope]);

      registry.set(sessions(env), AsyncResult.success(grant([AuthOrchestrationReadScope])));
      expect(registry.get(command.permissionAtom(env))).toBe(false);
      const denied = yield* policy.authorize(registry, env).pipe(Effect.flip);
      expect(denied.requiredPermission).toBe(scope);

      registry.set(sessions(env), AsyncResult.success(grant([AuthOrchestrationReadScope, scope])));
      expect(registry.get(command.permissionAtom(env))).toBe(true);
      yield* policy.authorize(registry, env);
      expect(registry.get(command.permissionAtom(EnvironmentId.make("other-host")))).toBe(false);
    }),
  ),
);

it("reads reach status and the Library's list without a guard", () => {
  for (const method of [REACH_WS_METHODS.watch, REACH_WS_METHODS.libraryList]) {
    expect(createCommandPermissions(runtime, method).requiredScopes()).toEqual([]);
  }
});
