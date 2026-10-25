import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopShutdown from "../../app/DesktopShutdown.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import {
  compactBeforeBackendStart,
  interpretDoctorOutput,
  parseSqliteHeader,
  planRestartCompaction,
  type SqliteHeader,
} from "./RestartCompaction.ts";

const GiB = 1024 ** 3;

const sqliteHeader = (input: {
  readonly pageSize?: number;
  readonly pageCount: number;
  readonly freelistPages: number;
  readonly autoVacuum: "none" | "full" | "incremental";
  readonly pageCountCurrent?: boolean;
}) => {
  const bytes = new Uint8Array(100);
  bytes.set(new TextEncoder().encode("SQLite format 3\u0000"));
  const view = new DataView(bytes.buffer);
  const pageSize = input.pageSize ?? 4096;
  view.setUint16(16, pageSize === 65_536 ? 1 : pageSize);
  view.setUint32(24, 7);
  view.setUint32(28, input.pageCount);
  view.setUint32(36, input.freelistPages);
  view.setUint32(52, input.autoVacuum === "none" ? 0 : 3);
  view.setUint32(64, input.autoVacuum === "incremental" ? 1 : 0);
  view.setUint32(92, input.pageCountCurrent === false ? 6 : 7);
  return bytes;
};

// The live statev2.sqlite header measured for the audit.
const auditedHeader: SqliteHeader = {
  pageSize: 4096,
  pageCount: 5_997_309,
  freelistPages: 2_623_132,
  incrementalVacuum: false,
};

describe("parseSqliteHeader", () => {
  it("reads the sizes and auto_vacuum mode the doctor decides on", () => {
    const bytes = sqliteHeader({ ...auditedHeader, autoVacuum: "none" });
    assert.deepEqual(parseSqliteHeader(bytes, 0), auditedHeader);
    assert.isTrue(
      parseSqliteHeader(
        sqliteHeader({ pageCount: 10, freelistPages: 0, autoVacuum: "incremental" }),
        0,
      )?.incrementalVacuum,
    );
    // Full auto_vacuum is not incremental; the doctor still converts it.
    assert.isFalse(
      parseSqliteHeader(sqliteHeader({ pageCount: 10, freelistPages: 0, autoVacuum: "full" }), 0)
        ?.incrementalVacuum,
    );
  });

  it("falls back to the file size when the header page count is stale", () => {
    const bytes = sqliteHeader({
      pageSize: 65_536,
      pageCount: 3,
      freelistPages: 0,
      autoVacuum: "none",
      pageCountCurrent: false,
    });
    assert.deepInclude(parseSqliteHeader(bytes, 10 * 65_536), { pageSize: 65_536, pageCount: 10 });
  });

  it("rejects a file that is not a SQLite database", () => {
    assert.isNull(parseSqliteHeader(new TextEncoder().encode("x".repeat(100)), 100));
    assert.isNull(parseSqliteHeader(new Uint8Array(20), 20));
  });
});

describe("planRestartCompaction", () => {
  const launch = {
    requested: false,
    versionChanged: true,
    lastOutcome: null,
    header: auditedHeader,
    freeDiskBytes: 56 * GiB,
  } as const;

  it("compacts the audited database at the first launch of an update", () => {
    assert.deepEqual(planRestartCompaction(launch), {
      _tag: "Run",
      liveBytes: (5_997_309 - 2_623_132) * 4096,
      reclaimableBytes: 2_623_132 * 4096,
    });
  });

  it("leaves an ordinary launch and a compact database alone", () => {
    assert.deepEqual(planRestartCompaction({ ...launch, versionChanged: false }), {
      _tag: "Skip",
      record: null,
    });
    const compact = { ...auditedHeader, freelistPages: 1000, incrementalVacuum: true };
    assert.deepEqual(planRestartCompaction({ ...launch, header: compact }), {
      _tag: "Skip",
      record: null,
    });
    assert.deepEqual(planRestartCompaction({ ...launch, header: compact, requested: true }), {
      _tag: "Skip",
      record: "The database was already compact.",
    });
  });

  it("repeats a failed or stopped repair only when Settings asks", () => {
    for (const lastOutcome of ["failed", "interrupted"] as const) {
      assert.equal(planRestartCompaction({ ...launch, lastOutcome })._tag, "Skip");
      assert.equal(
        planRestartCompaction({ ...launch, lastOutcome, versionChanged: false, requested: true })
          ._tag,
        "Run",
      );
    }
  });

  it("records a skip when the disk cannot hold the copies VACUUM writes", () => {
    const plan = planRestartCompaction({ ...launch, freeDiskBytes: 20 * GiB });
    assert.equal(plan._tag, "Skip");
    assert.match(
      plan._tag === "Skip" ? (plan.record ?? "") : "",
      /^Compacting needs 26\.\d\d GiB free on this disk, and 20\.00 GiB was free\.$/,
    );
  });
});

describe("interpretDoctorOutput", () => {
  it("reports what the repair reclaimed", () => {
    assert.deepEqual(
      interpretDoctorOutput(0, [
        "Database: 22.88 GiB, 10.01 GiB reclaimable.",
        "Reclaiming database space. This can take several minutes...",
        "Done: 22.88 GiB -> 12.87 GiB, 1817 superseded events removed.",
      ]),
      {
        outcome: "completed",
        detail: "Compacted: 22.88 GiB -> 12.87 GiB, 1817 superseded events removed.",
      },
    );
    assert.equal(interpretDoctorOutput(0, ["No recommended repairs; nothing changed."]).outcome, "skipped");
  });

  it("keeps the error message from the CLI's failure log, not its stack", () => {
    assert.deepEqual(
      interpretDoctorOutput(1, [
        "[16:59:44.912] ERROR (#2): DatabaseInUseError: Stop the Loom server and desktop app, including any version before 0.1.0, before repairing the database.",
        "    at file:///app/apps/server/src/persistence/DatabaseMaintenance.ts:155:21",
      ]),
      {
        outcome: "failed",
        detail: "Stop the Loom server and desktop app, including any version before 0.1.0, before repairing the database.",
      },
    );
    assert.deepEqual(interpretDoctorOutput(134, ["Abort trap"]), {
      outcome: "failed",
      detail: "The repair stopped with exit code 134.",
    });
  });
});

interface DoctorRun {
  readonly args: ReadonlyArray<string>;
  readonly env: Record<string, string | undefined>;
}

const restartHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "restart-compaction-" });
  const stateDir = path.join(baseDir, "userdata");
  yield* fs.makeDirectory(stateDir, { recursive: true });
  yield* fs.writeFile(
    path.join(stateDir, "statev2.sqlite"),
    sqliteHeader({ pageCount: 2_000, freelistPages: 1_000, autoVacuum: "none" }),
  );
  const runs: Array<DoctorRun> = [];
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    path,
    baseDir,
    stateDir,
    appVersion: "1.2.4",
    backendEntryPath: "/app/apps/server/dist/bin.mjs",
    backendCwd: baseDir,
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);
  const layerFor = (doctor: { readonly output: string; readonly exitCode: Effect.Effect<number> }) =>
    Layer.mergeAll(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
      DesktopState.layer,
      DesktopShutdown.layer,
      Layer.mock(ElectronApp.ElectronApp)({ onBeforeQuitForUpdate: () => Effect.void }),
      Layer.mock(DesktopWindow.DesktopWindow)({ showSplash: () => Effect.succeedNone }),
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) =>
          Effect.sync(() => {
            const { args, options } = command as unknown as {
              readonly args: ReadonlyArray<string>;
              readonly options: { readonly env: Record<string, string | undefined> };
            };
            runs.push({ args, env: options.env });
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.map(doctor.exitCode, ChildProcessSpawner.ExitCode),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              unref: Effect.succeed(Effect.void),
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.make(new TextEncoder().encode(doctor.output)),
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
            });
          }),
        ),
      ),
    );
  const readState = (name: string) =>
    fs.readFileString(path.join(stateDir, name)).pipe(Effect.orElseSucceed(() => null));
  const request = fs.writeFileString(path.join(stateDir, "compact-at-restart"), "now");
  return { baseDir, runs, layerFor, readState, request };
});

it.layer(NodeServices.layer)("compactBeforeBackendStart", (it) => {
  it.effect("compacts once at the first launch of a version and records the result", () =>
    Effect.gen(function* () {
      const harness = yield* restartHarness;
      const doctor = harness.layerFor({
        output: "Done: 7.8 MiB -> 3.9 MiB, 0 superseded events removed.\n",
        exitCode: Effect.succeed(0),
      });

      yield* compactBeforeBackendStart.pipe(Effect.provide(doctor));
      assert.deepEqual(harness.runs[0]?.args, [
        "/app/apps/server/dist/bin.mjs",
        "doctor",
        "--base-dir",
        harness.baseDir,
        "--fix",
      ]);
      assert.equal(harness.runs[0]?.env.ELECTRON_RUN_AS_NODE, "1");
      assert.deepInclude(JSON.parse((yield* harness.readState("restart-compaction.json")) ?? ""), {
        outcome: "completed",
        detail: "Compacted: 7.8 MiB -> 3.9 MiB, 0 superseded events removed.",
      });
      assert.equal(yield* harness.readState("restart-compaction-version"), "1.2.4");

      // The next launch of the same version starts the backend straight away.
      yield* compactBeforeBackendStart.pipe(Effect.provide(doctor));
      assert.equal(harness.runs.length, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("answers a Settings request and records why the repair failed", () =>
    Effect.gen(function* () {
      const harness = yield* restartHarness;
      yield* harness.request;
      yield* compactBeforeBackendStart.pipe(
        Effect.provide(
          harness.layerFor({
            output:
              "[10:00:00.000] ERROR (#2): DatabaseCompactError: Database compaction failed. Check that no other process has the database open and enough disk space is available.\n",
            exitCode: Effect.succeed(1),
          }),
        ),
      );
      assert.deepInclude(JSON.parse((yield* harness.readState("restart-compaction.json")) ?? ""), {
        outcome: "failed",
        detail:
          "Database compaction failed. Check that no other process has the database open and enough disk space is available.",
      });
      assert.isNull(yield* harness.readState("compact-at-restart"));
    }).pipe(Effect.scoped),
  );

  it.effect("stops the repair when Loom quits and records that nothing changed", () =>
    Effect.gen(function* () {
      const harness = yield* restartHarness;
      const started = yield* Deferred.make<void>();
      const layer = harness.layerFor({
        output: "",
        exitCode: Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
      });
      yield* Effect.gen(function* () {
        const shutdown = yield* DesktopShutdown.DesktopShutdown;
        const run = yield* Effect.forkChild(compactBeforeBackendStart);
        yield* Deferred.await(started);
        yield* shutdown.request;
        yield* Fiber.join(run);
      }).pipe(Effect.provide(layer));
      assert.deepInclude(JSON.parse((yield* harness.readState("restart-compaction.json")) ?? ""), {
        outcome: "interrupted",
        detail: "Loom quit before compaction finished. Nothing was lost.",
      });
    }).pipe(Effect.scoped),
  );
});
