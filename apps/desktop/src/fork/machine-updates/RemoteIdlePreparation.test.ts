import { assert, it } from "@effect/vitest";
import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import { createInitialDesktopUpdateState } from "../../updates/updateMachine.ts";
import { BackendUpdateError, makeOwnedBackendUpdates, type BackendPost } from "./IdleInstall.ts";
import { config, instance } from "./IdleInstall.testkit.ts";
import { makeRemoteIdlePreparation } from "./RemoteIdlePreparation.ts";

it.effect(
  "waits for all owned backends before ready, reports only to its origin, and renews fences through commit",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const progress = yield* Queue.unbounded<{
          waitingAgents: number | null;
          cancelled?: boolean;
        }>();
        const primary = config(3001, "primary");
        const wsl = config(3002, "wsl");
        let primaryAgents = 1;
        let planState = "waiting";
        let unavailable = false;
        const fenceCalls: { port: number; action: string; owner?: string }[] = [];
        let state: DesktopUpdateState = {
          ...createInitialDesktopUpdateState(
            "1.2.3",
            { hostArch: "arm64", appArch: "arm64", runningUnderArm64Translation: false },
            "latest",
          ),
          downloadedVersion: "1.2.4",
        };
        const post: BackendPost = (target, route, body) =>
          Effect.gen(function* () {
            if (route.endsWith("activity") && target === wsl && unavailable)
              return yield* new BackendUpdateError();
            if (route.endsWith("activity"))
              return {
                waitingAgents: target === primary ? primaryAgents : 0,
                plan:
                  target === wsl
                    ? {
                        version: 1,
                        id: "wsl-plan",
                        targetVersion: "1.2.4",
                        state: planState,
                        createdAt: 0,
                        updatedAt: 0,
                        finishedAt: null,
                        error: null,
                      }
                    : null,
              };
            if (route.endsWith("progress")) {
              assert.equal(target, wsl);
              yield* Queue.offer(progress, body as { waitingAgents: number | null });
              return {};
            }
            fenceCalls.push({
              port: target.bootstrap.port,
              ...(body as { action: string; owner?: string }),
            });
            return {
              leaseId: `lease-${target.bootstrap.port}`,
              waitingAgents: 0,
              expiresAt: 120000,
            };
          });
        const owned = makeOwnedBackendUpdates({
          instances: Effect.succeed([instance("primary", primary), instance("wsl", wsl)]),
          post,
        });
        const prepare = yield* makeRemoteIdlePreparation({
          owned,
          post,
          updates: {
            getState: Effect.sync(() => state),
            setRemoteIdleWait: (waiting, message) =>
              Effect.sync(() => {
                state = {
                  ...state,
                  installWhenIdle: waiting,
                  ...(message === undefined ? {} : { message }),
                };
              }),
          },
        });
        assert.equal((yield* prepare("primary", "1.2.4")).kind, "manual");
        const pending = yield* prepare("wsl", "1.2.4").pipe(Effect.forkChild);
        assert.equal((yield* Queue.take(progress)).waitingAgents, 1);
        assert.equal(fenceCalls.length, 0);
        unavailable = true;
        yield* TestClock.adjust("15 seconds");
        assert.isNull((yield* Queue.take(progress)).waitingAgents);
        assert.isTrue(state.installWhenIdle);
        unavailable = false;
        primaryAgents = 0;
        yield* TestClock.adjust("15 seconds");
        assert.equal((yield* Queue.take(progress)).waitingAgents, 0);
        yield* TestClock.adjust("30 seconds");
        const ready = yield* Fiber.join(pending);
        assert.equal(ready.kind, "ready");
        if (ready.kind !== "ready") return;
        assert.equal(fenceCalls.filter((call) => call.action === "acquire").length, 2);
        assert.isTrue(fenceCalls.every((call) => call.owner === "wsl-plan"));
        yield* TestClock.adjust("30 seconds");
        assert.equal(fenceCalls.filter((call) => call.action === "acquire").length, 4);
        planState = "installing";
        let installed = false;
        assert.isTrue(
          (yield* ready.commit(
            Effect.sync(() => {
              installed = true;
              return true;
            }),
          )) === true,
        );
        assert.isTrue(installed);
        assert.equal(fenceCalls.filter((call) => call.action === "release").length, 2);
        assert.isFalse(state.installWhenIdle);
      }),
    ),
);

it.effect("holds an unknown origin and cancels before fencing when its plan changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const origin = config(3002, "origin");
      const heldUnknown = yield* Deferred.make<void>();
      let available = false;
      let planState = "waiting";
      let armed = false;
      let cancelled = false;
      const progress = yield* Queue.unbounded<void>();
      const post: BackendPost = (_target, route, body) =>
        Effect.gen(function* () {
          if (route.endsWith("activity") && !available) return yield* new BackendUpdateError();
          if (route.endsWith("activity"))
            return {
              waitingAgents: 1,
              plan: {
                version: 1,
                id: "plan",
                targetVersion: "1.2.4",
                state: planState,
                createdAt: 0,
                updatedAt: 0,
                finishedAt: null,
                error: null,
              },
            };
          assert.isTrue(route.endsWith("progress"));
          cancelled ||= (body as { cancelled?: boolean }).cancelled === true;
          yield* Queue.offer(progress, undefined);
          return {};
        });
      const state = {
        ...createInitialDesktopUpdateState(
          "1.2.3",
          { hostArch: "arm64", appArch: "arm64", runningUnderArm64Translation: false },
          "latest",
        ),
        downloadedVersion: "1.2.4",
      };
      const prepare = yield* makeRemoteIdlePreparation({
        owned: makeOwnedBackendUpdates({
          instances: Effect.succeed([instance("wsl", origin)]),
          post,
        }),
        post,
        updates: {
          getState: Effect.sync(() => ({ ...state, installWhenIdle: armed })),
          setRemoteIdleWait: (value) =>
            Effect.sync(() => {
              armed = value;
            }).pipe(Effect.andThen(value ? Deferred.succeed(heldUnknown, undefined) : Effect.void)),
        },
      });
      const waiting = yield* prepare("wsl", "1.2.4").pipe(Effect.forkChild);
      yield* Deferred.await(heldUnknown);
      assert.isTrue(armed);
      available = true;
      yield* TestClock.adjust("15 seconds");
      yield* Queue.take(progress);
      planState = "cancelled";
      yield* TestClock.adjust("15 seconds");
      assert.equal((yield* Fiber.join(waiting)).kind, "cancelled");
      assert.isFalse(armed);
      assert.isTrue(cancelled);
    }),
  ),
);
