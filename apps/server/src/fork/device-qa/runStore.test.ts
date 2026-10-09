import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { DEFAULT_DEVICE_QA_SETTINGS, type DeviceQaRun } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { DeviceQaMigrations } from "./migrations.ts";
import { makeRunStore, type StoredRun } from "./runStore.ts";

const stored = (id: string, startedAt: string, fields: Partial<DeviceQaRun> = {}): StoredRun => ({
  run: {
    id,
    projectId: ProjectId.make("project-a"),
    threadId: ThreadId.make("thread-a"),
    target: { hostId: "local", deviceId: "SIM-1", platform: "ios" },
    flows: [
      {
        path: ".argent/flows/login.yaml",
        status: "passed",
        passed: 3,
        failed: 0,
        skipped: 0,
        errored: 0,
        durationMs: 1200,
        error: null,
      },
    ],
    updateBaselines: false,
    status: "passed",
    startedBy: "user",
    startedAt,
    finishedAt: startedAt,
    ...fields,
  },
  cwd: "/work/a",
  runDir: `/runs/${id}`,
  steps: null,
});

const withStore = <A, E>(
  use: (store: Effect.Success<typeof makeRunStore>) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(DeviceQaMigrations);
    return yield* use(yield* makeRunStore);
  }).pipe(Effect.provide(SqlitePersistenceMemory));

describe("DeviceQaRunStore", () => {
  it.effect("round-trips runs with steps and lists a project's runs newest first", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insert(stored("dqa_1", "2026-10-08T10:00:00.000Z"));
        yield* store.insert(stored("dqa_2", "2026-10-08T11:00:00.000Z"));
        yield* store.insert({
          ...stored("dqa_3", "2026-10-08T12:00:00.000Z", {
            projectId: ProjectId.make("project-b"),
          }),
        });
        const steps = {
          ".argent/flows/login.yaml": [{ index: 0, kind: "tap", status: "pass" as const }],
        };
        yield* store.save({ ...stored("dqa_1", "2026-10-08T10:00:00.000Z"), steps });
        expect((yield* store.get("dqa_1"))?.steps).toEqual(steps);
        expect(yield* store.get("missing")).toBeNull();
        const listed = yield* store.listForProject("project-a");
        expect(listed.map((entry) => entry.run.id)).toEqual(["dqa_2", "dqa_1"]);
        expect(listed[0]?.run.target).toEqual({
          hostId: "local",
          deviceId: "SIM-1",
          platform: "ios",
        });
        expect((yield* store.listForProject("project-a", 1)).map((entry) => entry.run.id)).toEqual([
          "dqa_2",
        ]);
      }),
    ),
  );

  it.effect("marks runs left running as interrupted with their open flows cancelled", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const running = stored("dqa_1", "2026-10-08T10:00:00.000Z", {
          status: "running",
          finishedAt: null,
        });
        yield* store.insert({
          ...running,
          run: {
            ...running.run,
            flows: [
              { ...running.run.flows[0]!, status: "passed" },
              { ...running.run.flows[0]!, path: ".argent/flows/b.yaml", status: "running" },
              { ...running.run.flows[0]!, path: ".argent/flows/c.yaml", status: "pending" },
            ],
          },
        });
        yield* store.insert(stored("dqa_2", "2026-10-08T11:00:00.000Z"));
        expect(yield* store.markInterrupted("2026-10-08T13:00:00.000Z")).toBe(1);
        const run = (yield* store.get("dqa_1"))!.run;
        expect(run.status).toBe("interrupted");
        expect(run.finishedAt).toBe("2026-10-08T13:00:00.000Z");
        expect(run.flows.map((flow) => flow.status)).toEqual(["passed", "cancelled", "cancelled"]);
        expect((yield* store.get("dqa_2"))!.run.status).toBe("passed");
      }),
    ),
  );

  it.effect("prunes finished runs beyond the kept count of one project", () =>
    withStore((store) =>
      Effect.gen(function* () {
        for (const hour of [10, 11, 12, 13])
          yield* store.insert(stored(`dqa_${hour}`, `2026-10-08T${hour}:00:00.000Z`));
        yield* store.insert(
          stored("dqa_live", "2026-10-08T09:00:00.000Z", { status: "running", finishedAt: null }),
        );
        yield* store.insert(
          stored("dqa_other", "2026-10-08T08:00:00.000Z", {
            projectId: ProjectId.make("project-b"),
          }),
        );
        expect(yield* store.prune("project-a", 2)).toEqual(["/runs/dqa_11", "/runs/dqa_10"]);
        expect((yield* store.listForProject("project-a")).map((entry) => entry.run.id)).toEqual([
          "dqa_13",
          "dqa_12",
          "dqa_live",
        ]);
        expect(yield* store.get("dqa_other")).not.toBeNull();
      }),
    ),
  );

  it.effect("stores settings over the defaults", () =>
    withStore((store) =>
      Effect.gen(function* () {
        expect(yield* store.getSettings()).toEqual(DEFAULT_DEVICE_QA_SETTINGS);
        const next = { ...DEFAULT_DEVICE_QA_SETTINGS, evidenceExpireDays: 7 };
        yield* store.updateSettings(next);
        expect(yield* store.getSettings()).toEqual(next);
      }),
    ),
  );
});
