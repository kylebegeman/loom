import { FORK_CLIENT_GUARDED_RPC_SCOPES } from "@t3tools/contracts/fork";
import { requestGuarded, runStreamGuarded } from "../rpc/client.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { RpcSession } from "../rpc/session.ts";
import { describe, expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  AuthTerminalOperateScope, // fork: pcb-preview
  AuthSourceControlWriteScope,
  ThreadId,
  EnvironmentId,
  ScheduledTaskId,
  WS_METHODS,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import { AVAILABLE_CONNECTION_STATE } from "../connection/model.ts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { createCommandPermissions } from "./commandPermissions.ts";
import { createEnvironmentRpcCommand } from "./runtime.ts";

vi.mock("./session.ts", () => ({
  createEnvironmentSessionAtoms: () => ({ sessionStateAtom: sessions }),
}));
const sessions = Atom.family((_id: EnvironmentId) =>
  Atom.make<AsyncResult.AsyncResult<AuthSessionState, string>>(AsyncResult.initial()),
);
const env = EnvironmentId.make("target");
const other = EnvironmentId.make("other");
const grant = (allowed: boolean): AuthSessionState => ({
  authenticated: true,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: [],
    sessionMethods: [],
    sessionCookieName: "test",
  },
  // fork: pcb-preview
  scopes: allowed ? [AuthOrchestrationOperateScope, AuthTerminalOperateScope] : [],
  permissions: allowed ? [AuthOrchestrationOperateScope, AuthTerminalOperateScope] : [],
});
const runtime = Atom.runtime(
  Layer.succeed(EnvironmentRegistry, {
    run: (_id: EnvironmentId, effect: Effect.Effect<unknown>) => effect,
  } as unknown as EnvironmentRegistry["Service"]),
);
const permissions = createCommandPermissions(runtime, WS_METHODS.scheduledTasksDelete);
const setup = Effect.gen(function* () {
  const registry = AtomRegistry.make();
  registry.mount(sessions(env));
  yield* Effect.addFinalizer(() => Effect.sync(() => registry.dispose()));
  return registry;
});

describe("command permissions", () => {
  it.effect("guards every fork write with the destination environment's grant", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        // fork: pcb-preview
        for (const [method, scope] of Object.entries(FORK_CLIENT_GUARDED_RPC_SCOPES)) {
          const policy = createCommandPermissions(runtime, method);
          expect(policy.requiredScopes()).toEqual([scope]);
          registry.set(sessions(env), AsyncResult.success(grant(false)));
          expect(registry.get(policy.permissionAtom(env))).toBe(false);
          expect((yield* policy.authorize(registry, env).pipe(Effect.flip))._tag).toBe(
            "EnvironmentAuthorizationError",
          );
          registry.set(sessions(env), AsyncResult.success(grant(true)));
          yield* policy.authorize(registry, env);
          expect(registry.get(policy.permissionAtom(env))).toBe(true);
        }
      }),
    ),
  );

  it.effect("requires the destination settings grant to run storage cleanup", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        const cleanup = createCommandPermissions(runtime, WS_METHODS.serverRunStorageCleanup);
        registry.set(sessions(env), AsyncResult.success(grant(true)));
        expect(registry.get(cleanup.permissionAtom(env))).toBe(false);
        expect((yield* cleanup.authorize(registry, env).pipe(Effect.flip))._tag).toBe(
          "EnvironmentAuthorizationError",
        );
        registry.set(
          sessions(env),
          AsyncResult.success({
            ...grant(true),
            scopes: [AuthSettingsWriteScope],
            permissions: [AuthSettingsWriteScope],
          }),
        );
        expect(registry.get(cleanup.permissionAtom(env))).toBe(true);
        yield* cleanup.authorize(registry, env);
        registry.set(sessions(other), AsyncResult.success(grant(false)));
        expect(registry.get(cleanup.permissionAtom(other))).toBe(false);
      }),
    ),
  );

  it.effect("uses the target grant for both availability and execution", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        registry.set(sessions(env), AsyncResult.success(grant(true)));
        expect(registry.get(permissions.permissionAtom(env))).toBe(true);
        expect(permissions.permissionAtom(env)).toBe(permissions.permissionAtom(env));
        yield* permissions.authorize(registry, env);
        registry.set(sessions(other), AsyncResult.success(grant(false)));
        expect(registry.get(permissions.permissionAtom(other))).toBe(false);
        const denied = yield* permissions.authorize(registry, other).pipe(Effect.flip);
        expect(denied._tag).toBe("EnvironmentAuthorizationError");
      }),
    ),
  );
  it.effect("waits for an initial grant", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        const fiber = yield* permissions.authorize(registry, env).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        registry.set(sessions(env), AsyncResult.success(grant(true)));
        yield* Fiber.join(fiber);
      }),
    ),
  );
  it.effect("bounds a session that never loads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        const fiber = yield* permissions
          .authorize(registry, env)
          .pipe(Effect.flip, Effect.forkChild);
        yield* TestClock.adjust("6 seconds");
        expect((yield* Fiber.join(fiber))._tag).toBe("EnvironmentAuthorizationError");
      }),
    ),
  );
  it.effect(
    "denies failed and unauthenticated sessions, but accepts a cached refreshing grant",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const registry = yield* setup;
          registry.set(sessions(env), AsyncResult.failure(Cause.fail("offline")));
          expect((yield* permissions.authorize(registry, env).pipe(Effect.flip))._tag).toBe(
            "EnvironmentAuthorizationError",
          );
          registry.set(
            sessions(env),
            AsyncResult.success({ ...grant(true), authenticated: false }),
          );
          expect((yield* permissions.authorize(registry, env).pipe(Effect.flip))._tag).toBe(
            "EnvironmentAuthorizationError",
          );
          registry.set(sessions(env), AsyncResult.waiting(AsyncResult.success(grant(true))));
          yield* permissions.authorize(registry, env);
        }),
      ),
  );
  it("rechecks permission after waiting in a serial command lane", async () => {
    const registry = AtomRegistry.make();
    const unmount = registry.mount(sessions(env));
    registry.set(sessions(env), AsyncResult.success(grant(true)));
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const command = createEnvironmentRpcCommand(runtime, {
      label: "test.delete",
      tag: WS_METHODS.scheduledTasksDelete,
      concurrency: { mode: "serial", key: () => "target" },
      execute: () =>
        Effect.promise(async () => {
          calls++;
          started();
          await gate;
          return { id: ScheduledTaskId.make("task") };
        }),
    });
    const target = { environmentId: env, input: { id: ScheduledTaskId.make("task") } };
    try {
      const first = command.run(registry, target);
      await entered;
      const second = command.run(registry, target);
      registry.set(sessions(env), AsyncResult.success(grant(false)));
      release();
      expect((await first)._tag).toBe("Success");
      expect((await second)._tag).toBe("Failure");
      expect(calls).toBe(1);
    } finally {
      unmount();
      registry.dispose();
    }
  });
});

it.effect(
  "requires source control alone for git, and both grants when attaching a worktree to a thread",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* setup;
        registry.set(sessions(env), AsyncResult.success(grant(true)));
        const git = createCommandPermissions(runtime, WS_METHODS.vcsInit);
        expect((yield* git.authorize(registry, env).pipe(Effect.flip)).requiredPermission).toBe(
          AuthSourceControlWriteScope,
        );
        registry.set(
          sessions(env),
          AsyncResult.success({
            ...grant(false),
            scopes: [AuthSourceControlWriteScope],
            permissions: [AuthSourceControlWriteScope],
          }),
        );
        yield* git.authorize(registry, env);
        const prepare = createCommandPermissions(runtime, WS_METHODS.gitPreparePullRequestThread);
        const input = {
          cwd: "/repo",
          reference: "123",
          mode: "worktree",
          threadId: ThreadId.make("thread"),
        };
        expect(registry.get(prepare.permissionAtom(env, input))).toBe(false);
        expect(
          (yield* prepare.authorize(registry, env, input).pipe(Effect.flip)).requiredScope,
        ).toBe(AuthOrchestrationOperateScope);
        yield* prepare.authorize(registry, env, { ...input, threadId: undefined });
        registry.set(
          sessions(env),
          AsyncResult.success({
            ...grant(true),
            scopes: [AuthSourceControlWriteScope, AuthOrchestrationOperateScope],
            permissions: [AuthSourceControlWriteScope, AuthOrchestrationOperateScope],
          }),
        );
        expect(registry.get(prepare.permissionAtom(env, input))).toBe(true);
        yield* prepare.authorize(registry, env, input);
      }),
    ),
);

it.effect("honors exact empty permissions and preserves legacy parent grants", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* setup;
      const git = createCommandPermissions(runtime, WS_METHODS.vcsInit);
      registry.set(sessions(env), AsyncResult.success({ ...grant(true), permissions: [] }));
      expect(registry.get(git.permissionAtom(env))).toBe(false);
      const denied = yield* git.authorize(registry, env).pipe(Effect.flip);
      expect(denied).toMatchObject({
        requiredPermission: AuthSourceControlWriteScope,
        requiredScope: AuthOrchestrationOperateScope,
      });
      const { permissions: _exact, ...legacy } = grant(true);
      registry.set(sessions(env), AsyncResult.success(legacy));
      expect(registry.get(git.permissionAtom(env))).toBe(true);
      yield* git.authorize(registry, env);
    }),
  ),
);

it.effect("rejects protected unary and streamed RPCs outside a guarded command", () =>
  Effect.gen(function* () {
    let writes = 0;
    const session = {
      client: {
        [WS_METHODS.scheduledTasksDelete]: () =>
          Effect.sync(() => {
            writes++;
            return { id: ScheduledTaskId.make("task") };
          }),
        [WS_METHODS.gitRunStackedAction]: () =>
          Stream.fromEffect(
            Effect.sync(() => {
              writes++;
            }),
          ),
      },
    } as unknown as RpcSession;
    const supervisor = {
      target: { environmentId: env, label: "target" },
      session: yield* SubscriptionRef.make(Option.some(session)),
    } as unknown as EnvironmentSupervisor["Service"];
    const unary = yield* requestGuarded(WS_METHODS.scheduledTasksDelete, {
      id: ScheduledTaskId.make("task"),
    }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor), Effect.flip);
    expect(unary._tag).toBe("EnvironmentAuthorizationError");
    const streamed = yield* runStreamGuarded(WS_METHODS.gitRunStackedAction, {
      actionId: "test-action",
      cwd: "/repo",
      action: "commit",
    }).pipe(Stream.runDrain, Effect.provideService(EnvironmentSupervisor, supervisor), Effect.flip);
    expect(streamed._tag).toBe("EnvironmentAuthorizationError");
    expect(writes).toBe(0);
  }),
);

it.effect("checks the destination grant for document-lived command results", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const registry = yield* setup;
      const supervisor = {
        target: { environmentId: env, label: "target" },
        state: yield* SubscriptionRef.make({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
        session: yield* SubscriptionRef.make(Option.some({} as RpcSession)),
      } as unknown as EnvironmentSupervisor["Service"];
      const resultRuntime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry, {
          run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
          followStream: (_id, stream) =>
            Stream.provideService(stream, EnvironmentSupervisor, supervisor),
        } as EnvironmentRegistry["Service"]),
      );
      let writes = 0;
      const command = createEnvironmentRpcCommand(resultRuntime, {
        label: "test.document-delete",
        tag: WS_METHODS.scheduledTasksDelete,
        execute: () =>
          Effect.sync(() => {
            writes++;
            return { id: ScheduledTaskId.make("task") };
          }),
      });
      const atom = command.resultAtom({
        environmentId: env,
        input: { id: ScheduledTaskId.make("task") },
      });
      registry.set(sessions(env), AsyncResult.success(grant(false)));
      const denied = yield* AtomRegistry.getResult(registry, atom).pipe(Effect.flip);
      expect(denied).toMatchObject({
        _tag: "EnvironmentAuthorizationError",
        requiredScope: AuthOrchestrationOperateScope,
      });
      expect(writes).toBe(0);
      registry.set(sessions(env), AsyncResult.success(grant(true)));
      registry.refresh(atom);
      expect(yield* AtomRegistry.getResult(registry, atom, { suspendOnWaiting: true })).toEqual({
        id: ScheduledTaskId.make("task"),
      });
      expect(writes).toBe(1);
    }),
  ),
);

it.effect("interrupts document-lived commands when their final reader closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      yield* Effect.addFinalizer(() => Effect.sync(() => vi.useRealTimers()));
      const registry = yield* setup;
      registry.set(sessions(env), AsyncResult.success(grant(true)));
      const supervisor = {
        target: { environmentId: env, label: "target" },
        state: yield* SubscriptionRef.make({ ...AVAILABLE_CONNECTION_STATE, phase: "connected" }),
        session: yield* SubscriptionRef.make(Option.some({} as RpcSession)),
      } as unknown as EnvironmentSupervisor["Service"];
      const resultRuntime = Atom.runtime(
        Layer.succeed(EnvironmentRegistry, {
          run: (_id, effect) => Effect.provideService(effect, EnvironmentSupervisor, supervisor),
          followStream: (_id, stream) =>
            Stream.provideService(stream, EnvironmentSupervisor, supervisor),
        } as EnvironmentRegistry["Service"]),
      );
      const started = yield* Deferred.make<void>();
      const interrupted = yield* Deferred.make<void>();
      const command = createEnvironmentRpcCommand(resultRuntime, {
        label: "test.document-cancel",
        tag: WS_METHODS.scheduledTasksDelete,
        execute: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      });
      const atom = command.resultAtom({
        environmentId: env,
        input: { id: ScheduledTaskId.make("task") },
      });
      const close = registry.mount(atom);
      yield* Deferred.await(started);
      close();
      yield* Effect.promise(() => vi.runAllTimersAsync());
      yield* Deferred.await(interrupted);
    }),
  ),
);
