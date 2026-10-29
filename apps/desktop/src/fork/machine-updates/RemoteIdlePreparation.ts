import { UPDATE_PROGRESS_ROUTE, type UpdateProgress } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import type { DesktopUpdates } from "../../updates/DesktopUpdates.ts";
import type { BackendPost } from "./IdleInstall.ts";
import { IDLE_INSTALL_POLL, makeOwnedBackendUpdates, waitForIdleInstall } from "./IdleInstall.ts";

export interface RemoteIdleReservation {
  readonly kind: "ready";
  readonly release: Effect.Effect<void>;
  readonly commit: <A>(action: Effect.Effect<A>) => Effect.Effect<A | null>;
}

export const makeRemoteIdlePreparation = Effect.fn("DesktopIdleInstall.remotePreparation")(
  function* (input: {
    readonly owned: ReturnType<typeof makeOwnedBackendUpdates>;
    readonly post: BackendPost;
    readonly updates: Pick<DesktopUpdates["Service"], "getState" | "setRemoteIdleWait">;
  }) {
    const scope = yield* Scope.Scope;
    return Effect.fn("DesktopIdleInstall.prepareRemote")(function* (
      sourceId: string,
      version: string,
    ) {
      let initial = yield* input.owned.read();
      let origin = initial.backends.find((backend) => backend.instance.id === sourceId);
      const checking = origin?.activity === null;
      if (checking) {
        yield* input.updates.setRemoteIdleWait?.(true) ?? Effect.void;
        yield* (
          input.updates.setRemoteIdleWait?.(
            true,
            "Waiting for computers to report agent activity.",
          ) ?? Effect.void
        );
        yield* Effect.gen(function* () {
          while (
            origin?.activity === null &&
            (yield* input.updates.getState).installWhenIdle === true
          ) {
            yield* Effect.sleep(IDLE_INSTALL_POLL);
            initial = yield* input.owned.read();
            origin = initial.backends.find((backend) => backend.instance.id === sourceId);
          }
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? (input.updates.setRemoteIdleWait?.(false) ?? Effect.void)
              : Effect.void,
          ),
        );
        if (!origin?.activity || (yield* input.updates.getState).installWhenIdle !== true) {
          yield* input.updates.setRemoteIdleWait?.(false) ?? Effect.void;
          return { kind: "cancelled" as const };
        }
      }
      const plan = origin?.activity?.plan;
      if (
        !origin?.config ||
        !plan ||
        plan.targetVersion !== version ||
        !["armed", "waiting"].includes(plan.state)
      ) {
        if (checking) yield* input.updates.setRemoteIdleWait?.(false) ?? Effect.void;
        return { kind: "manual" as const };
      }
      const config = origin.config;
      yield* input.updates.setRemoteIdleWait?.(true) ?? Effect.void;
      let held: {
        readonly release: Effect.Effect<void>;
        readonly renew: Effect.Effect<boolean>;
      } | null = null;
      let committing = false;
      let released = false;
      const active = Effect.gen(function* () {
        const state = yield* input.updates.getState;
        if (released || state.installWhenIdle !== true || state.downloadedVersion !== version)
          return false;
        const observed = (yield* input.owned.read()).backends.find(
          (backend) => backend.instance.id === sourceId,
        );
        if (observed?.activity === null) return true;
        const current = observed?.activity?.plan;
        return (
          current?.id === plan.id &&
          current.targetVersion === version &&
          ["armed", "waiting", "installing"].includes(current.state)
        );
      });

      const release = Effect.suspend(() => {
        if (released) return Effect.void;
        released = true;
        return (held?.release ?? Effect.void).pipe(
          Effect.andThen(input.updates.setRemoteIdleWait?.(false) ?? Effect.void),
        );
      });
      const progress = Effect.fn("DesktopIdleInstall.progress")(function* (cancelled = false) {
        const activity = yield* input.owned.read();
        yield* input
          .post(config, UPDATE_PROGRESS_ROUTE, {
            planId: plan.id,
            waitingAgents: activity.waitingAgents,
            ...(cancelled ? { cancelled: true } : {}),
          } satisfies UpdateProgress)
          .pipe(Effect.ignoreCause);
      });
      yield* waitForIdleInstall({
        armed: active,
        read: input.owned.read(),
        message: (text) =>
          (input.updates.setRemoteIdleWait?.(true, text) ?? Effect.void).pipe(
            Effect.andThen(progress()),
          ),
        install: Effect.gen(function* () {
          held = yield* input.owned.reserve(version, plan.id);
          return held !== null;
        }),
      }).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) || held === null
            ? progress(true).pipe(Effect.andThen(release))
            : Effect.void,
        ),
      );
      if (held === null || !(yield* active)) {
        yield* release;
        return { kind: "cancelled" as const };
      }

      yield* Effect.gen(function* () {
        for (let remaining = 10; remaining > 0; remaining--) {
          if (released) break;
          yield* Effect.sleep("30 seconds");
          if (!committing && (!(yield* active) || !(yield* held!.renew))) break;
        }
        if (!released && !committing) yield* progress(true);
        yield* release;
      }).pipe(Effect.ensuring(release), Effect.forkIn(scope));
      return {
        kind: "ready" as const,
        release,
        commit: Effect.fn("DesktopIdleInstall.commitRemote")(function* <A>(
          action: Effect.Effect<A>,
        ) {
          if (!(yield* active) || !(yield* held!.renew)) {
            yield* release;
            return null;
          }
          committing = true;
          return yield* action.pipe(Effect.ensuring(release));
        }),
      };
    });
  },
);
