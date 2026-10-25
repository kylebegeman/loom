import type { DatabaseStorageStatus } from "@t3tools/contracts";
// fork: restart-compaction
import {
  DATABASE_COMPACTION_REQUEST_FILE,
  DATABASE_COMPACTION_RESULT_FILE,
  DatabaseCompactionRequestError,
  RestartCompactionResult,
  type RestartCompactionState,
} from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime"; // fork: restart-compaction
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema"; // fork: restart-compaction
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/sql/SqlClient";

import { resolveHostCliCommand } from "../cli/invocation.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import { forkParked } from "../serverActivation.ts";

/** Pages returned per reclaim pass; one minute of churn, not a backlog. */
const RECLAIM_PAGES_PER_PASS = 1024;
const COMPACTION_INTERVAL = Duration.hours(6);
// fork: server-weight: a pass runs two statements per page, up to 2,048 a minute, so pages run untraced and the pass span carries the count.
const untracedPage = Effect.withTracerEnabled(false);

export class DatabaseStorage extends Context.Service<
  DatabaseStorage,
  {
    /** Return free pages to the filesystem on databases with incremental auto_vacuum. */
    readonly reclaim: Effect.Effect<void>;
    /** Current file accounting, re-published after each maintenance pass. Null until first read. */
    readonly status: Stream.Stream<DatabaseStorageStatus | null>;
    // fork: restart-compaction
    /** Ask the desktop to compact at its next launch, or withdraw the request. */
    readonly requestRestartCompaction: (
      requested: boolean,
    ) => Effect.Effect<void, DatabaseCompactionRequestError>;
  }
>()("t3/persistence/DatabaseStorage") {}

/**
 * Deletes superseded history every few hours and hands freed pages back to
 * the filesystem every minute. Deleted events are always superseded by a
 * retained event with a higher sequence, so a client replaying from an older
 * cursor still reaches the same state; no replay boundary is published.
 */
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const statusRef = yield* SubscriptionRef.make<DatabaseStorageStatus | null>(null);

  // The notice shows this verbatim; quote for the host's shell. Desktop
  // installs have no `t3` on PATH, so the command names their launcher.
  const { command: compactCommand } = yield* resolveHostCliCommand("doctor", [
    "--base-dir",
    config.baseDir,
  ]);
  // `t3 doctor --base-dir` repairs <baseDir>/userdata. A dev server without
  // an explicit home keeps its state in <baseDir>/dev instead, so there the
  // command would target the live install; publish no status at all.
  const doctorTargetsThisDatabase =
    path.resolve(config.dbPath) ===
    path.resolve(config.baseDir, "userdata", path.basename(config.dbPath));
  // fork: restart-compaction: a desktop shell runs the doctor's repair on this
  // database before it starts the server, so Settings can ask for that instead
  // of showing a command. Its result is written before this server starts.
  const restartCompactionSupported = config.restartCompaction === true && doctorTargetsThisDatabase;
  const compactionRequestPath = path.join(
    path.dirname(config.dbPath),
    DATABASE_COMPACTION_REQUEST_FILE,
  );
  const lastRestartCompaction = restartCompactionSupported
    ? yield* fs
        .readFileString(path.join(path.dirname(config.dbPath), DATABASE_COMPACTION_RESULT_FILE))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(RestartCompactionResult))),
          Effect.orElseSucceed(() => null),
        )
    : null;
  const readRestartCompaction = Effect.gen(function* () {
    if (!restartCompactionSupported) return undefined;
    const requested = yield* fs
      .exists(compactionRequestPath)
      .pipe(Effect.orElseSucceed(() => false));
    return { requested, lastAttempt: lastRestartCompaction } satisfies RestartCompactionState;
  });
  const publishStatus = Effect.gen(function* () {
    if (!doctorTargetsThisDatabase) return;
    const pages = yield* sql<{ readonly page_count: number }>`PRAGMA page_count`;
    const free = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`;
    const size = yield* sql<{ readonly page_size: number }>`PRAGMA page_size`;
    const mode = yield* sql<{ readonly auto_vacuum: number }>`PRAGMA auto_vacuum`;
    const pageSize = size[0]?.page_size ?? 0;
    const restartCompaction = yield* readRestartCompaction; // fork: restart-compaction
    const next: DatabaseStorageStatus = {
      databaseBytes: (pages[0]?.page_count ?? 0) * pageSize,
      reclaimableBytes: (free[0]?.freelist_count ?? 0) * pageSize,
      incrementalVacuumEnabled: mode[0]?.auto_vacuum === 2,
      compactCommand,
      ...(restartCompaction === undefined ? {} : { restartCompaction }), // fork: restart-compaction
    };
    // Every set reaches each open Storage page; most passes change nothing.
    if (!Equal.equals(yield* SubscriptionRef.get(statusRef), next)) {
      yield* SubscriptionRef.set(statusRef, next);
    }
  }).pipe(
    Effect.catch((cause) => Effect.logWarning("Database storage inspection failed", { cause })),
  );

  const reclaim = Effect.gen(function* () {
    const mode = yield* sql<{ readonly auto_vacuum: number }>`PRAGMA auto_vacuum`;
    if (mode[0]?.auto_vacuum !== 2) return;
    let reclaimedPages = 0; // fork: server-weight
    // The driver steps a statement without result columns once, and each
    // step of incremental_vacuum frees one page. Yield between pages so
    // client requests can run.
    for (let page = 0; page < RECLAIM_PAGES_PER_PASS; page++) {
      // fork: server-weight
      const free = yield* sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`.pipe(
        untracedPage,
      );
      if ((free[0]?.freelist_count ?? 0) === 0) break;
      yield* sql`PRAGMA incremental_vacuum(1)`.pipe(untracedPage); // fork: server-weight
      reclaimedPages++; // fork: server-weight
      yield* Effect.yieldNow;
    }
    yield* Effect.annotateCurrentSpan({ "db.reclaimed_pages": reclaimedPages }); // fork: server-weight
  }).pipe(
    Effect.withSpan("DatabaseStorage.reclaim"), // fork: server-weight
    Effect.catch((cause) => Effect.logWarning("Database space reclamation failed", { cause })),
  );

  // Even a pass that deletes nothing scans the event store. Persist completion
  // so restarting does not trigger another scan before the six-hour interval.
  const compactedAtPath = path.join(path.dirname(config.dbPath), "compacted-at");
  const compact = Effect.gen(function* () {
    const result = yield* maintenance.compactEventStore;
    const completedAt = yield* Clock.currentTimeMillis;
    yield* fs.writeFileString(compactedAtPath, String(completedAt)).pipe(Effect.ignore);
    if (result.deletedEventCount > 0 || result.deletedReceiptCount > 0) {
      yield* Effect.logInfo("Compacted orchestration history", result);
    }
  }).pipe(
    Effect.catch((cause) =>
      Effect.logWarning("Orchestration history compaction failed", { cause }),
    ),
  );
  const lastCompactedAt = yield* fs.readFileString(compactedAtPath).pipe(
    Effect.map(Number),
    Effect.orElseSucceed(() => Number.NaN),
  );
  const intervalMs = Duration.toMillis(COMPACTION_INTERVAL);
  const untilDueMs = Number.isFinite(lastCompactedAt)
    ? lastCompactedAt + intervalMs - (yield* Clock.currentTimeMillis)
    : 0;
  const firstCompactionDelay = Duration.millis(
    Math.min(intervalMs, Math.max(Duration.toMillis(Duration.minutes(1)), untilDueMs)),
  );

  yield* forkParked(
    Effect.sleep(firstCompactionDelay).pipe(
      Effect.andThen(
        compact.pipe(
          Effect.andThen(publishStatus),
          Effect.repeat(Schedule.spaced(COMPACTION_INTERVAL)),
        ),
      ),
    ),
  );
  yield* forkParked(
    publishStatus.pipe(
      Effect.andThen(Effect.sleep("1 minute")),
      Effect.andThen(
        reclaim.pipe(Effect.andThen(publishStatus), Effect.repeat(Schedule.spaced("1 minute"))),
      ),
    ),
  );

  // fork: restart-compaction
  const requestRestartCompaction = Effect.fn("DatabaseStorage.requestRestartCompaction")(function* (
    requested: boolean,
  ) {
    if (!restartCompactionSupported) {
      return yield* new DatabaseCompactionRequestError({ reason: "unavailable" });
    }
    const requestedAt = DateTime.formatIso(yield* DateTime.now);
    yield* (
      requested
        ? fs.writeFileString(compactionRequestPath, requestedAt)
        : fs.remove(compactionRequestPath, { force: true })
    ).pipe(
      Effect.mapError((cause) => new DatabaseCompactionRequestError({ reason: "write", cause })),
    );
    yield* publishStatus;
  });

  return DatabaseStorage.of({
    reclaim,
    status: SubscriptionRef.changes(statusRef),
    requestRestartCompaction, // fork: restart-compaction
  });
});

export const layer = Layer.effect(DatabaseStorage, make);
