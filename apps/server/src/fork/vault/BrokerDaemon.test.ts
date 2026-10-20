import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { VaultBrokerError, VaultError } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import * as BrokerCrypto from "./BrokerCrypto.ts";
import * as BrokerIdentity from "./BrokerIdentity.ts";
import * as BrokerRunner from "./BrokerRunner.ts";
import * as BrokerDaemon from "./BrokerDaemon.ts";

const fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const root = yield* fs
    .makeTempDirectoryScoped({ prefix: "loom-broker-daemon-" })
    .pipe(Effect.flatMap(fs.realPath));
  const state = path.join(root, "private");
  const identity = yield* BrokerIdentity.BrokerIdentity.pipe(
    Effect.provide(BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer))),
  );
  const key = yield* identity.read(state);
  const machineId = key.fingerprint.slice(0, 32);
  yield* identity.connect(state, {
    protocol: 1,
    origin: "https://loom.example",
    environmentId: "test-environment",
    machineId,
  });
  const observations: unknown[] = [],
    signals = yield* Effect.forEach([0, 1, 2, 3, 4, 5, 6], () => Deferred.make<void>());
  let checks = 0;
  const layers = Layer.mergeAll(
    Layer.succeed(BrokerIdentity.BrokerIdentity, identity),
    Layer.mock(BrokerRunner.BrokerRunner)({
      check: () =>
        Effect.gen(function* () {
          const attempt = checks++;
          if (attempt === 0) return yield* new VaultBrokerError({ reason: "unavailable" });
          if (attempt === 1) return yield* new VaultError({ reason: "locked" });
          if (attempt >= 3) return yield* new VaultBrokerError({ reason: "disabled" });
          const now = yield* Clock.currentTimeMillis;
          return {
            machineId,
            environmentId: "test-environment",
            leaseUntil: now + 120_000,
            renewAfter: now + 60_000,
            credentialDelivery: "unsupported" as const,
          };
        }),
    }),
  );
  const daemon = yield* BrokerDaemon.BrokerDaemon.pipe(
    Effect.provide(BrokerDaemon.layer.pipe(Layer.provide(layers))),
  );
  const console = yield* Console.Console;
  const recording = {
    ...console,
    log: (...args: ReadonlyArray<unknown>) => {
      observations.push(...args);
      const signal = signals[observations.length - 1];
      if (signal) Deferred.doneUnsafe(signal, Effect.void);
    },
  };
  return {
    fs,
    path,
    state,
    identity,
    key,
    daemon,
    observations,
    signals,
    recording,
    checks: () => checks,
  };
});
it.effect(
  "recovers from outage and a sealed backend, then stops on disable without replacing identity",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();

      const before = yield* f.fs.readFileString(f.path.join(f.state, "identity.json"));
      const fiber = yield* f.daemon
        .run(f.state)
        .pipe(Effect.provideService(Console.Console, f.recording), Effect.forkChild);

      yield* Deferred.await(f.signals[0]!);

      expect((yield* f.daemon.inspect(f.state)).report?.state).toBe("unavailable");

      yield* TestClock.adjust(60_000);

      yield* Deferred.await(f.signals[1]!);
      const locked = yield* f.daemon.inspect(f.state);
      expect(locked.report?.state).toBe("locked");
      expect(locked.report?.source).toBe("backend");
      expect(locked.report?.retryAfterMs).toBe(60_000);
      yield* TestClock.adjust(60_000);
      yield* Deferred.await(f.signals[2]!);
      expect((yield* f.daemon.inspect(f.state)).report?.state).toBe("online");
      expect((yield* f.daemon.inspect(f.state)).fresh).toBe(true);
      yield* TestClock.adjust(60_000);
      yield* Fiber.join(fiber);
      const disabled = yield* f.daemon.inspect(f.state);
      expect(disabled.report?.state).toBe("disabled");
      expect(disabled.report?.retryAfterMs).toBeNull();
      yield* TestClock.adjust(180_000);
      expect(f.checks()).toBe(4);
      expect((yield* f.daemon.inspect(f.state)).fresh).toBe(false);
      expect(yield* f.fs.readFileString(f.path.join(f.state, "identity.json"))).toBe(before);
      expect((yield* f.fs.stat(f.path.join(f.state, "status.json"))).mode & 0o077).toBe(0);
      expect(f.observations.join(" ")).not.toContain("privateKey");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "graceful cancellation marks stopped; restart reuses the binding and expired observations are stale",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const fiber = yield* f.daemon
        .run(f.state)
        .pipe(Effect.provideService(Console.Console, f.recording), Effect.forkChild);
      yield* Deferred.await(f.signals[0]!);
      yield* Fiber.interrupt(fiber);
      expect((yield* f.daemon.inspect(f.state)).report?.state).toBe("stopped");
      const restarted = yield* f.daemon
        .run(f.state)
        .pipe(Effect.provideService(Console.Console, f.recording), Effect.forkChild);
      yield* Deferred.await(f.signals[2]!);
      yield* TestClock.adjust(60_000);
      yield* Deferred.await(f.signals[3]!);
      expect((yield* f.daemon.inspect(f.state)).report?.machineId).toBe(
        f.key.fingerprint.slice(0, 32),
      );
      yield* Fiber.interrupt(restarted);
      yield* TestClock.adjust(120_000);
      expect((yield* f.daemon.inspect(f.state)).fresh).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect(
  "ignores foreign, symlinked, public or oversized status files without creating identity state",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const report = f.path.join(f.state, "status.json");
      expect((yield* f.daemon.inspect(f.state)).report).toBeNull();
      yield* f.fs.writeFileString(report, "x".repeat(5000), { mode: 0o600 });
      expect((yield* f.daemon.inspect(f.state)).report).toBeNull();
      yield* f.fs.writeFileString(
        report,
        JSON.stringify({
          protocol: 1,
          machineId: "other",
          environmentId: "test-environment",
          at: 0,
          state: "online",
          source: "heartbeat",
          leaseUntil: 120000,
          retryAfterMs: 60000,
        }),
      );
      expect((yield* f.daemon.inspect(f.state)).report).toBeNull();
      yield* f.fs.chmod(report, 0o644);
      expect((yield* f.daemon.inspect(f.state)).report).toBeNull();
      yield* f.fs.remove(report);
      yield* f.fs.symlink(f.path.join(f.state, "identity.json"), report);
      expect((yield* f.daemon.inspect(f.state)).report).toBeNull();
      const missing = f.path.join(f.state, "missing");
      expect((yield* f.daemon.run(missing).pipe(Effect.flip)).reason).toBe("local-state");
      expect(yield* f.fs.exists(missing)).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
