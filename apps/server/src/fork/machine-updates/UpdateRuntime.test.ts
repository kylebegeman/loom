import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ServerSelfUpdateError, type ServerSelfUpdateResult } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { UpdatePlanError } from "@t3tools/contracts/fork";
import { ServerConfig } from "../../config.ts";
import { ServerSelfUpdate } from "../../cloud/selfUpdate.ts";
import { ServiceLauncherClient } from "../../cloud/serviceLauncherClient.ts";
import { layer, UpdateRuntime } from "./UpdateRuntime.ts";

const runtimeFixture = (
  options: {
    readonly mode?: "web" | "desktop";
    readonly managed?: boolean;
    readonly controlFd?: number;
    readonly enabled?: boolean;
    readonly update?: ServerSelfUpdate["Service"]["update"];
    readonly commit?: ServerSelfUpdate["Service"]["commitDesktopUpdate"];
  } = {},
) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "update-runtime-boundary-" })),
    );
    return layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ServerConfig, {
            ...config,
            mode: options.mode ?? "web",
            desktopTelemetryControlFd: options.controlFd,
          }),
          Layer.mock(ServiceLauncherClient)({ managed: options.managed ?? true }),
          Layer.mock(ServerSelfUpdate)({
            update: options.update ?? (() => Effect.die("unexpected install")),
            commitDesktopUpdate: options.commit ?? (() => Effect.die("unexpected desktop commit")),
          }),
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: { LOOM_SERVER_SELF_UPDATE: String(options.enabled ?? true) },
            }),
          ),
        ),
      ),
      Layer.orDie,
    );
  });

it.effect.each([
  { mode: "web" as const, managed: true, supported: true },
  { mode: "web" as const, managed: false, supported: false },
  { mode: "desktop" as const, managed: true, supported: false },
  { mode: "desktop" as const, managed: false, controlFd: 3, supported: true },
  { mode: "desktop" as const, managed: true, controlFd: 3, enabled: false, supported: false },
])(
  "supports only an enabled updater with a real owner ($mode, $managed, $controlFd, $enabled)",
  (input) =>
    Effect.gen(function* () {
      const provided = yield* runtimeFixture(input);
      const supported = yield* Effect.flatMap(UpdateRuntime, (runtime) =>
        Effect.succeed(runtime.supported),
      ).pipe(Effect.provide(provided));
      assert.equal(supported, input.supported);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect(
  "passes the exact target and idle option and gates handoff on the caller's final check",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const provided = yield* runtimeFixture({
        update: (input, progress, accepted, options) =>
          Effect.gen(function* () {
            assert.deepEqual(input, { targetVersion: "0.1.2" });
            assert.deepEqual(options, { waitForIdle: true });
            yield* progress!("downloading");
            order.push("downloaded");
            yield* progress!("installing");
            order.push("handoff");
            yield* accepted!();
            return {
              method: "boot-service",
              targetVersion: input.targetVersion,
              updateId: "accepted",
            } satisfies ServerSelfUpdateResult;
          }),
      });
      yield* Effect.gen(function* () {
        const runtime = yield* UpdateRuntime;
        yield* runtime.install(
          "0.1.2",
          Effect.sync(() => {
            order.push("check");
          }),
          Effect.sync(() => {
            order.push("accepted");
          }),
        );
      }).pipe(Effect.provide(provided));
      assert.deepEqual(order, ["downloaded", "check", "handoff", "accepted"]);
      const rejected = yield* runtimeFixture({
        update: (_, progress) =>
          progress!("installing").pipe(
            Effect.as({ targetVersion: "0.1.2", method: "boot-service" as const }),
          ),
      });
      const error = yield* Effect.flatMap(UpdateRuntime, (runtime) =>
        runtime.install(
          "0.1.2",
          Effect.fail(new UpdatePlanError({ reason: "changed" })),
          Effect.sync(() => {
            order.push("wrongly accepted");
          }),
        ),
      ).pipe(Effect.provide(rejected), Effect.flip);
      assert.equal(error.reason, "update");
      assert.instanceOf(error.cause, ServerSelfUpdateError);
      assert.deepEqual(order, ["downloaded", "check", "handoff", "accepted"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("commits only the matching prepared desktop version and acknowledges the commit", () =>
  Effect.gen(function* () {
    let commits = 0;
    const mismatch = yield* runtimeFixture({
      mode: "desktop",
      controlFd: 3,
      update: () =>
        Effect.succeed({
          method: "desktop-app",
          targetVersion: "0.1.3",
          desktopUpdateToken: "wrong-version",
        }),
      commit: () => {
        commits++;
        return Effect.die("must not commit another target");
      },
    });
    const error = yield* Effect.flatMap(UpdateRuntime, (runtime) =>
      runtime.install("0.1.2", Effect.void, Effect.void),
    ).pipe(Effect.provide(mismatch), Effect.flip);
    assert.equal(error.reason, "update");
    assert.equal(commits, 0);
    const committed = yield* Deferred.make<void>();
    const order: string[] = [];
    const matching = yield* runtimeFixture({
      mode: "desktop",
      controlFd: 3,
      update: (_, progress) =>
        progress!("installing").pipe(
          Effect.as({
            method: "desktop-app" as const,
            targetVersion: "0.1.2",
            desktopUpdateToken: "prepared",
          }),
        ),
      commit: (token, accepted) =>
        Effect.gen(function* () {
          assert.equal(token, "prepared");
          commits++;
          order.push("commit");
          yield* accepted!();
          yield* Deferred.succeed(committed, undefined);
          return yield* Effect.never;
        }),
    });
    yield* Effect.gen(function* () {
      const runtime = yield* UpdateRuntime;
      const installing = yield* runtime
        .install(
          "0.1.2",
          Effect.sync(() => {
            order.push("check");
          }),
          Effect.sync(() => {
            order.push("accepted");
          }),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(committed);
      assert.deepEqual(order, ["check", "commit", "accepted"]);
      assert.equal(commits, 1);
      yield* Fiber.interrupt(installing);
    }).pipe(Effect.provide(matching));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
