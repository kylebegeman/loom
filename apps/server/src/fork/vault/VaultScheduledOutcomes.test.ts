import { expect, it } from "@effect/vitest";
import {
  IsoDateTime,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  type ScheduledTask,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../../persistence/Sqlite.ts";
import { whileWriterHeld } from "./VaultReader.testkit.ts";
import * as Outcomes from "./VaultScheduledOutcomes.ts";
const layer = Layer.effect(Outcomes.VaultScheduledOutcomes, Outcomes.make).pipe(
  Layer.provideMerge(SqlitePersistence.layerMemory),
);
const stamp = IsoDateTime.make("2026-10-19T01:00:00.000Z");
const task: ScheduledTask = {
  id: ScheduledTaskId.make("scheduled-task:proof"),
  title: "Vault proof",
  prompt: "Run",
  enabled: false,
  schedule: { type: "interval", everyMs: 60000 },
  projectId: ProjectId.make("project:proof"),
  threadId: null,
  workspaceStrategy: { type: "root" },
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdBy: "user",
  creationSource: "web",
  createdAt: stamp,
  updatedAt: stamp,
  nextRunAt: null,
  lastRunAt: stamp,
  lastRunStatus: "succeeded",
  lastRunError: null,
  runCount: 1,
};
const messageId = MessageId.make("message:exact");
const prompt = `[Vault reference: test](loom-vault:env:${"a".repeat(32)})`;
const seed = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO orchestration_v2_projection_threads (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode, created_at, updated_at, payload_json)
    VALUES ('thread:proof', ${task.projectId}, 'proof', 'codex', 'full-access', 'default', ${stamp}, ${stamp}, '{}')`;
  yield* sql`INSERT INTO orchestration_v2_projection_messages (message_id, thread_id, run_id, role, streaming, created_at, updated_at, payload_json)
    VALUES (${messageId}, 'thread:proof', 'run:proof', 'user', 0, ${stamp}, ${stamp}, ${JSON.stringify({ scheduledTaskId: task.id })})`;
  yield* sql`INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, provider, status, requested_at, payload_json)
    VALUES ('run:proof', 'thread:proof', 1, 'codex', 'queued', ${stamp}, ${JSON.stringify({ userMessageId: messageId })})`;
  return sql;
});
it.effect("tracks the exact dispatched message through queue, failure, retry and restart", () =>
  Effect.gen(function* () {
    const outcomes = yield* Outcomes.VaultScheduledOutcomes;
    const sql = yield* seed;
    yield* outcomes.track(task, stamp, messageId, prompt);
    expect((yield* outcomes.decorate(task)).lastRunStatus).toBe("running");
    yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'failed' WHERE run_id = 'run:proof'`;
    const failed = yield* outcomes.decorate(task);
    expect(failed.lastRunStatus).toBe("failed");
    expect(failed.lastRunError).toContain("review attachments");
    expect(failed.runCount).toBe(1);
    const reconstructed = yield* Outcomes.make;
    expect((yield* reconstructed.decorate(task)).lastRunStatus).toBe("failed");
    yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'run:proof'`;
    expect((yield* outcomes.decorate(task)).lastRunStatus).toBe("succeeded");
    yield* outcomes.track(task, stamp, MessageId.make("message:retry"), prompt);
    expect((yield* outcomes.decorate(task)).lastRunStatus).toBe("failed");
    expect(
      (yield* outcomes.decorate({
        ...task,
        createdAt: IsoDateTime.make("2026-10-19T02:00:00.000Z"),
      })).lastRunStatus,
    ).toBe("succeeded");
  }).pipe(Effect.provide(layer)),
);
it.effect(
  "keeps ordinary prompts and failed dispatches unchanged; rejects missing or foreign ownership",
  () =>
    Effect.gen(function* () {
      const outcomes = yield* Outcomes.VaultScheduledOutcomes;
      const sql = yield* seed;
      yield* outcomes.track(task, stamp, messageId, "ordinary prompt");
      expect(yield* outcomes.decorate(task)).toEqual(task);
      yield* outcomes.track(task, stamp, messageId, prompt);
      const dispatchFailure = {
        ...task,
        lastRunStatus: "failed" as const,
        lastRunError: "dispatch failed",
      };
      expect(yield* outcomes.decorate(dispatchFailure)).toEqual(dispatchFailure);
      for (const status of ["cancelled", "interrupted", "rolled_back"]) {
        yield* sql`UPDATE orchestration_v2_projection_runs SET status = ${status} WHERE run_id = 'run:proof'`;
        expect((yield* outcomes.decorate(task)).lastRunStatus).toBe("failed");
      }
      yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'completed' WHERE run_id = 'run:proof'`;
      yield* sql`UPDATE orchestration_v2_projection_threads SET project_id = 'foreign' WHERE thread_id = 'thread:proof'`;
      expect((yield* outcomes.decorate(task)).lastRunStatus).toBe("failed");
      yield* sql`DELETE FROM orchestration_v2_projection_messages WHERE message_id = ${messageId}`;
      expect((yield* outcomes.decorate(task)).lastRunStatus).toBe("failed");
    }).pipe(Effect.provide(layer)),
);

it.effect("publishes outcome changes once and removes deleted task ownership", () =>
  Effect.gen(function* () {
    const outcomes = yield* Outcomes.VaultScheduledOutcomes;
    const sql = yield* seed;
    yield* sql`INSERT INTO scheduled_tasks (task_id, title, prompt, enabled, schedule_json, project_id, thread_id, workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode, created_by, creation_source, created_at, updated_at, next_run_at, last_run_at, last_run_status, last_run_error, run_count)
    VALUES (${task.id}, 'proof', 'not stored in ownership', 0, '{"type":"interval","everyMs":60000}', ${task.projectId}, NULL, '{"type":"root"}', '{"instanceId":"codex","model":"test"}', 'full-access', 'default', 'user', 'web', ${stamp}, ${stamp}, NULL, ${stamp}, 'succeeded', NULL, 1)`;
    yield* outcomes.track(task, stamp, messageId, prompt);
    expect(yield* outcomes.changed).toBe(true);
    expect(yield* outcomes.changed).toBe(false);
    yield* sql`UPDATE orchestration_v2_projection_runs SET status = 'failed' WHERE run_id = 'run:proof'`;
    expect(yield* outcomes.changed).toBe(true);
    expect(yield* outcomes.changed).toBe(false);
    yield* sql`DELETE FROM scheduled_tasks WHERE task_id = ${task.id}`;
    expect(yield* outcomes.changed).toBe(true);
    expect((yield* sql`SELECT * FROM fork_vault_scheduled_runs`).length).toBe(0);
  }).pipe(Effect.provide(layer)),
);

// A file database, so the poll's readOnly read really goes to the reader worker.
const fileLayer = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "vault-outcomes-" });
    return Layer.effect(Outcomes.VaultScheduledOutcomes, Outcomes.make).pipe(
      Layer.provideMerge(SqlitePersistence.layerFromPath(path.join(directory, "statev2.sqlite"))),
    );
  }),
).pipe(Layer.provideMerge(NodeServices.layer));
it.effect("polls without the writer unless an orphan needs removing", () =>
  Effect.gen(function* () {
    const outcomes = yield* Outcomes.VaultScheduledOutcomes;
    expect(yield* whileWriterHeld(outcomes.changed)).toBe(false);
    const sql = yield* seed;
    yield* sql`INSERT INTO scheduled_tasks (task_id, title, prompt, enabled, schedule_json, project_id, thread_id, workspace_strategy_json, model_selection_json, runtime_mode, interaction_mode, created_by, creation_source, created_at, updated_at, next_run_at, last_run_at, last_run_status, last_run_error, run_count)
    VALUES (${task.id}, 'proof', 'not stored in ownership', 0, '{"type":"interval","everyMs":60000}', ${task.projectId}, NULL, '{"type":"root"}', '{"instanceId":"codex","model":"test"}', 'full-access', 'default', 'user', 'web', ${stamp}, ${stamp}, NULL, ${stamp}, 'succeeded', NULL, 1)`;
    yield* outcomes.track(task, stamp, messageId, prompt);
    expect(yield* whileWriterHeld(outcomes.changed)).toBe(true);
    expect(yield* whileWriterHeld(outcomes.changed)).toBe(false);
    yield* sql`DELETE FROM scheduled_tasks WHERE task_id = ${task.id}`;
    expect(yield* outcomes.changed).toBe(true);
    expect((yield* sql`SELECT * FROM fork_vault_scheduled_runs`).length).toBe(0);
  }).pipe(Effect.provide(fileLayer)),
);
