// @effect-diagnostics nodeBuiltinImport:off - The fake connector is a real shell script in a temp folder.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as RelayClient from "@t3tools/shared/relayClient";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import * as TestConsole from "effect/testing/TestConsole";

import { runPreviewTunnel } from "./tunnel.ts";
import type { PreviewTunnelStatus } from "./types.ts";

// Only ever written into the fake connector's source and the child's env, never read back from it.
const TOKEN = "eyJhIjoidGVzdC10dW5uZWwtdG9rZW4ifQ";

const tempDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-preview-tunnel-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

/** Writes an executable stand-in for cloudflared; `body` runs with all output on stderr. */
const writeConnector = (dir: string, body: string) => {
  const path = NodePath.join(dir, "cloudflared");
  NodeFS.writeFileSync(path, `#!/bin/sh\nexec 1>&2\nDIR='${dir}'\n${body}\n`, { mode: 0o755 });
  return path;
};

const fakeRelayClient = (
  resolved: RelayClient.RelayClientStatus,
  calls: { resolves: number },
  install: RelayClient.RelayClientShape["install"] = Effect.die("unused"),
) =>
  Layer.succeed(
    RelayClient.RelayClient,
    RelayClient.RelayClient.of({
      resolve: Effect.sync(() => {
        calls.resolves += 1;
        return resolved;
      }),
      install,
      installWithProgress: () => Effect.die("unused"),
      pruneManagedVersions: Effect.void,
    }),
  );

const available = (executablePath: string): RelayClient.RelayClientStatus => ({
  status: "available",
  executablePath,
  source: "path",
  version: RelayClient.CLOUDFLARED_VERSION,
});

/** Starts the supervisor in the test's scope and exposes every status it reports. */
const startTunnel = (relayClient: Layer.Layer<RelayClient.RelayClient>) =>
  Effect.gen(function* () {
    const statuses = yield* Queue.unbounded<PreviewTunnelStatus>();
    const reported: Array<PreviewTunnelStatus> = [];
    const fiber = yield* runPreviewTunnel({
      token: TOKEN,
      onStatus: (status) => {
        reported.push(status);
        return Queue.offer(statuses, status).pipe(Effect.asVoid);
      },
    }).pipe(Effect.provide(Layer.merge(relayClient, NodeServices.layer)), Effect.forkScoped);
    const next = Queue.take(statuses);
    const takeUntil = (state: PreviewTunnelStatus["state"]) =>
      Effect.gen(function* () {
        const seen: Array<PreviewTunnelStatus> = [];
        while (seen.at(-1)?.state !== state) seen.push(yield* next);
        return seen;
      });
    return { fiber, next, takeUntil, reported };
  });

const expectNoToken = (texts: ReadonlyArray<unknown>) => {
  for (const text of texts) expect(JSON.stringify(text)).not.toContain(TOKEN);
};

describe("preview tunnel", () => {
  it.effect("reports progress, the metrics port and the connection without the token", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const connector = writeConnector(
        dir,
        [
          `printf '%s' "$$" > "$DIR/pid"`,
          `printf '%s' "$*" > "$DIR/args"`,
          `if [ -n "$TUNNEL_TOKEN" ]; then printf yes > "$DIR/token-set"; else printf no > "$DIR/token-set"; fi`,
          `echo "2026-10-18T10:00:00Z INF Starting tunnel tunnelID=abc"`,
          `echo "2026-10-18T10:00:00Z INF Starting metrics server on 127.0.0.1:45678/metrics"`,
          `echo "2026-10-18T10:00:00Z ERR Failed to dial a quic connection error=\\"token ${TOKEN} rejected\\" connIndex=0"`,
          `echo "2026-10-18T10:00:01Z INF Registered tunnel connection connIndex=0 event=0 location=sjc01 protocol=quic"`,
          "exec sleep 600",
        ].join("\n"),
      );
      const calls = { resolves: 0 };
      const tunnel = yield* startTunnel(fakeRelayClient(available(connector), calls));

      expect(yield* tunnel.takeUntil("connected")).toEqual([
        { state: "starting", message: "Connecting to Cloudflare", metricsPort: null },
        { state: "starting", message: "Connecting to Cloudflare", metricsPort: 45678 },
        {
          state: "starting",
          message: 'Failed to dial a quic connection error="token <redacted> rejected" connIndex=0',
          metricsPort: 45678,
        },
        { state: "connected", message: null, metricsPort: 45678 },
      ]);
      expect(NodeFS.readFileSync(NodePath.join(dir, "args"), "utf8")).toBe(
        "tunnel --no-autoupdate --loglevel info --output default --metrics 127.0.0.1:0 run",
      );
      expect(NodeFS.readFileSync(NodePath.join(dir, "token-set"), "utf8")).toBe("yes");

      const pid = Number(NodeFS.readFileSync(NodePath.join(dir, "pid"), "utf8"));
      yield* Fiber.interrupt(tunnel.fiber);
      // Signal 0 only probes our own child: interruption must have ended it.
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      expect(calls.resolves).toBe(1);
      expectNoToken(tunnel.reported);
    }),
  );

  it.effect("restarts a connector that exits, backing off between attempts", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const connector = writeConnector(
        dir,
        [
          `echo run >> "$DIR/runs"`,
          `echo "2026-10-18T10:00:00Z ERR Provided Tunnel token is not valid: ${TOKEN}"`,
          "exit 1",
        ].join("\n"),
      );
      const calls = { resolves: 0 };
      const tunnel = yield* startTunnel(fakeRelayClient(available(connector), calls));
      const failed = {
        state: "error",
        message: "Provided Tunnel token is not valid: <redacted>",
        metricsPort: null,
      };

      expect(yield* tunnel.takeUntil("error")).toEqual([
        { state: "starting", message: "Connecting to Cloudflare", metricsPort: null },
        { ...failed, state: "starting" },
        failed,
      ]);

      yield* TestClock.adjust(Duration.millis(999));
      expect(calls.resolves).toBe(1);
      yield* TestClock.adjust(Duration.millis(1));
      expect(yield* tunnel.takeUntil("error")).toEqual([
        { state: "starting", message: "Connecting to Cloudflare", metricsPort: null },
        { ...failed, state: "starting" },
        failed,
      ]);
      expect(calls.resolves).toBe(2);

      yield* TestClock.adjust(Duration.millis(1_999));
      expect(calls.resolves).toBe(2);
      yield* TestClock.adjust(Duration.millis(1));
      yield* tunnel.takeUntil("error");
      expect(calls.resolves).toBe(3);
      expect(NodeFS.readFileSync(NodePath.join(dir, "runs"), "utf8")).toBe("run\nrun\nrun\n");

      expectNoToken(tunnel.reported);
      const logs = [...(yield* TestConsole.logLines), ...(yield* TestConsole.errorLines)];
      expect(JSON.stringify(logs)).toContain("Preview tunnel connector stopped");
      expectNoToken(logs);
    }),
  );

  it.effect("explains an exit with no error output", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const connector = writeConnector(dir, "exit 3");
      const tunnel = yield* startTunnel(fakeRelayClient(available(connector), { resolves: 0 }));
      expect((yield* tunnel.takeUntil("error")).at(-1)).toEqual({
        state: "error",
        message: "cloudflared stopped with exit code 3",
        metricsPort: null,
      });
    }),
  );

  it.effect("installs cloudflared when it is missing and retries a failed install", () =>
    Effect.gen(function* () {
      const calls = { resolves: 0 };
      const tunnel = yield* startTunnel(
        fakeRelayClient(
          { status: "missing", version: RelayClient.CLOUDFLARED_VERSION },
          calls,
          Effect.fail(
            new RelayClient.RelayClientInstallError({
              reason: "download_failed",
              message: "fetch failed",
            }),
          ),
        ),
      );
      const attempt = [
        { state: "starting", message: "Installing cloudflared", metricsPort: null },
        { state: "error", message: "Could not install cloudflared", metricsPort: null },
      ];
      expect(yield* tunnel.takeUntil("error")).toEqual(attempt);
      yield* TestClock.adjust(Duration.seconds(1));
      expect(yield* tunnel.takeUntil("error")).toEqual(attempt);
      expect(calls.resolves).toBe(2);
    }),
  );
});
