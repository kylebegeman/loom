import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { createInitialDesktopUpdateState } from "../../updates/updateMachine.ts";
import { makeDesktopIdleInstall } from "./DesktopIdleInstall.ts";

it.effect("main installs an armed download with no renderer or running backend", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const initial: DesktopUpdateState = {
        ...createInitialDesktopUpdateState(
          "1.2.3",
          { hostArch: "arm64", appArch: "arm64", runningUnderArm64Translation: false },
          "latest",
        ),
        downloadedVersion: "1.2.4",
        installWhenIdle: true,
      };
      const state = yield* Ref.make(initial);
      const changes = yield* PubSub.unbounded<typeof initial>();
      const messages = yield* Queue.unbounded<string>();
      const installed = yield* Deferred.make<string>();
      const idle = yield* makeDesktopIdleInstall({
        state: Ref.get(state),
        changes,
        instances: Effect.succeed([]),
        modify: (f) =>
          Ref.updateAndGet(state, f).pipe(
            Effect.tap((value) => PubSub.publish(changes, value)),
            Effect.tap((value) =>
              value.message ? Queue.offer(messages, value.message) : Effect.void,
            ),
          ),
        install: (version) =>
          Ref.update(state, (value) => ({ ...value, installWhenIdle: false })).pipe(
            Effect.andThen(Deferred.succeed(installed, version)),
            Effect.map(() => ({ accepted: true, completed: false, failed: false, state: initial })),
          ),
      });
      yield* idle.start;
      assert.equal(yield* Queue.take(messages), "Waiting for agents to stay idle.");
      yield* TestClock.adjust("30 seconds");
      assert.equal(yield* Deferred.await(installed), "1.2.4");
      yield* idle.setRemoteIdleWait(true, "Waiting for 1 agent.");
      assert.isFalse((yield* Ref.get(state)).installWhenIdle);
    }),
  ).pipe(Effect.provide(NodeCrypto.layer)),
);
