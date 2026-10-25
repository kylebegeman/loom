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

import { makeCloudflaredRunner, type CloudflaredStatus } from "./connector.ts";

// Only ever written into the token file, never into the fake connector or its environment.
const TOKEN = "eyJhIjoicmVhY2gtdHVubmVsLXRva2VuIn0";

const runTestTunnel = makeCloudflaredRunner({
  run: Effect.fn("TestTunnel.run"),
  preferPinned: Effect.fn("TestTunnel.preferPinned"),
  label: "Test tunnel",
});

const tempDir = Effect.acquireRelease(
  Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-cloudflared-"))),
  (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
);

/** cloudflared would read this in place of the token file, so the runner must not pass it on. */
const inheritedTunnelToken = Effect.acquireRelease(
  Effect.sync(() => {
    const saved = process.env.TUNNEL_TOKEN;
    process.env.TUNNEL_TOKEN = "inherited-tunnel-token";
    return saved;
  }),
  (saved) =>
    Effect.sync(() => {
      if (saved === undefined) delete process.env.TUNNEL_TOKEN;
      else process.env.TUNNEL_TOKEN = saved;
    }),
);

/** Writes an executable stand-in for cloudflared; `body` runs with all output on stderr. */
const writeConnector = (dir: string, body: string) => {
  const path = NodePath.join(dir, "cloudflared");
  NodeFS.writeFileSync(path, `#!/bin/sh\nexec 1>&2\nDIR='${dir}'\n${body}\n`, { mode: 0o755 });
  return path;
};

const relayClientAt = (executablePath: string) =>
  Layer.succeed(
    RelayClient.RelayClient,
    RelayClient.RelayClient.of({
      resolve: Effect.succeed({
        status: "available",
        executablePath,
        source: "path",
        version: RelayClient.CLOUDFLARED_VERSION,
      }),
      install: Effect.die("unused"),
      installWithProgress: () => Effect.die("unused"),
      pruneManagedVersions: Effect.void,
    }),
  );

const startTunnel = (executablePath: string, tokenFile: string) =>
  Effect.gen(function* () {
    const statuses = yield* Queue.unbounded<CloudflaredStatus>();
    const fiber = yield* runTestTunnel({
      token: TOKEN,
      tokenFile,
      onStatus: (status) => Queue.offer(statuses, status).pipe(Effect.asVoid),
    }).pipe(
      Effect.provide(Layer.merge(relayClientAt(executablePath), NodeServices.layer)),
      Effect.forkScoped,
    );
    const takeUntil = (state: CloudflaredStatus["state"]) =>
      Effect.gen(function* () {
        const seen: Array<CloudflaredStatus> = [];
        while (seen.at(-1)?.state !== state) seen.push(yield* Queue.take(statuses));
        return seen;
      });
    return { fiber, takeUntil };
  });

const permissions = (path: string) => NodeFS.statSync(path).mode & 0o777;

describe("cloudflared runner", () => {
  it.effect("hands the token over in an owner-only file and removes it with the child", () =>
    Effect.gen(function* () {
      yield* inheritedTunnelToken;
      const dir = yield* tempDir;
      const tokenFile = NodePath.join(dir, "state", "reach", "connector-token");
      const connector = writeConnector(
        dir,
        [
          `printf '%s' "$$" > "$DIR/pid"`,
          `printf '%s' "$*" > "$DIR/args"`,
          `printf '%s' "\${TUNNEL_TOKEN-unset}" > "$DIR/env-token"`,
          `echo "2026-10-24T10:00:01Z INF Registered tunnel connection connIndex=0"`,
          "exec sleep 600",
        ].join("\n"),
      );
      const tunnel = yield* startTunnel(connector, tokenFile);
      yield* tunnel.takeUntil("connected");

      expect(NodeFS.readFileSync(NodePath.join(dir, "args"), "utf8")).toBe(
        `tunnel --no-autoupdate --loglevel info --output default --metrics 127.0.0.1:0 run --token-file ${tokenFile}`,
      );
      expect(NodeFS.readFileSync(NodePath.join(dir, "env-token"), "utf8")).toBe("unset");
      expect(NodeFS.readFileSync(tokenFile, "utf8")).toBe(TOKEN);
      expect(permissions(tokenFile)).toBe(0o600);
      expect(permissions(NodePath.dirname(tokenFile))).toBe(0o700);

      const pid = Number(NodeFS.readFileSync(NodePath.join(dir, "pid"), "utf8"));
      yield* Fiber.interrupt(tunnel.fiber);
      // Signal 0 only probes our own child: interruption must have ended it.
      expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      expect(NodeFS.existsSync(tokenFile)).toBe(false);
    }),
  );

  it.effect("replaces a token file a crash left behind and writes it again for each start", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const tokenFile = NodePath.join(dir, "connector-token");
      NodeFS.writeFileSync(tokenFile, "stale-token", { mode: 0o644 });
      const connector = writeConnector(
        dir,
        [
          `ls -l '${tokenFile}' | cut -c1-10 >> "$DIR/modes"`,
          `cat '${tokenFile}' >> "$DIR/seen"`,
          `echo >> "$DIR/seen"`,
          "exit 1",
        ].join("\n"),
      );
      const tunnel = yield* startTunnel(connector, tokenFile);

      expect((yield* tunnel.takeUntil("error")).at(-1)).toEqual({
        state: "error",
        message: "cloudflared stopped with exit code 1",
        metricsPort: null,
      });
      expect(NodeFS.existsSync(tokenFile)).toBe(false);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* tunnel.takeUntil("error");
      expect(NodeFS.existsSync(tokenFile)).toBe(false);

      expect(NodeFS.readFileSync(NodePath.join(dir, "seen"), "utf8")).toBe(`${TOKEN}\n${TOKEN}\n`);
      expect(NodeFS.readFileSync(NodePath.join(dir, "modes"), "utf8")).toBe(
        "-rw-------\n-rw-------\n",
      );
      const logs = [...(yield* TestConsole.logLines), ...(yield* TestConsole.errorLines)];
      expect(JSON.stringify(logs)).toContain("Test tunnel connector stopped");
      expect(JSON.stringify(logs)).not.toContain(TOKEN);
    }),
  );

  it.effect("reports a token file it cannot write and never starts cloudflared", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const connector = writeConnector(dir, `echo run >> "$DIR/runs"\nexit 1`);
      NodeFS.writeFileSync(NodePath.join(dir, "not-a-folder"), "");
      const tunnel = yield* startTunnel(
        connector,
        NodePath.join(dir, "not-a-folder", "connector-token"),
      );

      expect(yield* tunnel.takeUntil("error")).toEqual([
        {
          state: "error",
          message: "Could not write the cloudflared token file",
          metricsPort: null,
        },
      ]);
      expect(NodeFS.existsSync(NodePath.join(dir, "runs"))).toBe(false);
    }),
  );
});
