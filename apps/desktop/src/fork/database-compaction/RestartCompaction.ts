// @effect-diagnostics nodeBuiltinImport:off - The free-space check needs statfs, which Effect's FileSystem does not expose.
import * as NodeFSP from "node:fs/promises";

import { DATABASE_COMPACTION_RECOMMENDED_BYTES } from "@t3tools/contracts";
import {
  DATABASE_COMPACTION_REQUEST_FILE,
  DATABASE_COMPACTION_RESULT_FILE,
  RestartCompactionResult,
  type RestartCompactionOutcome,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../../app/DesktopObservability.ts";
import * as DesktopShutdown from "../../app/DesktopShutdown.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import { backendChildEnvPatch } from "../../backend/DesktopBackendConfiguration.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopWindow from "../../window/DesktopWindow.ts";
import {
  SPLASH_SKIP_URL,
  buildCompactionSplashPage,
  buildStartingSplashPage,
  formatBytes,
} from "./RestartCompactionSplash.ts";

/** The state database `doctor --base-dir` repairs; see deriveServerPaths in apps/server. */
const DATABASE_FILE = "statev2.sqlite";
/** The version this desktop last launched, so the first launch of an update can compact. */
const VERSION_FILE = "restart-compaction-version";
/** VACUUM cannot report progress; a repair still running after this is stopped. */
export const COMPACTION_TIMEOUT = Duration.minutes(30);
/** SQLite rolls back an unfinished VACUUM, so a repair that ignores SIGTERM is killed soon after. */
const DOCTOR_TERMINATE_GRACE = Duration.seconds(2);
/** Head-room on top of the two copies VACUUM writes. */
const COMPACTION_DISK_MARGIN_BYTES = 1024 ** 3;
const SQLITE_HEADER_BYTES = 100;
const SQLITE_MAGIC = "SQLite format 3\u0000";
const OUTPUT_LINES_KEPT = 40;

const { logInfo, logWarning } = makeComponentLogger("restart-compaction");

export interface SqliteHeader {
  readonly pageSize: number;
  readonly pageCount: number;
  readonly freelistPages: number;
  readonly incrementalVacuum: boolean;
}

/**
 * Reads the accounting the doctor decides on from the file header, so planning
 * never opens the database. A header behind an unrecovered WAL only misjudges
 * sizes; the doctor inspects the real state before it repairs anything.
 */
export function parseSqliteHeader(bytes: Uint8Array, fileBytes: number): SqliteHeader | null {
  if (bytes.length < SQLITE_HEADER_BYTES) return null;
  if (String.fromCharCode(...bytes.subarray(0, SQLITE_MAGIC.length)) !== SQLITE_MAGIC) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawPageSize = view.getUint16(16);
  const pageSize = rawPageSize === 1 ? 65_536 : rawPageSize;
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) return null;
  // The in-header page count is current only when the change counter matches
  // the version-valid-for number; otherwise the file size is.
  const headerPageCount = view.getUint32(28);
  const pageCount =
    headerPageCount > 0 && view.getUint32(24) === view.getUint32(92)
      ? headerPageCount
      : Math.floor(fileBytes / pageSize);
  return {
    pageSize,
    pageCount,
    freelistPages: view.getUint32(36),
    // A largest root page means auto_vacuum is on; the flag at 64 makes it incremental.
    incrementalVacuum: view.getUint32(52) !== 0 && view.getUint32(64) !== 0,
  };
}

export type RestartCompactionPlan =
  | { readonly _tag: "Run"; readonly liveBytes: number; readonly reclaimableBytes: number }
  /** `record` is the skipped result to keep, or null when nothing worth showing happened. */
  | { readonly _tag: "Skip"; readonly record: string | null };

const skip = (record: string | null): RestartCompactionPlan => ({ _tag: "Skip", record });

export function planRestartCompaction(input: {
  readonly requested: boolean;
  readonly versionChanged: boolean;
  readonly lastOutcome: RestartCompactionOutcome | null;
  readonly header: SqliteHeader | null;
  readonly freeDiskBytes: number | null;
}): RestartCompactionPlan {
  if (!input.requested && !input.versionChanged) return skip(null);
  // An update never repeats a repair that failed or was stopped; Settings can ask again.
  if (!input.requested && (input.lastOutcome === "failed" || input.lastOutcome === "interrupted")) {
    return skip(null);
  }
  const header = input.header;
  if (header === null) return skip(input.requested ? "Loom found no database to compact." : null);
  const reclaimableBytes = header.freelistPages * header.pageSize;
  const liveBytes = Math.max(0, header.pageCount - header.freelistPages) * header.pageSize;
  // The doctor's own rule, so it never declines a repair started here.
  if (header.incrementalVacuum && reclaimableBytes < DATABASE_COMPACTION_RECOMMENDED_BYTES) {
    return skip(input.requested ? "The database was already compact." : null);
  }
  // VACUUM writes the live data to a temporary file and again to the WAL
  // before the original shrinks; both normally land on this disk.
  const neededBytes = 2 * liveBytes + COMPACTION_DISK_MARGIN_BYTES;
  if (input.freeDiskBytes === null) {
    return skip("Loom could not check the free disk space, so it did not compact.");
  }
  if (input.freeDiskBytes < neededBytes) {
    return skip(
      `Compacting needs ${formatBytes(neededBytes)} free on this disk, and ${formatBytes(input.freeDiskBytes)} was free.`,
    );
  }
  return { _tag: "Run", liveBytes, reclaimableBytes };
}

// The CLI logs a failure as `[time] ERROR (#fiber): SomeError: message`, then its stack.
const DOCTOR_ERROR_LINE = /\bERROR\b[^:]*:\s*(?:\w*Error:\s*)?(.+)$/;

export function interpretDoctorOutput(
  exitCode: number,
  lines: ReadonlyArray<string>,
): { readonly outcome: RestartCompactionOutcome; readonly detail: string } {
  const text = lines.map((line) => line.trim()).filter((line) => line.length > 0);
  if (exitCode === 0) {
    const done = text.findLast((line) => line.startsWith("Done: "));
    if (done !== undefined) {
      return { outcome: "completed", detail: `Compacted: ${done.slice("Done: ".length)}` };
    }
    if (text.some((line) => line === "Nothing to repair." || line.startsWith("No recommended"))) {
      return { outcome: "skipped", detail: "The database was already compact." };
    }
    return { outcome: "completed", detail: text.at(-1) ?? "The repair finished." };
  }
  const message = text.map((line) => DOCTOR_ERROR_LINE.exec(line)?.[1]).findLast(Boolean);
  return { outcome: "failed", detail: message ?? `The repair stopped with exit code ${exitCode}.` };
}

const readSqliteHeader = Effect.fn("desktop.restartCompaction.readHeader")(function* (
  file: string,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const info = yield* fs.stat(file);
      const handle = yield* fs.open(file, { flag: "r" });
      const bytes = yield* handle.readAlloc(SQLITE_HEADER_BYTES);
      return Option.isSome(bytes) ? parseSqliteHeader(bytes.value, Number(info.size)) : null;
    }),
  ).pipe(Effect.orElseSucceed(() => null));
});

const freeDiskBytes = (directory: string) =>
  Effect.tryPromise(() => NodeFSP.statfs(directory)).pipe(
    Effect.map((stats) => stats.bavail * stats.bsize),
    Effect.orElseSucceed(() => null),
  );

const ResultJson = Schema.fromJsonString(RestartCompactionResult);
const decodeResult = Schema.decodeUnknownEffect(ResultJson);
const encodeResult = Schema.encodeEffect(ResultJson);

const runDoctor = Effect.fn("desktop.restartCompaction.runDoctor")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const electronApp = yield* ElectronApp.ElectronApp;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(
          process.execPath,
          [environment.backendEntryPath, "doctor", "--base-dir", environment.baseDir, "--fix"],
          {
            cwd: environment.backendCwd,
            env: { ...backendChildEnvPatch(), ELECTRON_RUN_AS_NODE: "1" },
            extendEnv: true,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            killSignal: "SIGTERM",
            forceKillAfter: DOCTOR_TERMINATE_GRACE,
          },
        ),
      );
      // The updater quits as soon as this event returns, before any finalizer
      // runs, and a repair left behind would hold the database the update opens.
      yield* electronApp.onBeforeQuitForUpdate(() => {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {
          // Already exited.
        }
      });
      const lines: Array<string> = [];
      const [, exitCode] = yield* Effect.all(
        [
          Stream.decodeText(child.all).pipe(
            Stream.splitLines,
            Stream.runForEach((line) =>
              Effect.sync(() => {
                lines.push(line);
                if (lines.length > OUTPUT_LINES_KEPT) lines.shift();
              }),
            ),
          ),
          child.exitCode,
        ],
        { concurrency: 2 },
      );
      return interpretDoctorOutput(exitCode, lines);
    }),
  ).pipe(
    Effect.catch((error) =>
      Effect.succeed({
        outcome: "failed" as const,
        detail: `Loom could not run the repair: ${error.message}`,
      }),
    ),
  );
});

const runCompaction = Effect.fn("desktop.restartCompaction.run")(function* (
  reclaimableBytes: number,
) {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const startedAt = yield* Clock.currentTimeMillis;
  let shouldUseDarkColors = false;
  const splash = yield* desktopWindow.showSplash((dark) => {
    shouldUseDarkColors = dark;
    return buildCompactionSplashPage({ shouldUseDarkColors: dark, reclaimableBytes, startedAt });
  });
  const skipped = yield* Deferred.make<void>();
  if (Option.isSome(splash)) {
    const contents = splash.value.webContents;
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      event.preventDefault();
      if (url === SPLASH_SKIP_URL) Deferred.doneUnsafe(skipped, Effect.void);
    });
  }
  const result = yield* runDoctor().pipe(
    Effect.timeoutOption(COMPACTION_TIMEOUT),
    Effect.map(
      Option.getOrElse(() => ({
        outcome: "failed" as const,
        detail: `The repair did not finish within ${Duration.toMinutes(COMPACTION_TIMEOUT)} minutes, so Loom stopped it. Nothing was lost.`,
      })),
    ),
    // Losing either race kills the repair; SQLite rolls back the unfinished VACUUM.
    Effect.raceFirst(
      shutdown.awaitRequest.pipe(
        Effect.as({
          outcome: "interrupted" as const,
          detail: "Loom quit before compaction finished. Nothing was lost.",
        }),
      ),
    ),
    Effect.raceFirst(
      Deferred.await(skipped).pipe(
        Effect.as({
          outcome: "interrupted" as const,
          detail: "Compaction was skipped at startup. Nothing was lost.",
        }),
      ),
    ),
  );
  if (Option.isSome(splash) && !splash.value.isDestroyed()) {
    void splash.value.loadURL(buildStartingSplashPage(shouldUseDarkColors));
  }
  return result;
});

/**
 * Runs the doctor's database repair (VACUUM, turning on incremental
 * auto_vacuum) before the backend opens the database: at the first launch of
 * a new version when the database needs it, or whenever Settings asked. Any
 * failure is recorded for Settings and the backend starts normally.
 */
export const compactBeforeBackendStart = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state = yield* DesktopState.DesktopState;
  const fs = yield* FileSystem.FileSystem;
  const path = environment.path;
  // `doctor --base-dir` repairs <baseDir>/userdata; a dev desktop keeps its state in <baseDir>/dev.
  if (path.resolve(environment.stateDir) !== path.resolve(environment.baseDir, "userdata")) return;
  if (yield* Ref.get(state.quitting)) return;
  const stateFile = (name: string) => path.join(environment.stateDir, name);
  const requestPath = stateFile(DATABASE_COMPACTION_REQUEST_FILE);
  const resultPath = stateFile(DATABASE_COMPACTION_RESULT_FILE);
  const versionPath = stateFile(VERSION_FILE);

  const requested = yield* fs.exists(requestPath).pipe(Effect.orElseSucceed(() => false));
  const lastVersion = yield* fs.readFileString(versionPath).pipe(
    Effect.map((version) => version.trim()),
    Effect.orElseSucceed(() => null),
  );
  const versionChanged = lastVersion !== environment.appVersion;
  if (!requested && !versionChanged) return;

  const lastAttempt = yield* fs
    .readFileString(resultPath)
    .pipe(Effect.flatMap(decodeResult), Effect.orElseSucceed(() => null));
  const header = yield* readSqliteHeader(stateFile(DATABASE_FILE));
  const plan = planRestartCompaction({
    requested,
    versionChanged,
    lastOutcome: lastAttempt?.outcome ?? null,
    header,
    freeDiskBytes: header === null ? null : yield* freeDiskBytes(environment.stateDir),
  });
  yield* logInfo("restart compaction planned", {
    requested,
    versionChanged,
    plan: plan._tag,
    ...(plan._tag === "Run"
      ? { liveBytes: plan.liveBytes, reclaimableBytes: plan.reclaimableBytes }
      : {}),
  });

  const outcome =
    plan._tag === "Run"
      ? yield* runCompaction(plan.reclaimableBytes)
      : plan.record === null
        ? null
        : { outcome: "skipped" as const, detail: plan.record };
  const logFileFailure = (operation: string) => (cause: unknown) =>
    logWarning("restart compaction bookkeeping failed", { operation, cause });
  if (outcome !== null) {
    yield* logInfo("restart compaction finished", outcome);
    const at = DateTime.formatIso(yield* DateTime.now);
    yield* encodeResult({ at, ...outcome }).pipe(
      Effect.flatMap((json) => fs.writeFileString(resultPath, json)),
      Effect.catch(logFileFailure("write result")),
    );
  }
  if (requested) {
    yield* fs
      .remove(requestPath, { force: true })
      .pipe(Effect.catch(logFileFailure("clear request")));
  }
  if (versionChanged) {
    yield* fs
      .writeFileString(versionPath, environment.appVersion)
      .pipe(Effect.catch(logFileFailure("write version")));
  }
}).pipe(
  Effect.catchCause((cause) => logWarning("restart compaction failed", { cause })),
  Effect.withSpan("desktop.restartCompaction"),
);
