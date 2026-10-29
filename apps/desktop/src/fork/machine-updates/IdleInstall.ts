import {
  UPDATE_ACTIVITY_ROUTE,
  UPDATE_FENCE_ROUTE,
  UpdateActivity,
  UpdateFenceLease,
} from "@t3tools/contracts/fork";
import { currentDesktopBootstrapToken } from "@t3tools/shared/desktopBootstrapToken";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest } from "effect/http";
import type { DesktopBackendInstance } from "../../backend/DesktopBackendPool.ts";
import type { DesktopBackendStartConfig } from "../../backend/DesktopBackendManager.ts";

export const IDLE_INSTALL_QUIET_MS = 30_000;
export const IDLE_INSTALL_POLL = "15 seconds";
const FENCE_ROUTE = UPDATE_FENCE_ROUTE;
const Activity = UpdateActivity;
const Fence = UpdateFenceLease;
type Activity = typeof Activity.Type;
export class BackendUpdateError extends Schema.TaggedError<BackendUpdateError>()(
  "BackendUpdateError",
  {},
) {}

export type BackendPost = (
  config: DesktopBackendStartConfig,
  route: string,
  body: unknown,
) => Effect.Effect<unknown, BackendUpdateError>;

export const makeBackendPost = Effect.gen(function* () {
  const client = yield* Effect.serviceOption(HttpClient.HttpClient);
  return Effect.fn("DesktopIdleInstall.post")(
    function* (config: DesktopBackendStartConfig, route: string, body: unknown) {
      if (Option.isNone(client)) return yield* new BackendUpdateError();
      const token = config.bootstrap.desktopBootstrapSecret
        ? currentDesktopBootstrapToken(
            config.bootstrap.desktopBootstrapSecret,
            yield* Clock.currentTimeMillis,
          )
        : config.bootstrap.desktopBootstrapToken;
      if (!token) return yield* new BackendUpdateError();
      const request = yield* HttpClientRequest.bodyJson(
        HttpClientRequest.post(new URL(route, config.httpBaseUrl).href).pipe(
          HttpClientRequest.bearerToken(token),
        ),
        body,
      );
      const response = yield* client.value.execute(request);
      if (response.status < 200 || response.status >= 300) return yield* new BackendUpdateError();
      return yield* response.json;
    },
    Effect.timeout("5 seconds"),
    Effect.mapError(() => new BackendUpdateError()),
  );
});

interface Observation {
  readonly instance: DesktopBackendInstance;
  readonly config: DesktopBackendStartConfig | null;
  readonly activity: Activity | null;
}
export interface OwnedActivity {
  readonly waitingAgents: number | null;
  readonly backends: readonly Observation[];
}

export function makeOwnedBackendUpdates(input: {
  readonly instances: Effect.Effect<readonly DesktopBackendInstance[]>;
  readonly post: BackendPost;
}) {
  const read = Effect.fn("DesktopIdleInstall.read")(function* () {
    const backends: Observation[] = [];
    for (const instance of yield* input.instances) {
      const snapshot = yield* instance.snapshot;
      if (!snapshot.desiredRunning) continue;
      const config = snapshot.ready ? Option.getOrNull(yield* instance.currentConfig) : null;
      const activity =
        config === null
          ? null
          : yield* input.post(config, UPDATE_ACTIVITY_ROUTE, {}).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Activity)),
              Effect.orElseSucceed(() => null),
            );
      backends.push({ instance, config, activity });
    }
    return {
      backends,
      waitingAgents: backends.some((backend) => backend.activity === null)
        ? null
        : backends.reduce((sum, backend) => sum + backend.activity!.waitingAgents, 0),
    } satisfies OwnedActivity;
  });
  const reserve = Effect.fn("DesktopIdleInstall.reserve")(function* (
    version: string,
    owner: string,
  ) {
    const before = yield* read();
    if (before.waitingAgents !== 0) return null;
    const leases: { config: DesktopBackendStartConfig; id: string; owner: string }[] = [];
    const mutex = yield* Semaphore.make(1);
    let released = false;
    const release = Effect.suspend(() => {
      if (released) return Effect.void;
      released = true;
      return Effect.forEach(
        leases,
        (lease) =>
          input
            .post(lease.config, FENCE_ROUTE, { action: "release", leaseId: lease.id })
            .pipe(Effect.ignoreCause),
        { discard: true },
      );
    });
    const acquire = Effect.fn("DesktopIdleInstall.acquireLeases")(function* () {
      for (const backend of before.backends) {
        if (backend.config === null || backend.activity === null) return false;
        const plan = backend.activity.plan;
        const fenceOwner =
          plan !== null &&
          plan.targetVersion === version &&
          ["armed", "waiting", "installing"].includes(plan.state)
            ? plan.id
            : owner;
        const fence = yield* input
          .post(backend.config, FENCE_ROUTE, { action: "acquire", owner: fenceOwner })
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Fence)));
        if (fence.leaseId === null) return false;
        const held = leases.find((lease) => lease.config === backend.config);
        if (held) held.id = fence.leaseId;
        else leases.push({ config: backend.config, id: fence.leaseId, owner: fenceOwner });
      }
      const after = yield* read();
      return (
        after.waitingAgents === 0 &&
        after.backends.length === before.backends.length &&
        !after.backends.some(
          (backend, index) =>
            backend.instance !== before.backends[index]?.instance ||
            backend.config !== before.backends[index]?.config,
        )
      );
    });
    if (
      !(yield* acquire().pipe(
        Effect.onExit((exit) => (Exit.isFailure(exit) ? release : Effect.void)),
        Effect.orElseSucceed(() => false),
      ))
    ) {
      yield* release;
      return null;
    }
    const renew = mutex.withPermits(1)(
      Effect.suspend(() =>
        released ? Effect.succeed(false) : acquire().pipe(Effect.orElseSucceed(() => false)),
      ),
    );
    return { release, renew };
  });
  const install = Effect.fn("DesktopIdleInstall.fencedInstall")(function* (
    version: string,
    owner: string,
    action: Effect.Effect<boolean>,
    stillArmed: Effect.Effect<boolean> = Effect.succeed(true),
  ) {
    const held = yield* reserve(version, owner);
    if (held === null) return false;
    return yield* Effect.gen(function* () {
      if (!(yield* stillArmed)) return false;
      return yield* action;
    }).pipe(Effect.ensuring(held.release));
  });

  return { read, install, reserve };
}

export const waitForIdleInstall = Effect.fn("DesktopIdleInstall.wait")(function* (input: {
  readonly armed: Effect.Effect<boolean>;
  readonly read: Effect.Effect<OwnedActivity>;
  readonly message: (text: string) => Effect.Effect<void>;
  readonly install: Effect.Effect<boolean>;
}) {
  let quietSince: bigint | null = null;
  while (yield* input.armed) {
    const activity = yield* input.read;
    const now = yield* Clock.monotonicTimeNanos;
    if (activity.waitingAgents !== 0) quietSince = null;
    else if (quietSince === null) quietSince = now;
    yield* input.message(
      activity.waitingAgents === null
        ? "Waiting for computers to report agent activity."
        : activity.waitingAgents > 0
          ? `Waiting for ${activity.waitingAgents} ${activity.waitingAgents === 1 ? "agent" : "agents"}.`
          : "Waiting for agents to stay idle.",
    );
    if (
      quietSince !== null &&
      now - quietSince >= BigInt(IDLE_INSTALL_QUIET_MS) * 1_000_000n &&
      (yield* input.armed)
    ) {
      if (yield* input.install) return true;
      quietSince = null;
    }
    yield* Effect.sleep(IDLE_INSTALL_POLL);
  }
  return false;
});
