// @effect-diagnostics nodeBuiltinImport:off - Real isolated files exercise reset and symlink guards.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { vi } from "vite-plus/test";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as ProjectionStore from "../src/orchestration-v2/ProjectionStore.ts";
import * as Layer from "effect/Layer";
import { runSeedDevDb } from "./seed-dev-db.ts";
import { isAutoSettlementCandidate } from "../src/orchestration-v2/ThreadSettlementService.ts";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

const isolatedHome = Effect.acquireRelease(
  Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "loom-fixture-test-"))),
  (home) => Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
);

const inspect = (databasePath: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const { threads: shells } = yield* projections.getShellSnapshot({ location: "active" });
    const events = yield* sql<{
      count: number;
    }>`SELECT count(*) AS count FROM orchestration_events`;
    const pending = yield* sql<{
      count: number;
    }>`SELECT count(*) AS count FROM orchestration_v2_effect_outbox`;
    const auth = yield* sql<{ count: number }>`SELECT count(*) AS count FROM auth_sessions`;
    const messages =
      shells.length > 0 ? (yield* projections.getThreadProjection(shells[0]!.id)).messages : [];
    const visible =
      shells.length > 0
        ? (yield* projections.getThreadSnapshotWindow(shells[0]!.id, { rowLimit: 20 })).projection
            .messages
        : [];
    return {
      shells,
      visible,
      messages,
      events: events[0]!.count,
      pending: pending[0]!.count,
      auth: auth[0]!.count,
    };
  }).pipe(
    Effect.provide(
      ProjectionStore.layer.pipe(
        Layer.provideMerge(NodeSqliteClient.layer({ filename: databasePath })),
      ),
    ),
  );

it.layer(NodeServices.layer)("development fixtures", (it) => {
  it.effect("creates replayable synthetic history and preserves subsequent development work", () =>
    Effect.gen(function* () {
      const baseDir = yield* isolatedHome;
      const result = yield* runSeedDevDb({ baseDir });
      assert.equal(result.status, "seeded");
      const sample = yield* inspect(result.databasePath);
      assert.equal(sample.shells.length, 3);
      assert.isAbove(sample.events, 0);
      assert.deepEqual(
        sample.visible.map((message) => message.text),
        sample.messages.map((message) => message.text),
      );
      assert.deepEqual(
        sample.messages.map((message) => message.role),
        ["user", "assistant"],
      );
      assert.equal(sample.pending, 0);
      assert.equal(sample.auth, 0);
      assert.isTrue(sample.shells.every((thread) => thread.activeRunId === null));
      assert.isFalse(
        sample.shells.some((thread) =>
          isAutoSettlementCandidate(
            thread,
            DateTime.toEpochMillis(DateTime.makeUnsafe("2027-01-01T00:00:00.000Z")),
          ),
        ),
      );
      const before = yield* Effect.promise(() => NodeFSP.readFile(result.databasePath));
      const reused = yield* runSeedDevDb({ baseDir, scenario: "large" });
      assert.equal(reused.status, "existing");
      assert.deepEqual(yield* Effect.promise(() => NodeFSP.readFile(result.databasePath)), before);
      const reset = yield* runSeedDevDb({ baseDir, scenario: "empty", reset: true });
      assert.equal(reset.threads, 0);
      assert.equal((yield* inspect(reset.databasePath)).events, 0);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "concurrent preparations publish one complete dataset without replacing the winner",
    () =>
      Effect.gen(function* () {
        const baseDir = yield* isolatedHome;
        const results = yield* Effect.all(
          [
            runSeedDevDb({ baseDir, scenario: "sample" }),
            runSeedDevDb({ baseDir, scenario: "large" }),
          ],
          { concurrency: "unbounded" },
        );
        const winner = results.find((result) => result.status === "seeded");
        assert.isDefined(winner);
        assert.equal(results.filter((result) => result.status === "existing").length, 1);
        const state = yield* inspect(results[0]!.databasePath);
        assert.equal(state.shells.length, winner?.threads);
        assert.equal(state.pending, 0);
      }).pipe(Effect.scoped),
  );

  it.effect(
    "preserves the completion marker and database if replacement marker writing is interrupted",
    () =>
      Effect.gen(function* () {
        const baseDir = yield* isolatedHome;
        const original = yield* runSeedDevDb({ baseDir });
        const stateDir = NodePath.join(baseDir, "userdata");
        const markerPath = NodePath.join(stateDir, "dev-fixture.json");
        const marker = yield* Effect.promise(() => NodeFSP.readFile(markerPath, "utf8"));
        const database = yield* Effect.promise(() => NodeFSP.readFile(original.databasePath));
        const writeFile = (yield* Effect.promise(() =>
          vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
        )).writeFile;
        const spy = vi
          .mocked(NodeFSP.writeFile)
          .mockImplementation(async (path, value, options) => {
            if (typeof value === "string" && value.startsWith('{"version":1,"scenario":')) {
              await writeFile(path, '{"version":', options);
              throw new Error("synthetic interrupted marker write");
            }
            return writeFile(path, value, options);
          });
        try {
          const failure = yield* runSeedDevDb({ baseDir, scenario: "empty", reset: true }).pipe(
            Effect.flip,
          );
          assert.equal(failure._tag, "SeedDevDbError");
        } finally {
          spy.mockImplementation(writeFile);
        }
        assert.equal(yield* Effect.promise(() => NodeFSP.readFile(markerPath, "utf8")), marker);
        assert.deepEqual(
          yield* Effect.promise(() => NodeFSP.readFile(original.databasePath)),
          database,
        );
        assert.isFalse(
          (yield* Effect.promise(() => NodeFSP.readdir(stateDir))).some((name) =>
            name.endsWith(".marker"),
          ),
        );
        const reset = yield* runSeedDevDb({ baseDir, scenario: "empty", reset: true });
        assert.equal(reset.status, "seeded");
      }).pipe(Effect.scoped),
  );

  it.effect("loads the large scenario and refuses reset while its server is running", () =>
    Effect.gen(function* () {
      const baseDir = yield* isolatedHome;
      const result = yield* runSeedDevDb({ baseDir, scenario: "large" });
      assert.equal((yield* inspect(result.databasePath)).shells.length, 100);
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          NodePath.join(baseDir, "userdata", "server-runtime.json"),
          JSON.stringify({ pid: process.pid }),
        ),
      );
      const error = yield* runSeedDevDb({ baseDir, reset: true }).pipe(Effect.flip);
      assert.equal(error._tag, "MigrateDevDbServerRunningError");
      assert.equal((yield* inspect(result.databasePath)).shells.length, 100);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "protects existing unmarked databases and paths redirected into the installed home",
    () =>
      Effect.gen(function* () {
        const baseDir = yield* isolatedHome;
        const sharedHome = NodePath.join(baseDir, "installed");
        const target = NodePath.join(baseDir, "development");
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.join(sharedHome, "userdata"), { recursive: true });
          await NodeFSP.mkdir(target);
          await NodeFSP.writeFile(NodePath.join(sharedHome, "userdata", "statev2.sqlite"), "keep");
          await NodeFSP.symlink(
            NodePath.join(sharedHome, "userdata"),
            NodePath.join(target, "userdata"),
            "dir",
          );
        });
        const redirected = yield* runSeedDevDb({ baseDir: target }, { sharedHome }).pipe(
          Effect.flip,
        );
        assert.equal(redirected._tag, "SeedDevDbError");
        assert.equal("reason" in redirected ? redirected.reason : null, "shared-home");
        const shared = yield* runSeedDevDb({ baseDir: sharedHome }, { sharedHome }).pipe(
          Effect.flip,
        );
        assert.equal(shared._tag, "SeedDevDbError");
        yield* Effect.promise(async () => {
          await NodeFSP.unlink(NodePath.join(target, "userdata"));
          await NodeFSP.mkdir(NodePath.join(target, "userdata"));
          await NodeFSP.writeFile(NodePath.join(target, "userdata", "statev2.sqlite"), "unmarked");
        });
        const unmarked = yield* runSeedDevDb({ baseDir: target, reset: true }).pipe(Effect.flip);
        assert.equal(unmarked._tag, "SeedDevDbError");
        assert.equal("reason" in unmarked ? unmarked.reason : null, "not-fixture");
        assert.equal(
          yield* Effect.promise(() =>
            NodeFSP.readFile(NodePath.join(target, "userdata", "statev2.sqlite"), "utf8"),
          ),
          "unmarked",
        );
        assert.equal(
          yield* Effect.promise(() =>
            NodeFSP.readFile(NodePath.join(sharedHome, "userdata", "statev2.sqlite"), "utf8"),
          ),
          "keep",
        );
      }).pipe(Effect.scoped),
  );
});
