import { assert, describe, it } from "@effect/vitest";
import type {
  ProcessIdentity,
  ProviderProcessRecord,
} from "@t3tools/shared/fork/provider-processes";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as PlatformError from "effect/PlatformError";
import * as References from "effect/References";
import * as TestClock from "effect/testing/TestClock";

import * as OrphanedProviders from "./OrphanedProviders.ts";

const LEDGER_PATH = "/state/runtime/provider-processes.json";
const STARTED = "Sun Oct 25 10:00:00 2026";
const REUSED = "Sun Oct 25 11:30:00 2026";

const desktop: ProcessIdentity = { pid: 100, pgid: 100, lstart: "Sun Oct 25 09:00:00 2026" };
const backend: ProcessIdentity = { pid: 200, pgid: 200, lstart: "Sun Oct  5 09:00:01 2026" };

const leader = (pid: number): ProcessIdentity => ({ pid, pgid: pid, lstart: STARTED });
const record = (process: ProcessIdentity, owner = backend): ProviderProcessRecord => ({
  ...process,
  owner,
  threadId: `thread-${process.pid}`,
});
const ledger = (...processes: ReadonlyArray<ProviderProcessRecord>) =>
  JSON.stringify({ version: 1, processes });

interface Scenario {
  /** The ledger's text or read failure; absent when the file does not exist. */
  readonly ledger?: string | PlatformError.PlatformError;
  /** Processes running when the backend exits, besides the desktop and the backend. */
  readonly running?: ReadonlyArray<ProcessIdentity>;
  /** Processes that outlive SIGTERM. */
  readonly ignoresTerm?: ReadonlyArray<number>;
  readonly platform?: NodeJS.Platform;
  /** False when `ps` fails right after spawn, so the backend is never identified. */
  readonly identified?: boolean;
  readonly table?: OrphanedProviders.ProcessHostShape["table"];
}

/** Starts and exits one backend run against a fake process table; nothing real is signalled. */
const runBackend = Effect.fn("test.runBackend")(function* (scenario: Scenario) {
  const processes = new Map(
    [desktop, backend, ...(scenario.running ?? [])].map((process) => [process.pid, process]),
  );
  const ignoresTerm = new Set(scenario.ignoresTerm);
  const signals: Array<readonly [number, OrphanedProviders.ProcessSignal]> = [];
  const fileCalls: Array<string> = [];
  const logs: Array<{ readonly level: string; readonly annotations: Record<string, unknown> }> = [];

  const host: OrphanedProviders.ProcessHostShape = {
    pid: desktop.pid,
    inspect: (pid) =>
      scenario.identified === false
        ? Effect.fail(
            new OrphanedProviders.ProcessHostError({ operation: "inspect", cause: "timed out" }),
          )
        : Effect.sync(() => processes.get(pid) ?? null),
    table: scenario.table ?? Effect.sync(() => new Map(processes)),
    signal: (pgid, signal) =>
      Effect.sync(() => {
        signals.push([pgid, signal]);
        for (const process of processes.values()) {
          if (process.pgid !== pgid) continue;
          if (signal === "SIGKILL" || !ignoresTerm.has(process.pid)) processes.delete(process.pid);
        }
      }),
  };
  const write = (method: string) => () =>
    Effect.sync(() => {
      fileCalls.push(method);
    });
  const fileSystem = FileSystem.layerNoop({
    readFileString: (path) =>
      Effect.suspend(() => {
        fileCalls.push(`read ${path}`);
        const contents = scenario.ledger;
        if (contents === undefined) {
          return Effect.fail(
            PlatformError.systemError({
              _tag: "NotFound",
              module: "FileSystem",
              method: "readFileString",
              pathOrDescriptor: path,
            }),
          );
        }
        return typeof contents === "string" ? Effect.succeed(contents) : Effect.fail(contents);
      }),
    writeFile: write("writeFile"),
    writeFileString: write("writeFileString"),
    rename: write("rename"),
    remove: write("remove"),
    truncate: write("truncate"),
  });
  const logger = Logger.make(({ fiber, logLevel }) => {
    logs.push({
      level: logLevel,
      annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
    });
  });

  yield* Effect.gen(function* () {
    const orphanedProviders = yield* OrphanedProviders.make;
    const providers = yield* orphanedProviders.watch(LEDGER_PATH);
    yield* providers.started(backend.pid);
    processes.delete(backend.pid);
    const exited = yield* Effect.forkChild(providers.exited);
    yield* TestClock.adjust(OrphanedProviders.CLEANUP_TIMEOUT);
    yield* Fiber.join(exited);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        fileSystem,
        Layer.succeed(OrphanedProviders.ProviderProcessHost, host),
        Layer.succeed(HostProcess.Platform, scenario.platform ?? "darwin"),
        Logger.layer([logger], { mergeWithExisting: false }),
      ),
    ),
  );

  const summary = logs.find((log) => "stopped" in log.annotations);
  return {
    signals,
    fileCalls,
    running: [...processes.keys()],
    summary:
      summary === undefined
        ? undefined
        : {
            level: summary.level,
            stopped: summary.annotations.stopped,
            leftRunning: summary.annotations.leftRunning,
          },
  };
});

describe("OrphanedProviders", () => {
  it.effect("stops only the groups the exited backend owned", () =>
    Effect.gen(function* () {
      const otherServer = { pid: 300, pgid: 300, lstart: STARTED };
      const earlierBackend = { ...backend, lstart: "Sat Oct 24 09:00:01 2026" };
      const result = yield* runBackend({
        running: [leader(500), leader(600), leader(700), otherServer],
        ledger: ledger(
          record(leader(500)),
          record(leader(600), otherServer),
          record(leader(700), earlierBackend),
        ),
      });

      assert.deepEqual(result.signals, [[500, "SIGTERM"]]);
      assert.deepEqual(result.running.toSorted(), [100, 300, 600, 700]);
      assert.deepEqual(result.summary, { level: "Info", stopped: 1, leftRunning: 0 });
    }),
  );

  it.effect("skips a provider whose PID was reused or whose group changed", () =>
    Effect.gen(function* () {
      const result = yield* runBackend({
        running: [
          { pid: 500, pgid: 500, lstart: REUSED },
          { pid: 600, pgid: 650, lstart: STARTED },
        ],
        ledger: ledger(record(leader(500)), record(leader(600))),
      });

      assert.deepEqual(result.signals, []);
      // A changed group no longer proves ownership, so that provider is reported, not stopped.
      assert.deepEqual(result.summary, { level: "Warn", stopped: 0, leftRunning: 1 });
    }),
  );

  it.effect("stops nothing when the backend was never identified", () =>
    Effect.gen(function* () {
      const result = yield* runBackend({
        identified: false,
        running: [leader(500)],
        ledger: ledger(record(leader(500))),
      });

      assert.deepEqual(result.signals, []);
      assert.deepEqual(result.fileCalls, []);
    }),
  );

  it.effect("stops nothing when the ledger is missing or unreadable", () =>
    Effect.gen(function* () {
      const unreadable = [
        undefined,
        "{",
        JSON.stringify({ version: 2, processes: [record(leader(500))] }),
        PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "readFileString",
          pathOrDescriptor: LEDGER_PATH,
        }),
      ];
      for (const contents of unreadable) {
        const result = yield* runBackend({
          running: [leader(500)],
          ...(contents === undefined ? {} : { ledger: contents }),
        });
        assert.deepEqual(result.signals, []);
      }
    }),
  );

  it.effect("escalates to SIGKILL only for a group with a pinned member still running", () =>
    Effect.gen(function* () {
      // 501 is a plugin child that ignores TERM after its leader exits.
      const pluginChild = { pid: 501, pgid: 500, lstart: STARTED };
      const result = yield* runBackend({
        running: [leader(500), pluginChild, leader(600)],
        ignoresTerm: [501],
        ledger: ledger(record(leader(500)), record(leader(600))),
      });

      assert.deepEqual(result.signals, [
        [500, "SIGTERM"],
        [600, "SIGTERM"],
        [500, "SIGKILL"],
      ]);
      assert.deepEqual(result.summary, { level: "Info", stopped: 2, leftRunning: 0 });
    }),
  );

  it.effect("reads the ledger without changing it", () =>
    Effect.gen(function* () {
      const result = yield* runBackend({
        running: [leader(500)],
        ledger: ledger(record(leader(500))),
      });

      assert.deepEqual(result.signals, [[500, "SIGTERM"]]);
      assert.deepEqual(result.fileCalls, [`read ${LEDGER_PATH}`]);
    }),
  );

  it.effect("never signals the desktop's own process group", () =>
    Effect.gen(function* () {
      const inDesktopGroup = { pid: 500, pgid: desktop.pgid, lstart: STARTED };
      const result = yield* runBackend({
        running: [inDesktopGroup],
        ledger: ledger(record(inDesktopGroup)),
      });

      assert.deepEqual(result.signals, []);
      assert.deepEqual(result.summary, { level: "Warn", stopped: 0, leftRunning: 1 });
    }),
  );

  it.effect("does nothing on Windows", () =>
    Effect.gen(function* () {
      const result = yield* runBackend({
        platform: "win32",
        running: [leader(500)],
        ledger: ledger(record(leader(500))),
      });

      assert.deepEqual(result.signals, []);
      assert.deepEqual(result.fileCalls, []);
    }),
  );

  it.effect("gives up within its bound when ps hangs", () =>
    Effect.gen(function* () {
      const result = yield* runBackend({
        running: [leader(500)],
        ledger: ledger(record(leader(500))),
        table: Effect.never,
      });

      assert.deepEqual(result.signals, []);
    }),
  );
});
