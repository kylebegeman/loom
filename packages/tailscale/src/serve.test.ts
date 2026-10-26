import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/process";
import * as HostProcess from "@t3tools/shared/HostProcess";

import {
  claimTailscaleServe,
  decideTailscaleServeClaim,
  decideTailscaleServeRelease,
  inspectTailscaleServe,
  parseTailscaleServeConfig,
  releaseTailscaleServe,
  TailscaleServeHttpsDisabledError,
  TailscaleServePortHeldError,
  type TailscaleServeConfig,
} from "./serve.ts";

const encoder = new TextEncoder();

// `tailscale serve status --json` from a Mac where two other apps already serve.
const SHARED_MAC_SERVE_STATUS = JSON.stringify({
  TCP: {
    "443": { HTTPS: true },
    "8317": { TCPForward: "127.0.0.1:8321" },
    "8443": { TCPForward: "127.0.0.1:8322" },
  },
  Web: {
    "mac.tail1234.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8397" } } },
  },
});

const STATUS_JSON = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "mac.tail1234.ts.net.", CapMap: { https: null } },
});

const webServe = (port: number, handlers: Record<string, { Proxy?: string; Path?: string }>) =>
  JSON.stringify({
    TCP: { [String(port)]: { HTTPS: true } },
    Web: { [`mac.tail1234.ts.net:${String(port)}`]: { Handlers: handlers } },
  });

const parse = (json: string) => parseTailscaleServeConfig(json);

const LOOM = "http://127.0.0.1:13773";
const CLAIMS_PATH = "/state/tailscale-serve.json";

function mockHandle(result: { stdout?: string; stderr?: string; code?: number }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code ?? 0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout ?? "")),
    stderr: Stream.make(encoder.encode(result.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

/** A tailnet with a serve config, a claims file, and a log of every CLI call. */
function makeHost(input: {
  readonly serveStatus: string;
  readonly status?: string;
  readonly claims?: Record<string, string>;
  readonly offResult?: { stderr: string; code: number };
}) {
  const calls: Array<ReadonlyArray<string>> = [];
  const files = new Map<string, string>();
  if (input.claims) {
    files.set(CLAIMS_PATH, JSON.stringify({ version: 1, claims: input.claims }));
  }
  const spawner = ChildProcessSpawner.make((command) => {
    const { args } = command as unknown as { readonly args: ReadonlyArray<string> };
    calls.push(args);
    if (args[0] === "status")
      return Effect.succeed(mockHandle({ stdout: input.status ?? STATUS_JSON }));
    if (args[1] === "status") return Effect.succeed(mockHandle({ stdout: input.serveStatus }));
    if (args.at(-1) === "off" && input.offResult)
      return Effect.succeed(mockHandle(input.offResult));
    return Effect.succeed(mockHandle({}));
  });
  const notFound = (path: string) =>
    PlatformError.systemError({
      _tag: "NotFound",
      module: "FileSystem",
      method: "readFileString",
      pathOrDescriptor: path,
    });
  const layer = Layer.mergeAll(
    Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
    Layer.succeed(HostProcess.Platform, "linux"),
    FileSystem.layerNoop({
      readFileString: (path) => {
        const content = files.get(path);
        return content === undefined ? Effect.fail(notFound(path)) : Effect.succeed(content);
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
  const recordedClaims = () => {
    const content = files.get(CLAIMS_PATH);
    return content === undefined
      ? undefined
      : (JSON.parse(content) as { claims: Record<string, string> }).claims;
  };
  const mutations = () => calls.filter((args) => args[0] === "serve" && args[1] !== "status");
  return { layer, calls, mutations, recordedClaims };
}

describe("tailscale serve status", () => {
  it.effect("reads web handlers, TCP forwards, and foreground sessions", () =>
    Effect.gen(function* () {
      const config = yield* parse(SHARED_MAC_SERVE_STATUS);
      assert.deepEqual(config.ports.get(443), {
        tcpForward: null,
        handlers: [{ mount: "/", proxy: "http://127.0.0.1:8397" }],
      });
      assert.equal(config.ports.get(8317)?.tcpForward, "127.0.0.1:8321");
      assert.equal(config.ports.size, 3);

      const empty = yield* parse("{}");
      assert.equal(empty.ports.size, 0);

      const foreground = yield* parse(
        JSON.stringify({ Foreground: { session: { TCP: { "9000": { HTTPS: true } } } } }),
      );
      assert.isTrue(foreground.foregroundPorts.has(9000));
    }),
  );
});

describe("tailscale serve ownership", () => {
  const decide = (config: TailscaleServeConfig, servePort: number, recordedTarget?: string) =>
    decideTailscaleServeClaim({
      config,
      servePort,
      target: LOOM,
      recordedTarget: recordedTarget ?? null,
    });

  it.effect("refuses ports another app serves and claims free or own ones", () =>
    Effect.gen(function* () {
      const shared = yield* parse(SHARED_MAC_SERVE_STATUS);
      assert.deepEqual(decide(shared, 443), {
        _tag: "HeldByOther",
        holder: "http://127.0.0.1:8397",
      });
      assert.deepEqual(decide(shared, 8443), { _tag: "TcpForward", holder: "127.0.0.1:8322" });
      assert.deepEqual(decide(shared, 9443), { _tag: "Free" });

      const own = yield* parse(webServe(443, { "/": { Proxy: `${LOOM}/` } }));
      assert.deepEqual(decide(own, 443), { _tag: "Ours", current: true });

      const mixed = yield* parse(
        webServe(443, { "/": { Proxy: LOOM }, "/grafana": { Proxy: "http://127.0.0.1:3000" } }),
      );
      assert.deepEqual(decide(mixed, 443), { _tag: "OtherMounts", mounts: ["/grafana"] });

      const files = yield* parse(webServe(443, { "/": { Path: "/Users/someone/site" } }));
      assert.deepEqual(decide(files, 443), {
        _tag: "HeldByOther",
        holder: "a file, text, or redirect handler",
      });

      const foreground = yield* parse(
        JSON.stringify({ Foreground: { session: { TCP: { "443": { HTTPS: true } } } } }),
      );
      assert.equal(decide(foreground, 443)._tag, "HeldByOther");
    }),
  );

  it.effect("recognizes Loom's mapping from before a crash, but not a foreign one", () =>
    Effect.gen(function* () {
      const stale = yield* parse(webServe(443, { "/": { Proxy: "http://127.0.0.1:13001" } }));
      assert.deepEqual(decide(stale, 443, "http://127.0.0.1:13001"), {
        _tag: "Ours",
        current: false,
      });
      assert.equal(decide(stale, 443)._tag, "HeldByOther");
      // Stopping releases only what proxies to the stopping server itself.
      assert.isFalse(decideTailscaleServeRelease({ config: stale, servePort: 443, target: LOOM }));
      assert.isTrue(
        decideTailscaleServeRelease({
          config: stale,
          servePort: 443,
          target: "http://127.0.0.1:13001",
        }),
      );
    }),
  );

  it.effect("matches an IPv6 loopback target the CLI stored without brackets", () =>
    Effect.gen(function* () {
      const config = yield* parse(webServe(443, { "/": { Proxy: "http://::1:13773" } }));
      assert.deepEqual(
        decideTailscaleServeClaim({
          config,
          servePort: 443,
          target: "http://[::1]:13773",
          recordedTarget: null,
        }),
        { _tag: "Ours", current: true },
      );
    }),
  );
});

describe("claimTailscaleServe", () => {
  it.effect("maps a free port and records the claim first", () => {
    const host = makeHost({ serveStatus: SHARED_MAC_SERVE_STATUS });
    return Effect.gen(function* () {
      const claim = yield* claimTailscaleServe({
        claimsPath: CLAIMS_PATH,
        servePort: 9443,
        localPort: 13773,
      });
      assert.deepEqual(claim, {
        baseUrl: "https://mac.tail1234.ts.net:9443/",
        target: LOOM,
        changed: true,
      });
      assert.deepEqual(host.mutations(), [["serve", "--bg", "--https=9443", LOOM]]);
      assert.deepEqual(host.recordedClaims(), { "9443": LOOM });
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("refuses another app's port without touching its mapping", () => {
    const host = makeHost({ serveStatus: SHARED_MAC_SERVE_STATUS });
    return Effect.gen(function* () {
      const error = yield* claimTailscaleServe({
        claimsPath: CLAIMS_PATH,
        servePort: 443,
        localPort: 13773,
      }).pipe(Effect.flip);
      assert.instanceOf(error, TailscaleServePortHeldError);
      assert.include(error.message, "http://127.0.0.1:8397");
      assert.include(error.message, "--set-path=/ off");
      assert.deepEqual(host.mutations(), []);
      assert.isUndefined(host.recordedClaims());
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("repoints Loom's own mapping left behind by a crash", () => {
    const host = makeHost({
      serveStatus: webServe(443, { "/": { Proxy: "http://127.0.0.1:13001" } }),
      claims: { "443": "http://127.0.0.1:13001" },
    });
    return Effect.gen(function* () {
      const claim = yield* claimTailscaleServe({
        claimsPath: CLAIMS_PATH,
        servePort: 443,
        localPort: 13773,
      });
      assert.isTrue(claim.changed);
      assert.deepEqual(host.mutations(), [["serve", "--bg", "--https=443", LOOM]]);
      assert.deepEqual(host.recordedClaims(), { "443": LOOM });
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("stops at status when the tailnet has HTTPS certificates off", () => {
    const host = makeHost({
      serveStatus: "{}",
      status: JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "mac.ts.net.", CapMap: {} },
      }),
    });
    return Effect.gen(function* () {
      const error = yield* claimTailscaleServe({
        claimsPath: CLAIMS_PATH,
        servePort: 443,
        localPort: 13773,
      }).pipe(Effect.flip);
      assert.instanceOf(error, TailscaleServeHttpsDisabledError);
      assert.deepEqual(host.calls, [["status", "--json"]]);
    }).pipe(Effect.provide(host.layer));
  });
});

describe("releaseTailscaleServe", () => {
  it.effect("removes only Loom's root mount and forgets the claim", () => {
    const host = makeHost({
      serveStatus: webServe(443, { "/": { Proxy: LOOM } }),
      claims: { "443": LOOM },
    });
    return Effect.gen(function* () {
      assert.isTrue(
        yield* releaseTailscaleServe({ claimsPath: CLAIMS_PATH, servePort: 443, localPort: 13773 }),
      );
      assert.deepEqual(host.mutations(), [["serve", "--https=443", "--set-path=/", "off"]]);
      assert.deepEqual(host.recordedClaims(), {});
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("leaves a port another app took over alone", () => {
    const host = makeHost({ serveStatus: SHARED_MAC_SERVE_STATUS, claims: { "443": LOOM } });
    return Effect.gen(function* () {
      assert.isFalse(
        yield* releaseTailscaleServe({ claimsPath: CLAIMS_PATH, servePort: 443, localPort: 13773 }),
      );
      assert.deepEqual(host.mutations(), []);
      assert.deepEqual(host.recordedClaims(), {});
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("keeps a newer Loom process's mapping and claim", () => {
    const newer = "http://127.0.0.1:13999";
    const host = makeHost({
      serveStatus: webServe(443, { "/": { Proxy: newer } }),
      claims: { "443": newer },
    });
    return Effect.gen(function* () {
      assert.isFalse(
        yield* releaseTailscaleServe({ claimsPath: CLAIMS_PATH, servePort: 443, localPort: 13773 }),
      );
      assert.deepEqual(host.mutations(), []);
      assert.deepEqual(host.recordedClaims(), { "443": newer });
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("treats a mapping that is already gone as released", () => {
    const host = makeHost({
      serveStatus: webServe(443, { "/": { Proxy: LOOM } }),
      offResult: { stderr: "error: handler does not exist", code: 1 },
    });
    return releaseTailscaleServe({
      claimsPath: CLAIMS_PATH,
      servePort: 443,
      localPort: 13773,
    }).pipe(
      Effect.map((released) => assert.isTrue(released)),
      Effect.provide(host.layer),
    );
  });
});

describe("inspectTailscaleServe", () => {
  it.effect("names what holds the chosen port and every other taken port", () => {
    const host = makeHost({ serveStatus: SHARED_MAC_SERVE_STATUS });
    return Effect.gen(function* () {
      const inspection = yield* inspectTailscaleServe({
        claimsPath: CLAIMS_PATH,
        servePort: 443,
        localPort: 13773,
      });
      assert.deepEqual(inspection, {
        state: "port-held",
        magicDnsName: "mac.tail1234.ts.net",
        holder: "http://127.0.0.1:8397",
        heldPorts: [
          { port: 443, holder: "http://127.0.0.1:8397" },
          { port: 8317, holder: "a TCP forward to 127.0.0.1:8321" },
          { port: 8443, holder: "a TCP forward to 127.0.0.1:8322" },
        ],
      });
      assert.deepEqual(host.mutations(), []);
    }).pipe(Effect.provide(host.layer));
  });

  it.effect("reports a logged-out tailnet", () => {
    const host = makeHost({ serveStatus: "{}", status: `{"BackendState":"NeedsLogin"}` });
    return inspectTailscaleServe({
      claimsPath: CLAIMS_PATH,
      servePort: 443,
      localPort: 13773,
    }).pipe(
      Effect.map((inspection) => assert.equal(inspection.state, "not-logged-in")),
      Effect.provide(host.layer),
    );
  });
});
