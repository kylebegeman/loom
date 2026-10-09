import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_APPLE_BUILD_SETTINGS, type AppleRunRecord } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeRunStore, mergeSettings, type StoredRun } from "./AppleRunStore.ts";
import { AppleBuildToolingMigrations } from "./migrations.ts";

const stored = (
  id: string,
  startedAt: string,
  fields: Partial<AppleRunRecord> = {},
): StoredRun => ({
  run: {
    id,
    projectId: ProjectId.make("project-a"),
    threadId: ThreadId.make("thread-a"),
    cwd: "/work/a",
    kind: "build",
    request: { workspace: { threadId: ThreadId.make("thread-a") }, kind: "build" },
    status: "succeeded",
    phase: "done",
    startedBy: "user",
    startedAt,
    finishedAt: startedAt,
    exitCode: 0,
    commandLine: "xcodebuild build",
    counts: { errors: 0, warnings: 0, failedTests: 0 },
    hasResultBundle: false,
    ...fields,
  },
  runDir: `/runs/${id}`,
  summary: null,
  resultBundlePath: null,
});

const withStore = <A, E>(
  use: (store: Effect.Success<typeof makeRunStore>) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(AppleBuildToolingMigrations);
    return yield* use(yield* makeRunStore);
  }).pipe(Effect.provide(SqlitePersistenceMemory));

describe("AppleRunStore", () => {
  it.effect("round-trips runs and lists a workspace's runs newest first", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insert(stored("abt_1", "2026-10-08T10:00:00.000Z"));
        yield* store.insert(stored("abt_2", "2026-10-08T11:00:00.000Z", { kind: "test" }));
        yield* store.insert(stored("abt_3", "2026-10-08T12:00:00.000Z", { cwd: "/work/b" }));
        const summary = {
          build: { status: "failed", errorCount: 1, warningCount: 0, issues: [] },
        } as const;
        yield* store.save({
          ...stored("abt_1", "2026-10-08T10:00:00.000Z", {
            status: "failed",
            counts: { errors: 1, warnings: 0, failedTests: 0 },
          }),
          summary,
          resultBundlePath: "/runs/abt_1/Result.xcresult",
        });
        const first = yield* store.get("abt_1");
        expect(first?.run).toMatchObject({ status: "failed", counts: { errors: 1 } });
        expect(first?.run.hasResultBundle).toBe(true);
        expect(first?.summary).toEqual(summary);
        expect((yield* store.listForCwd("/work/a")).map((row) => row.run.id)).toEqual([
          "abt_2",
          "abt_1",
        ]);
        expect((yield* store.latestFinished("/work/a", "test"))?.run.id).toBe("abt_2");
        expect(yield* store.cwdsForProject("project-a")).toEqual(
          expect.arrayContaining(["/work/a", "/work/b"]),
        );
      }),
    ),
  );

  it.effect("marks runs a previous server left going as interrupted", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insert(
          stored("abt_1", "2026-10-08T10:00:00.000Z", {
            status: "running",
            phase: "building",
            finishedAt: null,
          }),
        );
        yield* store.markInterrupted("2026-10-08T10:05:00.000Z");
        expect((yield* store.get("abt_1"))?.run).toMatchObject({
          status: "interrupted",
          phase: "done",
          finishedAt: "2026-10-08T10:05:00.000Z",
        });
      }),
    ),
  );

  it.effect("prunes beyond the newest runs, keeps running ones and drops removed projects", () =>
    withStore((store) =>
      Effect.gen(function* () {
        for (const hour of [10, 11, 12])
          yield* store.insert(stored(`abt_${hour}`, `2026-10-08T${hour}:00:00.000Z`));
        yield* store.insert(
          stored("abt_live", "2026-10-08T09:00:00.000Z", { status: "running", finishedAt: null }),
        );
        yield* store.insert(
          stored("abt_gone", "2026-10-08T13:00:00.000Z", {
            projectId: ProjectId.make("project-gone"),
          }),
        );
        const removed = yield* store.prune("project-a", 2, ["project-a"]);
        expect(removed.sort()).toEqual(["/runs/abt_10", "/runs/abt_gone"]);
        expect(yield* store.countRuns()).toBe(3);
        expect(yield* store.clear("project-a")).toHaveLength(2);
        expect((yield* store.listForCwd("/work/a")).map((row) => row.run.id)).toEqual(["abt_live"]);
      }),
    ),
  );

  it.effect("fills settings fields a stored value lacks with defaults", () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.getSettings()).toEqual(DEFAULT_APPLE_BUILD_SETTINGS);
        const sql = yield* SqlClient.SqlClient;
        yield* sql`INSERT INTO fork_apple_build_tooling_settings (key,value_json) VALUES ('settings', '{"useXcbeautify":false}')`;
        expect(yield* store.getSettings()).toEqual({
          ...DEFAULT_APPLE_BUILD_SETTINGS,
          useXcbeautify: false,
        });
        const next = mergeSettings(DEFAULT_APPLE_BUILD_SETTINGS, {
          derivedData: "xcode-default",
          useXcbeautify: undefined,
        });
        yield* store.updateSettings(next);
        expect(yield* store.getSettings()).toEqual(next);
        expect(next.useXcbeautify).toBe(true);
      }),
    ),
  );
});
