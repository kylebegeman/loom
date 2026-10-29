import { assert, it } from "@effect/vitest";
import type { DesktopUpdateState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { createInitialDesktopUpdateState } from "../../updates/updateMachine.ts";
import { makeIdleWindowLifetime } from "./IdleWindowLifetime.ts";

it.effect(
  "keeps a windowless app armed, then restores normal quit after cancellation or failure",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        for (const failed of [false, true]) {
          const changes = yield* Queue.unbounded<DesktopUpdateState>();
          const quits = yield* Queue.unbounded<void>();
          let state: DesktopUpdateState = {
            ...createInitialDesktopUpdateState(
              "1.2.3",
              { appArch: "arm64", hostArch: "arm64", runningUnderArm64Translation: false },
              "latest",
            ),
            installWhenIdle: true,
          };
          const lifetime = yield* makeIdleWindowLifetime({
            updates: {
              getState: Effect.sync(() => state),
              isInstallActive: Effect.succeed(false),
              subscribe: Effect.succeed({ latest: state, changes: Stream.fromQueue(changes) }),
            },
            canQuit: Effect.succeed(true),
            quit: Queue.offer(quits, undefined).pipe(Effect.asVoid),
          });
          assert.isTrue(yield* lifetime.holdClose);
          state = {
            ...state,
            installWhenIdle: false,
            ...(failed ? ({ status: "error", message: "Install failed." } as const) : {}),
          };
          yield* Queue.offer(changes, state);
          yield* Queue.take(quits);
          assert.isFalse(yield* lifetime.holdClose);
        }
      }),
    ),
);
