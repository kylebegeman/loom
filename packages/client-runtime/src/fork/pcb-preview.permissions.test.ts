import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { PCB_PREVIEW_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createPcbPreviewAtoms } from "./pcb-preview.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("pcb-print-destination");
const grant = (terminal: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: terminal ? [AuthTerminalOperateScope] : [AuthOrchestrationOperateScope],
  permissions: terminal ? [AuthTerminalOperateScope] : [AuthOrchestrationOperateScope],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each(["print", "updateProjectSettings"] as const)(
  "PCB %s availability and authorization use its destination terminal grant",
  (method) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        registry.mount(sessions(env));
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const command = createPcbPreviewAtoms(runtime)[method];
        const policy = createCommandPermissions(runtime, PCB_PREVIEW_WS_METHODS[method]);
        expect(policy.requiredScopes()).toEqual([AuthTerminalOperateScope]);
        registry.set(sessions(env), AsyncResult.success(grant(false)));
        expect(registry.get(command.permissionAtom(env))).toBe(false);
        const denied = yield* policy.authorize(registry, env).pipe(Effect.flip);
        expect(denied.requiredScope).toBe(AuthTerminalOperateScope);
        registry.set(sessions(env), AsyncResult.success(grant(true)));
        expect(registry.get(command.permissionAtom(env))).toBe(true);
        yield* policy.authorize(registry, env);
        expect(registry.get(command.permissionAtom(EnvironmentId.make("other-host")))).toBe(false);
      }),
    ),
);
