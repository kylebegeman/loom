import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Setup from "./GitHubHostSetup.ts";
import * as Flow from "./GitHubSetupFlow.ts";

const fixture = Effect.gen(function* () {
  const started = yield* Deferred.make<void>();
  const approved = yield* Deferred.make<void>();
  const stopped = yield* Deferred.make<void>();
  let calls = 0;
  const setup = Setup.GitHubHostSetup.of({
    status: () => Effect.succeed({ executable: "/test/gh", state: "sign-in-required" }),
    setup: (input) =>
      Effect.gen(function* () {
        calls++;
        yield* input.onProgress?.({ phase: "waiting", deviceCode: "ABCD-EFGH" }) ?? Effect.void;
        yield* Deferred.succeed(started, undefined);
        yield* Deferred.await(approved);
        return { executable: "/test/gh", state: "git-ready" } as const;
      }).pipe(Effect.onInterrupt(() => Deferred.succeed(stopped, undefined))),
  });
  const flow = yield* Flow.make.pipe(Effect.provideService(Setup.GitHubHostSetup, setup));
  return { flow, started, approved, stopped, calls: () => calls };
});
const waitFor = (flow: Flow.GitHubSetupFlow["Service"], phase: string) =>
  flow.changes.pipe(
    Stream.filter((state) => state.phase === phase),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.effect("reuses a host-owned request across starts and subscriptions", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    assert.equal(
      (yield* f.flow.start({ requestId: "first" }).pipe(Effect.scoped)).phase,
      "checking",
    );
    yield* Deferred.await(f.started);
    const second = yield* f.flow.start({ requestId: "second" });
    assert.equal(second.requestId, "first");
    assert.equal(second.deviceCode, "ABCD-EFGH");
    assert.equal((yield* waitFor(f.flow, "waiting")).deviceCode, "ABCD-EFGH");
    assert.equal(f.calls(), 1);
    yield* Deferred.succeed(f.approved, undefined);
    const ready = yield* waitFor(f.flow, "ready");
    assert.isNull(ready.deviceCode);
    yield* f.flow.start({ requestId: "first" });
    assert.equal(f.calls(), 1);
  }),
);
it.effect("cancels owned work and rejects a stale cancellation without affecting it", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    yield* f.flow.start({ requestId: "current" });
    yield* Deferred.await(f.started);
    const rejected = yield* f.flow.cancel({ requestId: "old" }).pipe(Effect.flip);
    assert.equal(rejected._tag, "GitHubSetupFlowError");
    assert.equal((yield* f.flow.snapshot).phase, "waiting");
    const cancelled = yield* f.flow.cancel({ requestId: "current" });
    yield* Deferred.await(f.stopped);
    assert.equal(cancelled.phase, "cancelled");
    assert.isNull(cancelled.deviceCode);
    assert.equal((yield* f.flow.cancel({ requestId: "current" })).phase, "cancelled");
    yield* f.flow.start({ requestId: "retry" });
    yield* waitFor(f.flow, "waiting");
    assert.equal(f.calls(), 2);
  }),
);
it.effect("clears codes and exposes a safe retry message after approval failure", () =>
  Effect.gen(function* () {
    const flow = yield* Flow.make.pipe(
      Effect.provideService(
        Setup.GitHubHostSetup,
        Setup.GitHubHostSetup.of({
          status: () => Effect.succeed({ executable: "/test/gh", state: "sign-in-required" }),
          setup: (input) =>
            Effect.gen(function* () {
              yield* (
                input.onProgress?.({ phase: "waiting", deviceCode: "ABCD-EFGH" }) ?? Effect.void
              );
              return yield* new Setup.GitHubHostSetupError({
                reason: "sign-in-required",
                cause: new Error("private CLI output"),
              });
            }),
        }),
      ),
    );
    yield* flow.start({ requestId: "failed" });
    const error = yield* waitFor(flow, "error");
    assert.isNull(error.deviceCode);
    assert.include(error.message!, "Start setup again");
    assert.notInclude(error.message!, "private CLI output");
  }),
);

// fork: github-host-setup
it.effect("initial snapshots and watchers report saved sign-in without starting setup", () =>
  Effect.gen(function* () {
    let checks = 0;
    const flow = yield* Flow.make.pipe(
      Effect.provideService(Setup.GitHubHostSetup, {
        status: () =>
          Effect.sync(() => {
            checks++;
            return { executable: "/test/gh", state: "signed-in" as const, account: "loom-bot" };
          }),
        setup: () => Effect.die("Must not start setup from a read"),
      }),
    );
    const [a, b] = yield* Effect.all(
      [flow.snapshot, flow.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))],
      { concurrency: 2 },
    );
    assert.equal(a.phase, "ready");
    assert.include(a.message!, "loom-bot");
    assert.deepEqual(a, b);
    assert.equal(checks, 1);
  }),
);
it.effect("initial status distinguishes missing sign-in and unavailable checks", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    assert.include((yield* f.flow.snapshot).message!, "sign-in required");
    assert.equal(f.calls(), 0);
    const flow = yield* Flow.make.pipe(
      Effect.provideService(Setup.GitHubHostSetup, {
        status: () =>
          Effect.fail(
            new Setup.GitHubHostSetupError({
              reason: "unavailable",
              cause: new Error("private output"),
            }),
          ),
        setup: () => Effect.die("Must not start setup"),
      }),
    );
    const snapshot = yield* flow.snapshot;
    assert.equal(snapshot.phase, "error");
    assert.notInclude(snapshot.message!, "private output");
  }),
);
