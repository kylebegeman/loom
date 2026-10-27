import { ScheduledTaskError, type ScheduledTask, type MessageId } from "@t3tools/contracts";
import { readVaultPrompt } from "@t3tools/contracts/fork";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import { runForkMigrationSet } from "../persistence/migrations.ts";
import { VaultScheduledMigrations } from "./scheduled-migrations.ts";

export class VaultScheduledOutcomes extends Context.Service<
  VaultScheduledOutcomes,
  {
    readonly track: (
      task: ScheduledTask,
      startedAt: string,
      messageId: MessageId,
      prompt: string,
    ) => Effect.Effect<void, ScheduledTaskError>;
    readonly decorate: (task: ScheduledTask) => Effect.Effect<ScheduledTask, ScheduledTaskError>;
    readonly changed: Effect.Effect<boolean, ScheduledTaskError>;
  }
>()("t3/fork/vault/VaultScheduledOutcomes") {}
const failure = (cause: unknown) =>
  new ScheduledTaskError({ message: "Could not inspect the scheduled Vault run.", cause });
// Scheduler construction precedes ForkLayer, so this service owns its migration bootstrap.
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runForkMigrationSet(VaultScheduledMigrations).pipe(Effect.orDie);
  const previous = yield* Ref.make("");
  const decorate = Effect.fn("VaultScheduledOutcomes.decorate")(function* (task: ScheduledTask) {
    if (!task.lastRunAt || task.lastRunStatus !== "succeeded") return task;
    const rows = yield* sql<{
      message_id: string;
      status: string | null;
      message_exists: number;
      thread_exists: number;
    }>`
      SELECT ownership.message_id, run.status,
        message.message_id IS NOT NULL AS message_exists,
        thread.thread_id IS NOT NULL AND thread.deleted_at IS NULL AS thread_exists
      FROM fork_vault_scheduled_runs ownership
      LEFT JOIN orchestration_v2_projection_messages message
        ON message.message_id = ownership.message_id
        AND json_extract(message.payload_json, '$.scheduledTaskId') = ownership.task_id
      LEFT JOIN orchestration_v2_projection_threads thread
        ON thread.thread_id = message.thread_id AND thread.project_id = ownership.project_id
      LEFT JOIN orchestration_v2_projection_runs run
        ON run.run_id = message.run_id AND run.thread_id = message.thread_id
        AND json_extract(run.payload_json, '$.userMessageId') = message.message_id
      WHERE ownership.task_id = ${task.id} AND ownership.task_created_at = ${task.createdAt}
        AND ownership.started_at = ${task.lastRunAt}
    `.pipe(Effect.mapError(failure));
    const row = rows[0];
    if (!row) return task;
    if (!row.message_exists || !row.thread_exists)
      return {
        ...task,
        lastRunStatus: "failed" as const,
        lastRunError:
          "The scheduled Vault run is no longer available. Review its attachments before retrying.",
      };
    if (row.status === "completed") return task;
    if (row.status && ["failed", "cancelled", "interrupted", "rolled_back"].includes(row.status))
      return {
        ...task,
        lastRunStatus: "failed" as const,
        lastRunError:
          "The Vault-attached run did not complete. Open its thread, review attachments and access, then retry.",
      };
    return { ...task, lastRunStatus: "running" as const, lastRunError: null };
  });
  return VaultScheduledOutcomes.of({
    decorate,
    track: Effect.fn("VaultScheduledOutcomes.track")(function* (
      task,
      startedAt,
      messageId,
      prompt,
    ) {
      const parsed = readVaultPrompt(prompt);
      if (parsed.valid && parsed.attachments.length === 0) {
        yield* sql`DELETE FROM fork_vault_scheduled_runs WHERE task_id = ${task.id}`;
        return;
      }
      yield* sql`INSERT INTO fork_vault_scheduled_runs (task_id, task_created_at, started_at, message_id, project_id)
        VALUES (${task.id}, ${task.createdAt}, ${startedAt}, ${messageId}, ${task.projectId})
        ON CONFLICT(task_id) DO UPDATE SET task_created_at = excluded.task_created_at,
          started_at = excluded.started_at, message_id = excluded.message_id, project_id = excluded.project_id
      `;
    }, Effect.mapError(failure)),
    // The scheduler polls this every few seconds and the table is almost always empty or
    // current, so it reads on the reader and takes the writer only to remove an orphan.
    changed: Effect.gen(function* () {
      const rows = yield* sql<{
        task_id: string;
        status: string | null;
        updated_at: string | null;
        deleted_at: string | null;
        orphaned: number;
      }>`
        SELECT ownership.task_id, run.status, run.completed_at AS updated_at, thread.deleted_at,
          NOT EXISTS (
            SELECT 1 FROM scheduled_tasks task WHERE task.task_id = ownership.task_id
              AND task.created_at = ownership.task_created_at
              AND task.last_run_at = ownership.started_at
          ) AS orphaned
        FROM fork_vault_scheduled_runs ownership
        LEFT JOIN orchestration_v2_projection_messages message ON message.message_id = ownership.message_id
        LEFT JOIN orchestration_v2_projection_runs run ON run.run_id = message.run_id
        LEFT JOIN orchestration_v2_projection_threads thread ON thread.thread_id = message.thread_id
        ORDER BY ownership.task_id
      `.pipe(NodeSqliteClient.readOnly, Effect.mapError(failure));
      // The DELETE re-checks each row, so a row that track() refreshed since the read stays.
      if (rows.some((row) => row.orphaned))
        yield* sql`DELETE FROM fork_vault_scheduled_runs WHERE NOT EXISTS (
          SELECT 1 FROM scheduled_tasks task WHERE task.task_id = fork_vault_scheduled_runs.task_id
            AND task.created_at = fork_vault_scheduled_runs.task_created_at
            AND task.last_run_at = fork_vault_scheduled_runs.started_at
        )`.pipe(Effect.mapError(failure));
      const signature = rows
        .filter((row) => !row.orphaned)
        .map((r) => `${r.task_id}:${r.status}:${r.updated_at}:${r.deleted_at}`)
        .join("\n");
      return yield* Ref.getAndSet(previous, signature).pipe(Effect.map((old) => old !== signature));
    }),
  });
});
