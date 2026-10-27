import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess"; // fork: tailnet-ownership
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem"; // fork: tailnet-ownership
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError"; // fork: tailnet-ownership
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";

import {
  type DevShareError,
  DevServeFailedError,
  shareDevServer,
  unshareDevServer,
} from "./dev-share.ts";

// fork: tailnet-ownership
const TAILNET_STATUS = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "host.example.ts.net.", CapMap: { https: null } },
});
const CLAIMS_PATH = "/home/.t3/tailscale-serve.json";
const TARGET = { webPort: 5788, claimsPath: CLAIMS_PATH } as const;
const NO_HANDLER_STDERR = "error: failed to remove web serve: handler does not exist";

interface CallResult {
  readonly exitCode: number;
  readonly stderr?: string;
}

// fork: tailnet-ownership
const serveStatusWithRoot = (proxy: string) =>
  JSON.stringify({
    TCP: { "5788": { HTTPS: true } },
    Web: { "host.example.ts.net:5788": { Handlers: { "/": { Proxy: proxy } } } },
  });

const encode = (value: string) => Stream.make(new TextEncoder().encode(value));

// fork: tailnet-ownership
/** A tailnet host with a serve config, a claims file, and a log of every CLI call. */
const hostLayer = (input: {
  readonly serveStatus?: string;
  readonly claims?: Record<string, string>;
  readonly off?: CallResult;
  readonly serve?: CallResult;
  readonly calls?: Array<ReadonlyArray<string>>;
}) => {
  // fork: tailnet-ownership
  const files = new Map<string, string>();
  if (input.claims) {
    files.set(CLAIMS_PATH, JSON.stringify({ version: 1, claims: input.claims }));
  }
  const spawner = ChildProcessSpawner.make((command) => {
    const args = "args" in command ? (command.args as ReadonlyArray<string>) : [];
    input.calls?.push(args);
    const stdout =
      args[0] === "status"
        ? TAILNET_STATUS
        : args[1] === "status"
          ? (input.serveStatus ?? "{}")
          : undefined;
    const result: CallResult =
      stdout !== undefined
        ? { exitCode: 0 }
        : args.at(-1) === "off" // fork: tailnet-ownership
          ? (input.off ?? { exitCode: 0 })
          : (input.serve ?? { exitCode: 0 });

    // fork: tailnet-ownership
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.drain,
        stdout: stdout !== undefined ? encode(stdout) : Stream.empty, // fork: tailnet-ownership
        stderr: result.stderr ? encode(result.stderr) : Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      }),
    );
  });
  return Layer.mergeAll(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Layer.succeed(HostProcess.Platform, "linux"),
    FileSystem.layerNoop({
      readFileString: (path) => {
        const content = files.get(path);
        return content === undefined
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "readFileString",
                pathOrDescriptor: path,
              }),
            )
          : Effect.succeed(content);
      },
      writeFileString: (path, data) => Effect.sync(() => void files.set(path, data)),
      rename: (from, to) =>
        Effect.sync(() => {
          const content = files.get(from);
          files.delete(from);
          if (content !== undefined) files.set(to, content);
        }),
    }),
  );
};

// fork: tailnet-ownership
const mutations = (calls: ReadonlyArray<ReadonlyArray<string>>) =>
  calls.filter((args) => args[0] === "serve" && args[1] !== "status");

describe("unshareDevServer", () => {
  // fork: tailnet-ownership
  it.effect("removes only the root mapping while it still proxies here", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const result = yield* unshareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({ serveStatus: serveStatusWithRoot("http://localhost:5788"), calls }),
        ),
      );
      assert.isTrue(result.cleared);
      assert.deepEqual(mutations(calls), [["serve", "--https=5788", "--set-path=/", "off"]]);
    }),
  );

  // fork: tailnet-ownership
  // Another app took the port after this run shared it; its mapping stays.
  it.effect("leaves a mapping that no longer proxies here", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const result = yield* unshareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({ serveStatus: serveStatusWithRoot("http://127.0.0.1:8397"), calls }),
        ),
      );
      assert.isTrue(result.cleared);
      assert.deepEqual(mutations(calls), []);
    }),
  );

  // fork: tailnet-ownership
  it.effect("treats a mapping that vanished meanwhile as cleared", () =>
    Effect.gen(function* () {
      const result = yield* unshareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({
            serveStatus: serveStatusWithRoot("http://localhost:5788"),
            off: { exitCode: 1, stderr: NO_HANDLER_STDERR },
          }),
        ),
      );
      assert.isTrue(result.cleared);
    }),
  );

  it.effect("reports a genuine removal failure as not cleared", () =>
    Effect.gen(function* () {
      // fork: tailnet-ownership
      const result = yield* unshareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({
            serveStatus: serveStatusWithRoot("http://localhost:5788"),
            off: { exitCode: 1, stderr: "permission denied" },
          }),
        ),
      );
      assert.isFalse(result.cleared);
      assert.include(result.explanation, "permission denied");
      // fork: tailnet-ownership -- a claim record error can be the cause too
    }),
  );
});

describe("shareDevServer", () => {
  // Vite binds `localhost`, which modern Node resolves to `::1` first, so a
  // 127.0.0.1 target would proxy to a loopback nothing listens on.
  it.effect("proxies to the localhost name Vite binds, not 127.0.0.1", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      // fork: tailnet-ownership
      const shared = yield* shareDevServer(TARGET).pipe(Effect.provide(hostLayer({ calls })));

      // fork: tailnet-ownership
      assert.deepEqual(mutations(calls), [
        ["serve", "--bg", "--https=5788", "http://localhost:5788"],
      ]);
      assert.equal(shared.url, "https://host.example.ts.net:5788/"); // fork: tailnet-ownership
    }),
  );

  // fork: tailnet-ownership
  it.effect("refuses a port another app serves, without touching its mapping", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      const error: DevShareError = yield* shareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({ serveStatus: serveStatusWithRoot("http://127.0.0.1:8397"), calls }),
        ),
        Effect.flip,
      );

      assert.instanceOf(error, DevServeFailedError);
      assert.equal(error.stage, "claim");
      assert.include(error.message, "http://127.0.0.1:8397");
      assert.include(error.message, "--set-path=/ off");
      assert.deepEqual(mutations(calls), []);
    }),
  );

  // fork: tailnet-ownership
  // A `--built` run killed before its finalizer proxied to the backend; this run serves Vite.
  it.effect("takes back the mapping a crashed run of this checkout recorded", () =>
    Effect.gen(function* () {
      const calls: Array<ReadonlyArray<string>> = [];
      yield* shareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({
            serveStatus: serveStatusWithRoot("http://127.0.0.1:13773"),
            claims: { "5788": "http://127.0.0.1:13773" },
            calls,
          }),
        ),
      );

      // fork: tailnet-ownership
      assert.deepEqual(mutations(calls), [
        ["serve", "--bg", "--https=5788", "http://localhost:5788"],
      ]);
    }),
  );

  it.effect("explains a recognized serve failure without quoting stderr", () =>
    Effect.gen(function* () {
      // fork: tailnet-ownership
      const error: DevShareError = yield* shareDevServer(TARGET).pipe(
        Effect.provide(
          hostLayer({
            serve: {
              exitCode: 1,
              stderr: "permission denied for tskey-auth-secret-token-value",
            },
          }),
        ),
        Effect.flip,
      );

      assert.instanceOf(error, DevServeFailedError);
      assert.equal(error.stage, "serve");
      assert.include(error.message, "permission denied");
      assert.include(error.message, "elevated privileges");
      assert.notInclude(error.message, "tskey-auth-secret-token-value");
    }),
  );
  // fork: tailnet-ownership -- the clear-existing stage is gone
});
