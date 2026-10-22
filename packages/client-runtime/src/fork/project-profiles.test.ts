import { expect, it } from "@effect/vitest";
import {
  AuthTerminalOperateScope,
  EnvironmentId,
  ProjectId,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import { PROJECT_PROFILES_WS_METHODS as PP } from "@t3tools/contracts/fork";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { vi } from "vite-plus/test";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createProjectProfilesAtoms } from "./project-profiles.ts";
vi.mock("../state/session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);
const grant = (allowed: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  scopes: allowed ? [AuthTerminalOperateScope] : [],
  permissions: allowed ? [AuthTerminalOperateScope] : [],
});
it.effect(
  "checks the destination's current terminal grant before validation or command preparation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls: unknown[] = [];
        const supervisor = {
          target: { environmentId: EnvironmentId.make("target"), label: "Target" },
          session: yield* SubscriptionRef.make(
            Option.some({
              client: {
                [PP.varlockValidate]: () =>
                  Effect.sync(() => {
                    calls.push("validate");
                    return { ok: true, rootErrors: [], itemErrors: {}, durationMs: 1 };
                  }),
                [PP.varlockCommand]: () =>
                  Effect.sync(() => {
                    calls.push("command");
                    return { commandLine: "vp test", cwd: "/checkout" };
                  }),
              },
            } as unknown as RpcSession),
          ),
        } as unknown as EnvironmentSupervisor["Service"];
        const runtime = Atom.runtime(
          Layer.succeed(EnvironmentRegistry, {
            run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
          } as EnvironmentRegistry["Service"]),
        );
        const commands = createProjectProfilesAtoms(runtime);
        const registry = AtomRegistry.make();
        yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
        const target = EnvironmentId.make("target");
        const other = EnvironmentId.make("other");
        registry.mount(sessions(target));
        registry.mount(sessions(other));
        registry.set(sessions(target), AsyncResult.success(grant(true)));
        registry.set(sessions(other), AsyncResult.success(grant(true)));
        expect(registry.get(commands.validate.permissionAtom(target))).toBe(true);
        expect(registry.get(commands.command.permissionAtom(target))).toBe(true);
        registry.set(sessions(target), AsyncResult.success(grant(false)));
        expect(registry.get(commands.validate.permissionAtom(target))).toBe(false);
        expect(registry.get(commands.command.permissionAtom(other))).toBe(true);
        const projectId = ProjectId.make("project");
        const denied = [
          yield* Effect.promise(() =>
            commands.validate.run(registry, { environmentId: target, input: { projectId } }),
          ),
          yield* Effect.promise(() =>
            commands.command.run(registry, {
              environmentId: target,
              input: { projectId, target: { intent: "test" } },
            }),
          ),
        ];
        for (const exit of denied) {
          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure")
            expect(Cause.squash(exit.cause)).toMatchObject({
              requiredScope: AuthTerminalOperateScope,
            });
        }
        expect(calls).toEqual([]);
      }),
    ),
);
