import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as PlatformError from "effect/PlatformError";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { probeSwitchboardCredential } from "./switchboard.ts";

const encoder = new TextEncoder();
const keyCommand = { command: "/fixture/key helper", args: ["lookup", "fixture account"] };
const owningEnvironment = { HOME: "/fixture/owning-home", PATH: "/fixture/bin" };
const streamFailure = PlatformError.systemError({
  _tag: "Unknown",
  module: "ChildProcess",
  method: "read",
  description: "Fixture stream failure",
});

const fakeSpawner = (
  options: {
    readonly stdout?: Stream.Stream<Uint8Array, PlatformError.PlatformError>;
    readonly stderr?: Stream.Stream<Uint8Array, PlatformError.PlatformError>;
    readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>;
    readonly onSpawn?: (command: ChildProcess.Command) => Effect.Effect<void>;
    readonly onRelease?: Effect.Effect<void>;
  } = {},
) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* () {
      yield* options.onSpawn?.(command) ?? Effect.void;
      yield* Effect.addFinalizer(() => options.onRelease ?? Effect.void);
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: options.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: options.stdout ?? Stream.make(encoder.encode("fixture-token")),
        stderr: options.stderr ?? Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

const runProbe = (spawner: ChildProcessSpawner.ChildProcessSpawner["Service"]) =>
  probeSwitchboardCredential(keyCommand, owningEnvironment).pipe(
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );

describe("Switchboard credential readiness", () => {
  it.effect(
    "executes structured arguments with the owning environment and releases the child",
    () =>
      Effect.gen(function* () {
        const released = yield* Ref.make(0);
        const spawner = fakeSpawner({
          onSpawn: (command) =>
            Effect.sync(() => {
              assert.ok(ChildProcess.isStandardCommand(command));
              assert.equal(command.command, keyCommand.command);
              assert.deepEqual(command.args, keyCommand.args);
              assert.deepEqual(command.options.env, owningEnvironment);
              assert.notEqual(command.options.extendEnv, true);
              assert.notEqual(command.options.shell, true);
            }),
          onRelease: Ref.update(released, (count) => count + 1),
        });
        assert.equal(yield* runProbe(spawner), true);
        assert.equal(yield* Ref.get(released), 1);
      }),
  );

  it.effect.each([
    ["surrounding whitespace and CRLF", " \t\r\nfixture-token\r\n "],
    ["the maximum token length", "x".repeat(16_384)],
  ] as const)("accepts %s", ([, output]) =>
    Effect.gen(function* () {
      const spawner = fakeSpawner({ stdout: Stream.make(encoder.encode(output)) });
      assert.equal(yield* runProbe(spawner), true);
    }),
  );

  it.effect.each([
    ["empty output", ""],
    ["whitespace-only output", " \t\r\n "],
    ["internal spaces", "fixture token"],
    ["internal tabs", "fixture\ttoken"],
    ["internal line feeds", "fixture\ntoken"],
    ["internal CRLF", "fixture\r\ntoken"],
    ["NUL bytes", "fixture\u0000token"],
    ["control characters", "fixture\u001btoken"],
    ["DEL characters", "fixture\u007ftoken"],
    ["non-ASCII characters", "fixture-\u00e9-token"],
    ["tokens exceeding the maximum length", "x".repeat(16_385)],
    [
      "truncated output that would otherwise trim to a valid token",
      "fixture-token" + " ".repeat(65_536),
    ],
  ] as const)("rejects %s", ([, output]) =>
    Effect.gen(function* () {
      const spawner = fakeSpawner({ stdout: Stream.make(encoder.encode(output)) });
      assert.equal(yield* runProbe(spawner), false);
    }),
  );

  it.effect("collects a token across stdout chunks without returning its value", () =>
    Effect.gen(function* () {
      const spawner = fakeSpawner({
        stdout: Stream.make(encoder.encode("fixture-"), encoder.encode("token\n")),
      });
      assert.equal(yield* runProbe(spawner), true);
    }),
  );

  it.effect("rejects invalid UTF-8", () =>
    Effect.gen(function* () {
      const spawner = fakeSpawner({ stdout: Stream.make(new Uint8Array([0x66, 0x80, 0x6f])) });
      assert.equal(yield* runProbe(spawner), false);
    }),
  );

  it.effect("does not authenticate a nonzero exit even when stdout contains a valid token", () =>
    Effect.gen(function* () {
      const spawner = fakeSpawner({ exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(1)) });
      assert.equal(yield* runProbe(spawner), false);
    }),
  );

  it.effect("drains stderr concurrently without treating its output as credential evidence", () =>
    Effect.gen(function* () {
      const drained = yield* Deferred.make<void>();
      const spawner = fakeSpawner({
        stdout: Stream.fromEffect(Deferred.await(drained)).pipe(
          Stream.map(() => encoder.encode("fixture-token")),
        ),
        stderr: Stream.fromEffect(Deferred.succeed(drained, undefined)).pipe(
          Stream.map(() => encoder.encode("fixture-diagnostic")),
        ),
        exitCode: Deferred.await(drained).pipe(Effect.as(ChildProcessSpawner.ExitCode(0))),
      });
      assert.equal(yield* runProbe(spawner), true);
    }),
  );

  it.effect("stderr alone cannot authenticate", () =>
    Effect.gen(function* () {
      const spawner = fakeSpawner({
        stdout: Stream.empty,
        stderr: Stream.make(encoder.encode("fixture-token")),
      });
      assert.equal(yield* runProbe(spawner), false);
    }),
  );

  it.effect.each(["stdout", "stderr", "exit"] as const)(
    "returns false and releases the child after %s failure",
    (failure) =>
      Effect.gen(function* () {
        const released = yield* Ref.make(0);
        const spawner = fakeSpawner({
          ...(failure === "stdout" ? { stdout: Stream.fail(streamFailure) } : {}),
          ...(failure === "stderr" ? { stderr: Stream.fail(streamFailure) } : {}),
          ...(failure === "exit" ? { exitCode: Effect.fail(streamFailure) } : {}),
          onRelease: Ref.update(released, (count) => count + 1),
        });
        assert.equal(yield* runProbe(spawner), false);
        assert.equal(yield* Ref.get(released), 1);
      }),
  );

  it.effect("returns false when the helper cannot spawn", () =>
    Effect.gen(function* () {
      const spawner = ChildProcessSpawner.make(() =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            description: "Fixture executable unavailable",
          }),
        ),
      );
      assert.equal(yield* runProbe(spawner), false);
    }),
  );

  it.effect(
    "force kills a TERM-ignoring helper when the probe times out",
    () =>
      Effect.gen(function* () {
        if ((yield* HostProcess.Platform) === "win32") return;
        const nodeSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const spawned = yield* Deferred.make<ChildProcessSpawner.ChildProcessHandle>();
        const ready = yield* Deferred.make<void>();
        const instrumentedSpawner = ChildProcessSpawner.make((command) =>
          nodeSpawner.spawn(command).pipe(
            Effect.tap((child) => Deferred.succeed(spawned, child)),
            Effect.map((child) =>
              ChildProcessSpawner.makeHandle({
                ...child,
                stdout: child.stdout.pipe(Stream.tap(() => Deferred.succeed(ready, undefined))),
              }),
            ),
          ),
        );
        // Readiness is emitted only after the signal handler is installed. The
        // self-exit failsafe keeps the broken implementation from leaking a child.
        const helperProgram = [
          "process.on('SIGTERM', () => {});",
          "process.stdout.write('READY\\n');",
          "setTimeout(() => process.exit(0), 6000);",
        ].join("\n");
        const probe = probeSwitchboardCredential(
          { command: yield* HostProcess.ExecutablePath, args: ["-e", helperProgram] },
          {},
        ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, instrumentedSpawner));
        const fiber = yield* probe.pipe(Effect.forkChild);
        const child = yield* Deferred.await(spawned);
        yield* Effect.addFinalizer(() =>
          child.isRunning.pipe(
            Effect.flatMap((running) =>
              running
                ? child.kill({ killSignal: "SIGKILL", forceKillAfter: "1 second" })
                : Effect.void,
            ),
            Effect.ignore,
          ),
        );
        yield* Deferred.await(ready);
        const cleanupStartedAt = performance.now();
        yield* TestClock.adjust("10 seconds");
        assert.equal(yield* Fiber.join(fiber), false);
        assert.isBelow(performance.now() - cleanupStartedAt, 5000);
        assert.equal(yield* child.isRunning, false);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { timeout: 10000 },
  );

  it.effect("times out a hanging child after ten seconds and closes its scope", () =>
    Effect.gen(function* () {
      const spawned = yield* Deferred.make<void>();
      const released = yield* Ref.make(0);
      const spawner = fakeSpawner({
        onSpawn: () => Deferred.succeed(spawned, undefined).pipe(Effect.asVoid),
        onRelease: Ref.update(released, (count) => count + 1),
        stdout: Stream.never,
        stderr: Stream.never,
        exitCode: Effect.never,
      });
      const fiber = yield* runProbe(spawner).pipe(Effect.forkChild);
      yield* Deferred.await(spawned);
      yield* TestClock.adjust("9 seconds");
      assert.equal(fiber.pollUnsafe(), undefined);
      yield* TestClock.adjust("1 second");
      assert.equal(yield* Fiber.join(fiber), false);
      assert.equal(yield* Ref.get(released), 1);
    }),
  );
});
