import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ProcessRunner from "../processRunner.ts";
import * as Resources from "./NativeWorkloadResources.ts";

function fixture(
  enabled: string | undefined = "1",
  platform: NodeJS.Platform = "linux",
  reached?: Deferred.Deferred<void>,
) {
  const calls: { action: string; reservation_id: string; workspace?: string; owner_pid: number }[] =
    [];
  let accepted = true;
  let valid = true;
  const runner = ProcessRunner.ProcessRunner.of({
    run: (input) =>
      Effect.sync(() => {
        assert.equal(input.command, "/usr/local/bin/loom-mini");
        assert.equal(input.spawnCwd, "/");
        assert.deepEqual(input.args, ["jobs", "rpc"]);
        const header = JSON.parse(input.stdin!);
        calls.push(header);
        return {
          stdout: valid
            ? JSON.stringify({
                accepted: header.action === "native-release" || accepted,
                reason: accepted ? null : "slot_limit",
              })
            : "invalid",
          stderr: "",
          code: 0 as ProcessRunner.ProcessRunOutput["code"],
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }).pipe(
        Effect.tap(() =>
          reached === undefined ? Effect.void : Deferred.succeed(reached, undefined),
        ),
      ),
  });
  const layer = Resources.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProcessRunner.ProcessRunner, runner),
        Layer.succeed(
          HostProcess.Environment,
          enabled === undefined ? {} : { T3CODE_MINI_RESOURCE_ACCOUNTING: enabled },
        ),
        Layer.succeed(HostProcess.Platform, platform),
      ),
    ),
  );
  return {
    layer,
    calls,
    hold: () => {
      accepted = false;
    },
    corrupt: () => {
      valid = false;
    },
  };
}

it.effect("ordinary hosts are no-op without invoking Mini", () => {
  const f = fixture("0", "darwin");
  return Effect.gen(function* () {
    const service = yield* Resources.NativeWorkloadResources;
    yield* service.acquire("session", "turn", null);
    yield* service.releaseSession("session");
    assert.isFalse(service.enabled);
    assert.equal(f.calls.length, 0);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "replays stable identities and releases only the requested runtime and idle turns",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const service = yield* Resources.NativeWorkloadResources;
      yield* service.acquire("old", "a", "/ssd/repo");
      yield* service.acquire("old", "a", "/ssd/repo");
      yield* service.acquire("old", "b", "/ssd/repo");
      yield* service.acquire("replacement", "a", "/ssd/repo");
      assert.equal(f.calls[0]!.reservation_id, f.calls[1]!.reservation_id);
      assert.notEqual(f.calls[0]!.reservation_id, f.calls[3]!.reservation_id);
      yield* service.releaseIdle("old", new Set(["b"]));
      assert.equal(f.calls.at(-1)!.reservation_id, f.calls[0]!.reservation_id);
      yield* service.releaseSession("old");
      assert.equal(f.calls.at(-1)!.reservation_id, f.calls[2]!.reservation_id);
      const count = f.calls.length;
      yield* service.releaseSession("old");
      assert.equal(f.calls.length, count);
      yield* service.releaseSession("replacement");
      assert.equal(f.calls.at(-1)!.reservation_id, f.calls[3]!.reservation_id);
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("stopped admission releases its durable waiting reservation before returning", () =>
  Effect.gen(function* () {
    const reached = yield* Deferred.make<void>();
    const f = fixture("1", "linux", reached);
    f.hold();
    yield* Effect.gen(function* () {
      const service = yield* Resources.NativeWorkloadResources;
      const starting = yield* service.acquire("session", "a", "/ssd/repo").pipe(Effect.forkChild);
      yield* Deferred.await(reached);
      yield* Fiber.interrupt(starting);
      assert.deepEqual(
        f.calls.map((call) => call.action),
        ["native-acquire", "native-release"],
      );
      yield* service.releaseSession("session");
      assert.equal(f.calls.length, 2);
    }).pipe(Effect.provide(f.layer));
  }),
);

it.effect.each([
  ["invalid opt-in", "typo", "linux", "/ssd/repo"],
  ["wrong platform", "1", "darwin", "/ssd/repo"],
  ["missing workspace", "1", "linux", null],
] as const)("fails closed for %s", ([_name, enabled, platform, workspace]) => {
  const f = fixture(enabled, platform);
  return Effect.gen(function* () {
    const service = yield* Resources.NativeWorkloadResources;
    const result = yield* service.acquire("session", "a", workspace).pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    assert.equal(f.calls.length, 0);
  }).pipe(Effect.provide(f.layer));
});

it.effect("malformed helper output blocks starts", () => {
  const f = fixture();
  f.corrupt();
  return Effect.gen(function* () {
    const service = yield* Resources.NativeWorkloadResources;
    const result = yield* service.acquire("session", "a", "/ssd/repo").pipe(Effect.result);
    assert.equal(result._tag, "Failure");
  }).pipe(Effect.provide(f.layer));
});
