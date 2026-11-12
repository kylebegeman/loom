import * as NodeServices from "@effect/platform-node/NodeServices";
import type { DatabaseStorageStatus } from "@t3tools/contracts"; // fork: restart-compaction
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer"; // fork: server-weight
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as DatabaseMaintenance from "./DatabaseMaintenance.ts";
import * as DatabaseStorage from "./DatabaseStorage.ts";
import * as Sqlite from "./Sqlite.ts";

const freePages = Effect.map(
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ readonly freelist_count: number }>`PRAGMA freelist_count`,
  ),
  (rows) => rows[0]?.freelist_count ?? 0,
);

const storageLayer = <E>(
  config: Layer.Layer<ServerConfig.ServerConfig, E, FileSystem.FileSystem | Path.Path>,
) =>
  DatabaseStorage.layer.pipe(
    Layer.provide(ProjectionMaintenance.layer),
    Layer.provideMerge(Sqlite.layerMemory),
    Layer.provideMerge(config),
    Layer.provide(NodeServices.layer),
  );

const testConfig = ServerConfig.layerTest(process.cwd(), { prefix: "database-storage-" });

it.effect("a new database returns freed pages online without losing data", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const storage = yield* DatabaseStorage.DatabaseStorage;
    assert.deepEqual(yield* sql`PRAGMA auto_vacuum`, [{ auto_vacuum: 2 }]);
    yield* sql`CREATE TABLE retained (value TEXT)`;
    yield* sql`INSERT INTO retained VALUES ('keep')`;
    yield* sql`CREATE TABLE discarded (value BLOB)`;
    yield* sql`INSERT INTO discarded VALUES (zeroblob(6291456))`;
    yield* sql`DROP TABLE discarded`;
    const before = yield* freePages;
    assert.isAbove(before, 1024);
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });
    yield* storage.reclaim.pipe(Effect.withTracer(tracer), Effect.withTracerEnabled(true));
    assert.equal(before - (yield* freePages), 1024);
    assert.lengthOf(spans, 1);
    assert.deepEqual(
      spans.map((span) => span.name),
      ["DatabaseStorage.reclaim"],
    );
    assert.equal(spans[0]?.attributes.get("db.reclaimed_pages"), 1024);
    yield* storage.reclaim;
    assert.equal(yield* freePages, 0);
    assert.deepEqual(yield* sql`SELECT value FROM retained`, [{ value: "keep" }]);
  }).pipe(Effect.provide(storageLayer(testConfig))),
);

// fork: restart-compaction
const failedRestartCompaction = {
  at: "2026-10-25T12:00:00.000Z",
  outcome: "failed",
  detail: "The repair stopped with exit code 1.",
} as const;

// fork: restart-compaction
const desktopConfig = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    // The desktop records its attempt before it starts the server.
    yield* fs.writeFileString(
      path.join(path.dirname(config.dbPath), "restart-compaction.json"),
      JSON.stringify(failedRestartCompaction),
    );
    return { ...config, restartCompaction: true };
  }),
).pipe(Layer.provide(testConfig));

// fork: restart-compaction
const firstPublishedStatus = (matches: (status: DatabaseStorageStatus) => boolean) =>
  Effect.flatMap(DatabaseStorage.DatabaseStorage, (storage) =>
    storage.status.pipe(
      Stream.filter(
        (status): status is DatabaseStorageStatus => status !== null && matches(status),
      ),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    ),
  );

// fork: restart-compaction
it.effect("lets Settings ask the desktop to compact at its next restart", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const storage = yield* DatabaseStorage.DatabaseStorage;
    const requestPath = path.join(path.dirname(config.dbPath), "compact-at-restart");

    const initial = yield* firstPublishedStatus(() => true);
    assert.deepEqual(initial.restartCompaction, {
      requested: false,
      lastAttempt: failedRestartCompaction,
    });

    // Each change republishes before it returns, so Settings never shows a stale state.
    yield* storage.requestRestartCompaction(true);
    assert.isTrue(yield* fs.exists(requestPath));
    assert.isTrue((yield* firstPublishedStatus(() => true)).restartCompaction?.requested);

    yield* storage.requestRestartCompaction(false);
    assert.isFalse(yield* fs.exists(requestPath));
    assert.isFalse((yield* firstPublishedStatus(() => true)).restartCompaction?.requested);
  }).pipe(Effect.provide(storageLayer(desktopConfig).pipe(Layer.provideMerge(NodeServices.layer)))),
);

// fork: restart-compaction
it.effect("keeps the doctor command where no desktop compacts the database", () =>
  Effect.gen(function* () {
    const storage = yield* DatabaseStorage.DatabaseStorage;
    const status = yield* firstPublishedStatus(() => true);
    assert.notProperty(status, "restartCompaction");
    const error = yield* storage.requestRestartCompaction(true).pipe(Effect.flip);
    assert.equal(error.reason, "unavailable");
  }).pipe(Effect.provide(storageLayer(testConfig))),
);

const compactionLayer = (
  pruneEventStore: ProjectionMaintenance.ProjectionMaintenanceV2["Service"]["pruneEventStore"],
) =>
  DatabaseStorage.layer.pipe(
    Layer.provide(
      Layer.succeed(ProjectionMaintenance.ProjectionMaintenanceV2, {
        pruneEventStore,
      }),
    ),
    Layer.provide(Sqlite.layerMemory),
  );

const minute = 60_000;
const startupTime = Date.UTC(2026, 9, 19);
const emptyCompaction = { deletedEventCount: 0, deletedReceiptCount: 0, reclaimableBytes: 0 };

it.effect("remembers completion only after the paced pass finishes", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(startupTime);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const timestampPath = path.join(path.dirname(config.dbPath), "compacted-at");
    const betweenPagesReached = yield* Deferred.make<void>();
    const completed = yield* Deferred.make<void>();
    const timestampWritten = yield* Deferred.make<void>();
    const compact = (betweenPages: Effect.Effect<void> = Effect.void) =>
      Effect.gen(function* () {
        yield* Effect.sleep(30);
        yield* Deferred.succeed(betweenPagesReached, undefined);
        yield* betweenPages;
        yield* Deferred.succeed(completed, undefined);
        return emptyCompaction;
      });
    yield* Effect.gen(function* () {
      yield* TestClock.adjust(minute);
      yield* TestClock.adjust(30);
      yield* Deferred.await(betweenPagesReached);
      assert.isFalse(yield* Deferred.isDone(completed));
      assert.isFalse(yield* fs.exists(timestampPath));
      yield* TestClock.adjust(269);
      assert.isFalse(yield* Deferred.isDone(completed));
      assert.isFalse(yield* fs.exists(timestampPath));
      yield* TestClock.adjust(1);
      yield* Deferred.await(timestampWritten);
      assert.isTrue(yield* Deferred.isDone(completed));
      assert.equal(Number(yield* fs.readFileString(timestampPath)), startupTime + minute + 300);
    }).pipe(
      Effect.provide(compactionLayer(compact)),
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        writeFileString: (file, content, options) =>
          fs
            .writeFileString(file, content, options)
            .pipe(Effect.ensuring(Deferred.succeed(timestampWritten, undefined))),
      }),
    );
  }).pipe(Effect.provide(testConfig.pipe(Layer.provideMerge(NodeServices.layer)))),
);

// fork: server-weight
const recordingTracer = () => {
  const ended: Array<Tracer.Span> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        ended.push(span);
      };
      return span;
    },
  });
  const queries = () =>
    ended.flatMap((span) => {
      const query = span.attributes.get("db.query.text");
      return typeof query === "string" ? [query] : [];
    });
  return { tracer, ended, queries };
};

// fork: server-weight
it.effect("traces one prune span with its counts instead of a span per page", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    // Three pages of one thread's archive state the projections cover; only the newest survives.
    yield* sql`
      WITH RECURSIVE history(n) AS (
        SELECT 1 UNION ALL SELECT n + 1 FROM history WHERE n < 120
      )
      INSERT INTO orchestration_events (
        event_id, aggregate_kind, stream_id, stream_version, event_type,
        occurred_at, actor_kind, payload_json, metadata_json, application_event_version
      )
      SELECT 'archived:' || n, 'thread', 'thread:archived', n, 'thread.archived',
        '2026-10-24T00:00:00.000Z', 'server', '{}', '{}', 2
      FROM history
    `;
    yield* sql`
      UPDATE orchestration_v2_projection_metadata SET last_sequence = 120
      WHERE projection_name = 'thread-projections'
    `;
    // The first pass only marks the head; the second prunes through it once it is a day old.
    yield* maintenance.pruneEventStore();
    yield* TestClock.adjust("1 day");
    const recorder = recordingTracer();
    const result = yield* maintenance.pruneEventStore().pipe(Effect.withTracer(recorder.tracer));

    assert.equal(result.deletedEventCount, 119);
    assert.deepEqual(yield* sql`SELECT event_id FROM orchestration_events`, [
      { event_id: "archived:120" },
    ]);
    const passes = recorder.ended.filter(
      (span) => span.name === "ProjectionMaintenance.pruneEventStore",
    );
    assert.equal(passes.length, 1);
    assert.deepInclude(Object.fromEntries(passes[0]!.attributes), {
      "orchestration_v2.compaction.scanned_event_count": 120,
      "orchestration_v2.compaction.deleted_event_count": 119,
      "orchestration_v2.compaction.scanned_receipt_count": 0,
      "orchestration_v2.compaction.deleted_receipt_count": 0,
    });
    assert.isFalse(
      recorder
        .queries()
        .some((query) =>
          /ORDER BY event\.sequence ASC|DELETE FROM orchestration_events/.test(query),
        ),
    );
  }).pipe(Effect.provide(ProjectionMaintenance.layer.pipe(Layer.provideMerge(Sqlite.layerMemory)))),
);

// fork: server-weight
it.effect("traces one reclaim span with its page count instead of a span per page", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const storage = yield* DatabaseStorage.DatabaseStorage;
    yield* sql`CREATE TABLE discarded (value BLOB)`;
    yield* sql`INSERT INTO discarded VALUES (zeroblob(1048576))`;
    yield* sql`DROP TABLE discarded`;
    const free = yield* freePages;
    assert.isAbove(free, 0);
    const recorder = recordingTracer();
    yield* storage.reclaim.pipe(Effect.withTracer(recorder.tracer));

    assert.equal(yield* freePages, 0);
    const passes = recorder.ended.filter((span) => span.name === "DatabaseStorage.reclaim");
    assert.equal(passes.length, 1);
    assert.equal(passes[0]!.attributes.get("db.reclaimed_pages"), free);
    assert.isFalse(recorder.queries().some((query) => query.includes("freelist_count")));
  }).pipe(Effect.provide(storageLayer(testConfig))),
);

// NONE is a database from before automatic shrinking, which the repair converts.
const reclaimLayer = (
  restart: Effect.Effect<void> | null,
  autoVacuum: "NONE" | "FULL" | "INCREMENTAL" = "NONE",
) =>
  DatabaseStorage.layer.pipe(
    Layer.provide(ProjectionMaintenance.layer),
    Layer.provide(Layer.succeed(DatabaseStorage.ServerRestart, restart)),
    Layer.provide(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql.unsafe(`PRAGMA auto_vacuum = ${autoVacuum}`);
          yield* sql`VACUUM`;
        }),
      ).pipe(Layer.provideMerge(Sqlite.layerMemory)),
    ),
  );

it.effect(
  "a reclaim from Settings saves its request, then restarts the server after replying",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const files = DatabaseMaintenance.reclaimFiles(path, config.dbPath);
      const request = Effect.flatMap(
        DatabaseStorage.DatabaseStorage,
        (storage) => storage.requestReclaim,
      );
      const restarted = yield* Deferred.make<void>();
      const restart = Deferred.succeed(restarted, undefined).pipe(Effect.asVoid);

      // Nothing starts a server run by hand again, so it keeps pointing at the command.
      const unsupervised = yield* request.pipe(Effect.flip, Effect.provide(reclaimLayer(null)));
      assert.equal(unsupervised._tag, "DatabaseReclaimError");
      // A database that already shrinks on its own (or a stale dialog after another client's
      // repair) has nothing to reclaim, so it must not restart.
      for (const autoVacuum of ["FULL", "INCREMENTAL"] as const) {
        const refused = yield* request.pipe(
          Effect.flip,
          Effect.provide(reclaimLayer(restart, autoVacuum)),
        );
        assert.equal(refused._tag, "DatabaseReclaimError", autoVacuum);
      }
      assert.isFalse(yield* fs.exists(files.request));

      yield* fs.writeFileString(files.failure, "an earlier failure");
      yield* Effect.gen(function* () {
        const storage = yield* DatabaseStorage.DatabaseStorage;
        const shownFailure = storage.status.pipe(
          Stream.filter((status) => status !== null),
          Stream.runHead,
          Effect.map((status) => Option.getOrThrow(status)?.reclaimFailure),
        );
        assert.equal(yield* shownFailure, "an earlier failure");
        yield* storage.requestReclaim;
        // The retry clears it at once, so Settings shows the restart, not the old failure.
        assert.isUndefined(yield* shownFailure);
      }).pipe(Effect.provide(reclaimLayer(restart)));
      assert.isTrue(yield* fs.exists(files.request));
      assert.isFalse(yield* fs.exists(files.failure));
      assert.isFalse(yield* Deferred.isDone(restarted), "the reply must go out before the restart");
      yield* TestClock.adjust(500);
      yield* Deferred.await(restarted);
    }).pipe(Effect.provide(testConfig.pipe(Layer.provideMerge(NodeServices.layer)))),
);
