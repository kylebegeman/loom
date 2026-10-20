import { describe, expect, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { BotDefinition, BotRun } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { layerMemory as SqlitePersistenceMemory } from "../../persistence/Sqlite.ts";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { makeBotsStore, type BotsStore } from "./BotsStore.ts";
import { BotsMigrations } from "./migrations.ts";

const testBot = (fields: Partial<BotDefinition> = {}): BotDefinition => ({
  id: "reviewer",
  name: "Reviewer",
  description: "Reviews one file.",
  instructions: "Review {{file}}.",
  parameters: [{ name: "file", label: "File", type: "string", required: true }],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "auto",
  interactionMode: "default",
  workspace: { type: "project", projectId: null, worktree: false },
  timeoutMinutes: 5,
  maxConcurrentRuns: 2,
  scopeProjectId: null,
  version: 1,
  createdBy: "user",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  archivedAt: null,
  ...fields,
});

const testRun = (id: string, createdAt: string, fields: Partial<BotRun> = {}): BotRun => ({
  id,
  botId: "reviewer",
  botVersion: 1,
  botName: "Reviewer",
  threadId: ThreadId.make(`bot-run-${id}`),
  projectId: ProjectId.make("project-a"),
  inputs: { file: "a.ts" },
  status: "completed",
  startedBy: "user",
  callerThreadId: null,
  createdAt,
  startedAt: createdAt,
  finishedAt: createdAt,
  result: "Looks fine.",
  resultTruncated: false,
  error: null,
  ...fields,
});

const withStore = <A, E>(use: (store: BotsStore) => Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* runForkMigrationSet(BotsMigrations);
    return yield* use(yield* makeBotsStore);
  }).pipe(Effect.provide(SqlitePersistenceMemory));

describe("BotsStore", () => {
  it.effect("round-trips definitions and upserts by id", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.putDefinition(testBot());
        yield* store.putDefinition(testBot({ version: 2, name: "Reviewer 2" }));
        expect(yield* store.listDefinitions()).toEqual([
          testBot({ version: 2, name: "Reviewer 2" }),
        ]);
        expect(yield* store.getDefinition("missing")).toBeNull();
      }),
    ),
  );

  it.effect("pages runs newest first, filters by bot and lists unfinished runs", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insertRun(testRun("r1", "2026-10-20T10:00:00.000Z"));
        yield* store.insertRun(testRun("r2", "2026-10-20T11:00:00.000Z", { status: "running" }));
        yield* store.insertRun(testRun("r3", "2026-10-20T12:00:00.000Z", { botId: "other" }));
        const first = yield* store.listRuns({ limit: 2 });
        expect(first.runs.map((run) => run.id)).toEqual(["r3", "r2"]);
        expect(first.hasMore).toBe(true);
        const next = yield* store.listRuns({ limit: 2, before: first.runs[1]!.createdAt });
        expect(next).toEqual({ runs: [testRun("r1", "2026-10-20T10:00:00.000Z")], hasMore: false });
        expect((yield* store.listRuns({ botId: "other", limit: 5 })).runs.map((r) => r.id)).toEqual(
          ["r3"],
        );
        expect((yield* store.listUnfinishedRuns()).map((run) => run.id)).toEqual(["r2"]);
      }),
    ),
  );

  it.effect("stores verdicts, filters by them, and keeps a run whose verdict it cannot read", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const verdict = {
          verdict: "fail",
          summary: "One bug.",
          findings: [{ title: "Off by one", detail: "", path: "a.ts", line: 3 }],
          findingsTruncated: false,
          source: "decoded",
        } as const;
        yield* store.insertRun(testRun("r1", "2026-10-20T10:00:00.000Z"));
        yield* store.saveRun(testRun("r1", "2026-10-20T10:00:00.000Z", { verdict }));
        yield* store.insertRun(testRun("r2", "2026-10-20T11:00:00.000Z"));
        expect(yield* store.listRuns({ verdict: "fail", limit: 5 })).toEqual({
          runs: [testRun("r1", "2026-10-20T10:00:00.000Z", { verdict })],
          hasMore: false,
        });

        const sql = yield* SqlClient.SqlClient;
        yield* sql`UPDATE fork_bots_runs SET verdict_json = '{"verdict":"maybe"}' WHERE id = 'r1'`;
        expect(yield* store.getRun("r1")).toEqual(
          testRun("r1", "2026-10-20T10:00:00.000Z", { verdict: null }),
        );
      }),
    ),
  );

  it.effect("prunes only finished runs beyond the newest kept", () =>
    withStore((store) =>
      Effect.gen(function* () {
        yield* store.insertRun(
          testRun("r0", "2026-10-20T09:00:00.000Z", { status: "running", finishedAt: null }),
        );
        for (const hour of [10, 11, 12])
          yield* store.insertRun(testRun(`r${hour}`, `2026-10-20T${hour}:00:00.000Z`));
        yield* store.pruneRuns("reviewer", 2);
        expect((yield* store.listRuns({ limit: 10 })).runs.map((run) => run.id)).toEqual([
          "r12",
          "r11",
          "r0",
        ]);
      }),
    ),
  );
});
