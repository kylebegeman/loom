// fork: webhook-delivery-issues
import {
  ScheduledTaskError,
  type ScheduledTask,
  type ScheduledTaskDeliveryIssue,
} from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// The log keeps request bodies and headers; only these fixed texts leave it.
const REASONS: Readonly<Record<string, string>> = {
  rejected_signature: "The signature was missing or did not match this task's secret.",
  expired: "The request was older than this task's maximum delivery age.",
};

function deliveryIssues(
  rows: ReadonlyArray<{
    readonly task_id: string;
    readonly outcome: string;
    readonly error: string | null;
    readonly received_at: string;
  }>,
): ReadonlyMap<string, ScheduledTaskDeliveryIssue> {
  const issues = new Map<string, ScheduledTaskDeliveryIssue>();
  // Newest first within each task.
  for (const row of rows) {
    const newer = issues.get(row.task_id);
    issues.set(
      row.task_id,
      newer === undefined
        ? {
            outcome: row.outcome,
            reason: REASONS[row.outcome] ?? row.error ?? "The run failed.",
            firstAt: row.received_at,
            lastAt: row.received_at,
            count: 1,
          }
        : { ...newer, firstAt: row.received_at, count: newer.count + 1 },
    );
  }
  return issues;
}

export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const select = () =>
    sql<{ task_id: string; outcome: string; error: string | null; received_at: string }>`
      SELECT task_id, outcome, error, received_at
      FROM scheduled_task_webhook_deliveries AS issue
      WHERE outcome IN ('rejected_signature', 'expired', 'dispatch_failed')
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_task_webhook_deliveries AS later
          WHERE later.task_id = issue.task_id AND later.outcome = 'accepted'
            AND (later.received_at > issue.received_at
              OR (later.received_at = issue.received_at AND later.rowid > issue.rowid))
        )
      ORDER BY task_id, received_at DESC, rowid DESC
    `.pipe(
      NodeSqliteClient.readOnly,
      Effect.map(deliveryIssues),
      Effect.mapError(
        (cause) => new ScheduledTaskError({ message: "Could not read webhook deliveries.", cause }),
      ),
    );
  return {
    decorateAll: Effect.fn("WebhookDeliveryIssues.decorateAll")(function* (
      tasks: ReadonlyArray<ScheduledTask>,
    ) {
      const issues = yield* select();
      return tasks.map((task): ScheduledTask => {
        const issue = issues.get(task.id);
        return issue === undefined ? task : { ...task, lastDeliveryIssue: issue };
      });
    }),
  };
});
