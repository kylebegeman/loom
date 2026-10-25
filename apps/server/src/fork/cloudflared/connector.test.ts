// @effect-diagnostics nodeBuiltinImport:off - The fake connector is a real shell script in a temp folder.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as RelayClient from "@t3tools/shared/relayClient";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import * as TestConsole from "effect/testing/TestConsole";

import {
  classifyTokenRefusal,
  makeCloudflaredRunner,
  type CloudflaredStatus,
} from "./connector.ts";

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

const startTunnel = (
  executablePath: string,
  tokenFile: string,
  onTokenRefused?: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const statuses = yield* Queue.unbounded<CloudflaredStatus>();
    const fiber = yield* runTestTunnel({
      token: TOKEN,
      tokenFile,
      onStatus: (status) => Queue.offer(statuses, status).pipe(Effect.asVoid),
      ...(onTokenRefused === undefined ? {} : { onTokenRefused }),
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

const lines = (path: string) => NodeFS.readFileSync(path, "utf8").trim().split("\n");

const REFUSED = `ERR Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=0 event=0 ip=198.41.200.13`;
const INITIAL_GAVE_UP = `ERR initial tunnel connection failed error="Unauthorized: Invalid tunnel secret"`;
const DIAL_FAILED = `ERR Failed to dial a quic connection error="failed to dial to edge with quic: timeout: no recent network activity" connIndex=0 event=0 addr=198.41.192.167:7844`;

/** A connector that logs `logs` on each run and exits 1, as cloudflared does once it gives up. */
const exitingConnector = (dir: string, logs: ReadonlyArray<string>) =>
  writeConnector(
    dir,
    [
      `echo run >> "$DIR/runs"`,
      ...logs.map((line) => `echo '2026-10-24T10:00:01Z ${line}'`),
      "exit 1",
    ].join("\n"),
  );

describe("classifyTokenRefusal", () => {
  it.each([
    [REFUSED, "refused"],
    [
      `2026-10-24T10:00:01Z ERR Register tunnel error from server side error="Unauthorized: Failed to get tunnel" connIndex=1 event=0 ip=198.41.192.7`,
      "refused",
    ],
    [
      `2026-10-24T10:00:01Z ERR Connection terminated error="Unauthorized: Tunnel not found" connIndex=2`,
      "refused",
    ],
    [`2026-10-24T10:00:32Z ${INITIAL_GAVE_UP}`, "gave-up"],
    [
      `2026-10-24T10:00:32Z ERR Connection terminated error="Unauthorized: Failed to get tunnel" connIndex=0`,
      "gave-up",
    ],
  ] as const)("reads %s as %s", (line, expected) => {
    expect(classifyTokenRefusal(line)).toBe(expected);
  });

  it.each([
    `2026-10-24T10:00:01Z ${DIAL_FAILED}`,
    `2026-10-24T10:00:01Z ERR Unable to establish connection with Cloudflare edge error="DialError: dial tcp 198.41.200.13:7844: i/o timeout" connIndex=0`,
    `2026-10-24T10:00:01Z ERR initial tunnel connection failed error="Application error 0x0 (remote)"`,
    `2026-10-24T10:00:01Z ERR Connection terminated error="lookup region1.v2.argotunnel.com: no such host" connIndex=0`,
    `2026-10-24T10:00:01Z INF Retrying connection in up to 2s connIndex=0 event=0 ip=198.41.200.13`,
    `2026-10-24T10:00:01Z WRN Register tunnel error error="Unauthorized: Invalid tunnel secret" connIndex=0`,
    `Unauthorized: Failed to get tunnel`,
    `2026-10-24T10:00:01Z ERR  error="origin responded 401 Unauthorized" connIndex=0 originService=http://127.0.0.1:3773`,
  ])("never reads a network or origin failure as a refused token: %s", (line) => {
    expect(classifyTokenRefusal(line)).toBeNull();
  });
});

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

  it.effect("stops for good once the edge refuses the token in two runs in a row", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const refused = yield* Deferred.make<void>();
      let refusals = 0;
      const tunnel = yield* startTunnel(
        exitingConnector(dir, [REFUSED, INITIAL_GAVE_UP]),
        NodePath.join(dir, "connector-token"),
        Effect.suspend(() => {
          refusals += 1;
          return Deferred.succeed(refused, undefined);
        }),
      );

      // One refused run can be edge propagation lag right after a rotation, so it restarts.
      yield* tunnel.takeUntil("error");
      yield* TestClock.adjust(Duration.seconds(1));
      expect((yield* tunnel.takeUntil("error")).at(-1)).toEqual({
        state: "error",
        message: INITIAL_GAVE_UP.slice("ERR ".length),
        metricsPort: null,
      });
      yield* Deferred.await(refused);
      yield* TestClock.adjust(Duration.minutes(5));
      yield* Fiber.interrupt(tunnel.fiber);

      expect(refusals).toBe(1);
      expect(lines(NodePath.join(dir, "runs"))).toEqual(["run", "run"]);
      const logs = JSON.stringify([
        ...(yield* TestConsole.logLines),
        ...(yield* TestConsole.errorLines),
      ]);
      expect(logs).toContain("Test tunnel connector stopped for good");
      expect(logs).not.toContain(TOKEN);
    }),
  );

  it.effect("ends a connector that stays up after the edge refused its token", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const refused = yield* Deferred.make<void>();
      // After it had connected, cloudflared gives up on connIndex=0 without exiting.
      const connector = writeConnector(
        dir,
        [
          `echo "$$" >> "$DIR/pids"`,
          `echo "2026-10-24T10:00:01Z INF Registered tunnel connection connIndex=0"`,
          `echo "2026-10-24T10:00:02Z INF Unregistered tunnel connection connIndex=0"`,
          `echo '2026-10-24T10:00:03Z ${REFUSED}'`,
          `echo '2026-10-24T10:00:34Z ERR Connection terminated error="Unauthorized: Invalid tunnel secret" connIndex=0'`,
          "exec sleep 600",
        ].join("\n"),
      );
      const tunnel = yield* startTunnel(
        connector,
        NodePath.join(dir, "connector-token"),
        Deferred.succeed(refused, undefined).pipe(Effect.asVoid),
      );

      expect((yield* tunnel.takeUntil("error")).map((status) => status.state)).toEqual([
        "starting",
        "connected",
        "starting",
        "starting",
        "starting",
        "error",
      ]);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* Deferred.await(refused);

      const pids = lines(NodePath.join(dir, "pids")).map(Number);
      expect(pids).toHaveLength(2);
      for (const pid of pids) {
        // Signal 0 only probes our own children: each run must have ended its child.
        expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      }
    }),
  );

  it.effect("waits for every connection of a cut-off tunnel to be refused before ending it", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const refused = yield* Deferred.make<void>();
      // A retired tunnel's connections fail at once, so cloudflared logs no unregistering for
      // them. connIndex=1 is still up when connIndex=0 gives up, so the tunnel still works then.
      const connector = writeConnector(
        dir,
        [
          `echo "$$" >> "$DIR/pids"`,
          `echo "2026-10-24T10:00:01Z INF Registered tunnel connection connIndex=0"`,
          `echo "2026-10-24T10:00:01Z INF Registered tunnel connection connIndex=1"`,
          `echo '2026-10-24T10:00:03Z ${REFUSED}'`,
          `echo '2026-10-24T10:00:34Z ERR Connection terminated error="Unauthorized: Invalid tunnel secret" connIndex=0'`,
          `echo '2026-10-24T10:00:35Z ERR Register tunnel error from server side error="Unauthorized: Invalid tunnel secret" connIndex=1'`,
          "exec sleep 600",
        ].join("\n"),
      );
      const tunnel = yield* startTunnel(
        connector,
        NodePath.join(dir, "connector-token"),
        Deferred.succeed(refused, undefined).pipe(Effect.asVoid),
      );

      const run = ["starting", "connected", "starting", "error"];
      expect((yield* tunnel.takeUntil("error")).map((status) => status.state)).toEqual(run);
      yield* TestClock.adjust(Duration.seconds(1));
      expect((yield* tunnel.takeUntil("error")).map((status) => status.state)).toEqual(run);
      yield* Deferred.await(refused);

      const pids = lines(NodePath.join(dir, "pids")).map(Number);
      expect(pids).toHaveLength(2);
      for (const pid of pids) {
        expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      }
    }),
  );

  it.effect("keeps restarting a network failure, and a refused token nothing can retire", () =>
    Effect.gen(function* () {
      const dir = yield* tempDir;
      const neverRefused = yield* Deferred.make<void>();
      const dialing = yield* startTunnel(
        exitingConnector(NodeFS.mkdtempSync(NodePath.join(dir, "dial-")), [DIAL_FAILED]),
        NodePath.join(dir, "dial-token"),
        Deferred.succeed(neverRefused, undefined).pipe(Effect.asVoid),
      );
      // A refusal that cloudflared's last verdict overrides: its network went away afterwards.
      const lostNetwork = yield* startTunnel(
        exitingConnector(NodeFS.mkdtempSync(NodePath.join(dir, "lost-")), [
          REFUSED,
          DIAL_FAILED,
          `ERR initial tunnel connection failed error="failed to dial to edge with quic: timeout: no recent network activity"`,
        ]),
        NodePath.join(dir, "lost-token"),
        Deferred.succeed(neverRefused, undefined).pipe(Effect.asVoid),
      );
      // Preview links pass no `onTokenRefused`, so their connectors never stop on their own.
      const previewDir = NodeFS.mkdtempSync(NodePath.join(dir, "preview-"));
      const preview = yield* startTunnel(
        exitingConnector(previewDir, [REFUSED, INITIAL_GAVE_UP]),
        NodePath.join(dir, "preview-token"),
      );

      // A third run can only start once the second one restarted instead of giving up.
      for (const delay of [1, 2]) {
        yield* dialing.takeUntil("error");
        yield* lostNetwork.takeUntil("error");
        yield* preview.takeUntil("error");
        yield* TestClock.adjust(Duration.seconds(delay));
      }
      yield* dialing.takeUntil("error");
      yield* lostNetwork.takeUntil("error");
      yield* preview.takeUntil("error");

      expect(yield* Deferred.isDone(neverRefused)).toBe(false);
      expect(lines(NodePath.join(previewDir, "runs"))).toEqual(["run", "run", "run"]);
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
