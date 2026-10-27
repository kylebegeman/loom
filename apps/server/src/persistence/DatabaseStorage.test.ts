import * as NodeServices from "@effect/platform-node/NodeServices";
import type { DatabaseStorageStatus } from "@t3tools/contracts"; // fork: restart-compaction
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option"; // fork: restart-compaction
import * as Path from "effect/Path";
import * as Stream from "effect/Stream"; // fork: restart-compaction
import * as TestClock from "effect/testing/TestClock";
import * as Tracer from "effect/Tracer"; // fork: server-weight
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as EventStore from "../orchestration-v2/EventStore.ts";
import * as ProjectionMaintenance from "../orchestration-v2/ProjectionMaintenance.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
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
    Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
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
    yield* sql`INSERT INTO discarded VALUES (zeroblob(1048576))`;
    yield* sql`DROP TABLE discarded`;
    assert.isAbove(yield* freePages, 0);
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
  compactEventStore: ProjectionMaintenance.ProjectionMaintenanceV2["Service"]["compactEventStore"],
) =>
  DatabaseStorage.layer.pipe(
    Layer.provide(
      Layer.succeed(ProjectionMaintenance.ProjectionMaintenanceV2, {
        compactEventStore,
        verify: Effect.die("unexpected verification"),
        rebuild: Effect.die("unexpected rebuild"),
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
it.effect("traces one compaction span with its counts instead of a span per page", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const maintenance = yield* ProjectionMaintenance.ProjectionMaintenanceV2;
    // Three pages of one thread's archive state; only the newest survives.
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
    const recorder = recordingTracer();
    const result = yield* maintenance.compactEventStore().pipe(Effect.withTracer(recorder.tracer));

    assert.equal(result.deletedEventCount, 119);
    assert.deepEqual(yield* sql`SELECT event_id FROM orchestration_events`, [
      { event_id: "archived:120" },
    ]);
    const passes = recorder.ended.filter(
      (span) => span.name === "ProjectionMaintenance.compactEventStore",
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
          /ORDER BY event\.sequence DESC|DELETE FROM orchestration_events/.test(query),
        ),
    );
  }).pipe(
    Effect.provide(
      ProjectionMaintenance.layer.pipe(
        Layer.provide(Layer.merge(EventStore.layer, ProjectionStore.layer)),
        Layer.provideMerge(Sqlite.layerMemory),
      ),
    ),
  ),
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
