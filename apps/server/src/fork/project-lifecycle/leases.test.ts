// @effect-diagnostics nodeBuiltinImport:off - The docker lookup is tested against real files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";
import {
  DOCKER_MISS_RETRY_MS,
  ancestorsOf,
  dockerCandidates,
  liveProcess,
  makeDockerLocator,
  parseDocker,
  parseLedger,
  parseLsofListeners,
  parseProcessTable,
  parsePublishedPorts,
  parseRuntimeProcesses,
  parseSlotHolder,
  partitionListeners,
  signallable,
  withDescendants,
} from "./leases.ts";

const table = parseProcessTable(
  [
    "    1     0 Thu Oct  1 09:00:00 2026",
    "  100     1 Thu Oct  8 12:00:00 2026",
    "  200   100 Thu Oct  8 12:00:01 2026",
    "  201   200 Thu Oct  8 12:00:02 2026",
    "  300     1 Thu Oct  8 12:00:03 2026",
    "garbage",
  ].join("\n"),
);

describe("ledger", () => {
  it("keeps the latest entry per lease and skips lines it cannot use", () => {
    expect(
      parseLedger(
        [
          "process\t200\tweb\tThu Oct  8 12:00:01 2026",
          "simulator\tUDID-1\tPhone\t1790000000",
          "process\tnot-a-pid\tbad\tx",
          "volume\tdb\tignored\t0",
          "simulator\tUDID-1\tRenamed\t1790000001",
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "process", ref: "200", label: "web", stamp: "Thu Oct 8 12:00:01 2026" },
      { kind: "simulator", ref: "UDID-1", label: "Renamed", stamp: "1790000001" },
    ]);
  });

  it("counts a process only while the same pid has the same start time", () => {
    const [entry] = parseLedger("process\t200\tweb\tThu Oct 8 12:00:01 2026");
    expect(liveProcess(table, entry!)).toBe(true);
    const [reused] = parseLedger("process\t200\tweb\tWed Oct 7 08:00:00 2026");
    expect(liveProcess(table, reused!)).toBe(false);
  });
});

describe("process tree", () => {
  it("finds every descendant of the roots and every ancestor of a process", () => {
    expect([...withDescendants(table, [100, 999])].sort()).toEqual([100, 200, 201]);
    expect([...ancestorsOf(table, 201)].sort()).toEqual([100, 200, 201]);
  });
});

describe("tool output", () => {
  it("reads labelled Docker resources, lsof pids and slot holders", () => {
    expect(parseDocker("container", "abc\tlane-1\tdb\trunning\n\tlane-2\n")).toEqual([
      { kind: "container", ref: "abc", laneId: "lane-1", label: "db (running)" },
    ]);
    expect(parseDocker("volume", "data\tlane-1\n")).toEqual([
      { kind: "volume", ref: "data", laneId: "lane-1", label: "data" },
    ]);
    expect(
      parseSlotHolder(
        2,
        "200\tThu Oct  8 12:00:01 2026\t/lanes/app/main/space\txcodebuild build\n",
      ),
    ).toEqual({
      slot: 2,
      pid: 200,
      started: "Thu Oct 8 12:00:01 2026",
      spacePath: "/lanes/app/main/space",
      command: "xcodebuild build",
    });
    expect(parseSlotHolder(1, "")).toBeNull();
  });
});

describe("container runtimes", () => {
  it("reads lane listeners with their command and ports", () => {
    expect(
      parseLsofListeners(
        [
          "p12",
          "cnode",
          "f17",
          "n127.0.0.1:41003",
          "f18",
          "n[::1]:41004",
          "p34",
          "ccom.docker.backend",
          "f159",
          "n*:41005",
          "pnot-a-pid",
          "cignored",
          "",
        ].join("\n"),
      ),
    ).toEqual(
      new Map([
        [12, { command: "node", ports: new Set([41003, 41004]) }],
        [34, { command: "com.docker.backend", ports: new Set([41005]) }],
      ]),
    );
  });

  it("reads the host ports running containers publish", () => {
    expect(
      parsePublishedPorts(
        [
          "127.0.0.1:41003->80/tcp, [::]:41003->80/tcp",
          "4319/tcp",
          "0.0.0.0:41010-41012->80-82/tcp, 53/udp",
          ":::41020->5432/tcp",
          "",
        ].join("\n"),
      ),
    ).toEqual(new Set([41003, 41010, 41011, 41012, 41020]));
  });

  it("spares a published port's listener and a runtime's forwarder, but not lane servers", () => {
    const listeners = new Map([
      [10, { command: "node", ports: new Set([41001]) }],
      [20, { command: "mystery-forwarder", ports: new Set([41003]) }],
      [30, { command: "com.docker.backend", ports: new Set([41004]) }],
      [40, { command: "OrbStack Helper", ports: new Set([41005]) }],
    ]);
    expect(partitionListeners(listeners, new Set([41003]))).toEqual({
      lane: new Set([10]),
      runtime: new Set([20, 30, 40]),
    });
    // Docker not running: no port can be shown to be published, so only names spare a process.
    expect(partitionListeners(listeners, null)).toEqual({
      lane: new Set([10, 20]),
      runtime: new Set([30, 40]),
    });
  });

  it("finds runtime processes by the name or path ps prints", () => {
    expect(
      parseRuntimeProcesses(
        [
          "    1 /sbin/launchd",
          "23660 /Applications/Docker.app/Contents/MacOS/com.docker.backend",
          "  412 /Applications/OrbStack.app/Contents/MacOS/OrbStack Helper",
          "  500 docker-proxy",
          "  600 com.docker.back",
          "  700 node",
          "  800 /Users/me/docker/server",
          "",
        ].join("\n"),
      ),
    ).toEqual(new Set([23660, 412, 500, 600]));
  });

  it("never signals this server, init or a whole process group", () => {
    expect(signallable(process.pid)).toBe(false);
    expect([0, 1, -5, Number.NaN].map(signallable)).toEqual([false, false, false, false]);
    expect(signallable(process.pid + 1)).toBe(true);
  });

  it("looks for Docker Desktop and OrbStack outside PATH", () => {
    expect(dockerCandidates("/Users/me", "/usr/bin:/bin")).toEqual([
      "/usr/bin/docker",
      "/bin/docker",
      "/Users/me/.docker/bin/docker",
      "/usr/local/bin/docker",
      "/opt/homebrew/bin/docker",
      "/Applications/Docker.app/Contents/Resources/bin/docker",
      "/Users/me/.orbstack/bin/docker",
    ]);
  });

  it.effect("looks for docker again a minute after a miss", () =>
    Effect.gen(function* () {
      const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "loom-docker-"));
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
      );
      const docker = NodePath.join(dir, "docker");
      const locate = makeDockerLocator(() => [docker]);

      expect(yield* locate).toBeNull();
      NodeFS.writeFileSync(docker, "#!/bin/sh\n", { mode: 0o755 });
      // A miss is trusted for a while, so a missing Docker costs no lookups every scan.
      yield* TestClock.adjust(DOCKER_MISS_RETRY_MS - 1);
      expect(yield* locate).toBeNull();
      yield* TestClock.adjust(1);
      expect(yield* locate).toBe(docker);
    }).pipe(Effect.scoped),
  );
});
