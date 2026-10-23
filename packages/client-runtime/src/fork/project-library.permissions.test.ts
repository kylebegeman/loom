import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthTerminalOperateScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthSessionState,
} from "@t3tools/contracts";
import { LIBRARY_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createProjectLibraryAtoms } from "./project-library.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const destination = EnvironmentId.make("copy-computer");
const other = EnvironmentId.make("other-host");
const grant = (
  write: boolean,
  scope:
    | typeof AuthTerminalOperateScope
    | typeof AuthOrchestrationOperateScope
    | typeof AuthSettingsWriteScope,
): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: write ? [scope] : [AuthOrchestrationReadScope],
  permissions: write ? [scope] : [AuthOrchestrationReadScope],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);

it.effect.each([
  "setCopyRetention",
  "reopenCopy",
  "snapshotCopy",
  "authorizeRecovery",
  "restoreCopy",
] as const)("Project files %s requires the copy computer grant and observes revocation", (method) =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      registry.mount(sessions(destination));
      registry.mount(sessions(other));
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const scope =
        method === "setCopyRetention" || method === "authorizeRecovery"
          ? AuthOrchestrationOperateScope
          : AuthTerminalOperateScope;
      const command = createProjectLibraryAtoms(runtime)[method];
      const policy = createCommandPermissions(runtime, LIBRARY_WS_METHODS[method]);
      registry.mount(command.permissionAtom(destination));
      expect(policy.requiredScopes()).toEqual([scope]);

      registry.set(sessions(destination), AsyncResult.success(grant(false, scope)));
      registry.set(sessions(other), AsyncResult.success(grant(true, scope)));
      expect(registry.get(command.permissionAtom(destination))).toBe(false);
      expect(registry.get(command.permissionAtom(other))).toBe(true);
      expect(yield* policy.authorize(registry, destination).pipe(Effect.flip)).toMatchObject({
        requiredPermission: scope,
      });

      registry.set(sessions(destination), AsyncResult.success(grant(true, scope)));
      registry.set(sessions(other), AsyncResult.success(grant(false, scope)));
      expect(registry.get(command.permissionAtom(destination))).toBe(true);
      yield* policy.authorize(registry, destination);
      expect(registry.get(command.permissionAtom(other))).toBe(false);

      registry.set(sessions(destination), AsyncResult.success(grant(false, scope)));
      expect(registry.get(command.permissionAtom(destination))).toBe(false);
      expect(yield* policy.authorize(registry, destination).pipe(Effect.flip)).toMatchObject({
        requiredPermission: scope,
      });
    }),
  ),
);

it.effect.each([
  "saveWorkstream",
  "applyBlueprint",
  "runOperation",
  "executeOperation",
  "resumeOperation",
  "cancelOperation",
] as const)("Project workflows %s uses destination permissions and observes revocation", (method) =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const command = createProjectLibraryAtoms(runtime)[method];
      registry.mount(command.permissionAtom(destination));
      registry.mount(command.permissionAtom(other));
      const scope =
        method === "saveWorkstream" || method === "applyBlueprint"
          ? AuthSettingsWriteScope
          : AuthTerminalOperateScope;
      registry.set(sessions(destination), AsyncResult.success(grant(false, scope)));
      registry.set(sessions(other), AsyncResult.success(grant(true, scope)));
      expect(registry.get(command.permissionAtom(destination))).toBe(false);
      expect(registry.get(command.permissionAtom(other))).toBe(true);
      registry.set(sessions(destination), AsyncResult.success(grant(true, scope)));
      expect(registry.get(command.permissionAtom(destination))).toBe(true);
      registry.set(sessions(destination), AsyncResult.success(grant(false, scope)));
      expect(registry.get(command.permissionAtom(destination))).toBe(false);
    }),
  ),
);
