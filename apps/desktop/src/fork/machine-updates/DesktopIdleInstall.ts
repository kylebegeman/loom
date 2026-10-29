import type { DesktopUpdateActionResult, DesktopUpdateState } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import type { DesktopBackendInstance } from "../../backend/DesktopBackendPool.ts";
import { makeBackendPost, makeOwnedBackendUpdates, waitForIdleInstall } from "./IdleInstall.ts";

export const makeDesktopIdleInstall = Effect.fn("DesktopIdleInstall.make")(function* <
  Result extends DesktopUpdateActionResult & { readonly failed: boolean },
>(input: {
  readonly instances: Effect.Effect<readonly DesktopBackendInstance[]>;
  readonly state: Effect.Effect<DesktopUpdateState>;
  readonly changes: PubSub.PubSub<DesktopUpdateState>;
  readonly modify: (
    f: (state: DesktopUpdateState) => DesktopUpdateState,
  ) => Effect.Effect<DesktopUpdateState>;
  readonly install: (version: string) => Effect.Effect<Result>;
}) {
  const crypto = yield* Crypto.Crypto;
  const remote = yield* Ref.make(false);
  const permit = yield* Semaphore.make(1);
  const owned = makeOwnedBackendUpdates({
    instances: input.instances,
    post: yield* makeBackendPost,
  });
  const localArm = Effect.fn("DesktopIdleInstall.localArm")(function* (version: string) {
    const state = yield* input.state;
    return (
      !(yield* Ref.get(remote)) &&
      state.installWhenIdle === true &&
      state.downloadedVersion === version
    );
  });
  const wait = Effect.fn("DesktopIdleInstall.installAfterIdle")(function* (
    version: string,
    armed: Effect.Effect<boolean>,
  ) {
    let result: Result | null = null;
    const owner = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
    yield* permit.withPermits(1)(
      waitForIdleInstall({
        armed,
        read: owned.read(),
        message: (message) =>
          input
            .modify((state) => (state.message === message ? state : { ...state, message }))
            .pipe(Effect.asVoid),
        install: owned.install(
          version,
          owner,
          Effect.gen(function* () {
            result = yield* input.install(version);
            return result.accepted;
          }),
          armed,
        ),
      }),
    );
    return result;
  });
  const start = Effect.gen(function* () {
    const changes = yield* PubSub.subscribe(input.changes);
    while (true) {
      const state = yield* input.state;
      if (
        state.installWhenIdle === true &&
        state.downloadedVersion !== null &&
        !(yield* Ref.get(remote))
      ) {
        yield* wait(state.downloadedVersion, localArm(state.downloadedVersion)).pipe(
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            () =>
              input
                .modify((current) => ({
                  ...current,
                  installWhenIdle: false,
                  message: "Could not wait for agents. Try again.",
                }))
                .pipe(Effect.asVoid),
          ),
        );
      } else yield* PubSub.take(changes);
    }
  }).pipe(Effect.forkScoped, Effect.asVoid);
  const setRemoteIdleWait = Effect.fn("DesktopIdleInstall.remoteWait")(function* (
    waiting: boolean,
    message?: string,
  ) {
    if (message !== undefined) {
      yield* input.modify((state) =>
        state.installWhenIdle === true ? { ...state, message } : state,
      );
      return;
    }
    yield* Ref.set(remote, waiting);
    yield* input.modify((state) => ({ ...state, installWhenIdle: waiting }));
  });
  const installPrepared = Effect.fn("DesktopIdleInstall.installPrepared")(function* (
    version: string,
    fenced = false,
  ) {
    if (!fenced) {
      const activity = yield* owned.read();
      if (
        activity.backends.some(
          (backend) =>
            backend.activity?.plan?.state === "installing" &&
            backend.activity.plan.targetVersion === version,
        )
      ) {
        const installed = yield* wait(
          version,
          input.state.pipe(Effect.map((state) => state.downloadedVersion === version)),
        );
        if (installed !== null) return installed;
        return { accepted: false, completed: false, failed: false, state: yield* input.state };
      }
    }
    return yield* input.install(version);
  });
  return { start, setRemoteIdleWait, installPrepared };
});
