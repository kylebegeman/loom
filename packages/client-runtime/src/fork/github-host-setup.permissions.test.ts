import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { GITHUB_HOST_SETUP_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createGitHubHostSetupAtoms } from "./github-host-setup.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("github-setup-destination");
const grant = (terminal: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: terminal ? [AuthTerminalOperateScope] : [AuthOrchestrationReadScope],
  permissions: terminal ? [AuthTerminalOperateScope] : [AuthOrchestrationReadScope],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each(["start", "cancel"] as const)(
  "GitHub setup %s availability and authorization use its destination grant",
  (method) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        registry.mount(sessions(env));
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const command = createGitHubHostSetupAtoms(runtime)[method];
        const policy = createCommandPermissions(runtime, GITHUB_HOST_SETUP_WS_METHODS[method]);
        const scope = AuthTerminalOperateScope;
        expect(policy.requiredScopes()).toEqual([scope]);
        registry.set(sessions(env), AsyncResult.success(grant(false)));
        expect(registry.get(command.permissionAtom(env))).toBe(false);
        const denied = yield* policy.authorize(registry, env).pipe(Effect.flip);
        expect(denied.requiredScope).toBe(scope);
        registry.set(sessions(env), AsyncResult.success(grant(true)));
        expect(registry.get(command.permissionAtom(env))).toBe(true);
        yield* policy.authorize(registry, env);
        expect(registry.get(command.permissionAtom(EnvironmentId.make("other-host")))).toBe(false);
      }),
    ),
);
