import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { LIBRARY_PUSH_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createLibraryPushAtoms } from "./library-push.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const library = EnvironmentId.make("push-library");
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

it.effect.each(["register", "unregister", "test"] as const)(
  "Library push %s requires settings:write on the Library",
  (method) =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = AtomRegistry.make();
        registry.mount(sessions(library));
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const command = createLibraryPushAtoms(runtime)[method];
        const policy = createCommandPermissions(runtime, LIBRARY_PUSH_WS_METHODS[method]);
        registry.mount(command.permissionAtom(library));
        expect(policy.requiredScopes()).toEqual([AuthSettingsWriteScope]);

        registry.set(sessions(library), AsyncResult.success(grant([AuthOrchestrationReadScope])));
        expect(registry.get(command.permissionAtom(library))).toBe(false);
        const denied = yield* policy.authorize(registry, library).pipe(Effect.flip);
        expect(denied.requiredPermission).toBe(AuthSettingsWriteScope);

        registry.set(
          sessions(library),
          AsyncResult.success(grant([AuthOrchestrationReadScope, AuthSettingsWriteScope])),
        );
        expect(registry.get(command.permissionAtom(library))).toBe(true);
        yield* policy.authorize(registry, library);
      }),
    ),
);

it("reads push status without a guard, and nothing while no Library is chosen", () => {
  expect(
    createCommandPermissions(runtime, LIBRARY_PUSH_WS_METHODS.status).requiredScopes(),
  ).toEqual([]);
  const registry = AtomRegistry.make();
  expect(registry.get(createLibraryPushAtoms(runtime).status(null))).toEqual(
    AsyncResult.initial(false),
  );
  registry.dispose();
});
