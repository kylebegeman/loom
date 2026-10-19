import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationReadScope,
  AuthPreviewOperateScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthEnvironmentScope,
  type AuthSessionState,
} from "@t3tools/contracts";
import { PREVIEW_LINKS_WS_METHODS } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "../state/commandPermissions.ts";
import { createPreviewLinksAtoms } from "./preview-links.ts";

vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, never>>(AsyncResult.initial()),
);
const host = EnvironmentId.make("preview-host");
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
  ["configure", AuthSettingsWriteScope],
  ["share", AuthPreviewOperateScope],
  ["open", AuthPreviewOperateScope],
  ["extend", AuthPreviewOperateScope],
  ["revoke", AuthPreviewOperateScope],
  ["restore", AuthPreviewOperateScope],
  ["revokeAll", AuthPreviewOperateScope],
  ["signOutBrowsers", AuthPreviewOperateScope],
] as const;

it.effect.each(cases)("preview links %s requires %s on the serving computer", ([method, scope]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = AtomRegistry.make();
      registry.mount(sessions(host));
      yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
      const command = createPreviewLinksAtoms(runtime)[method];
      const policy = createCommandPermissions(runtime, PREVIEW_LINKS_WS_METHODS[method]);
      registry.mount(command.permissionAtom(host));
      expect(policy.requiredScopes()).toEqual([scope]);

      registry.set(sessions(host), AsyncResult.success(grant([AuthOrchestrationReadScope])));
      expect(registry.get(command.permissionAtom(host))).toBe(false);

      registry.set(sessions(host), AsyncResult.success(grant([AuthOrchestrationReadScope, scope])));
      expect(registry.get(command.permissionAtom(host))).toBe(true);
      yield* policy.authorize(registry, host);
    }),
  ),
);
