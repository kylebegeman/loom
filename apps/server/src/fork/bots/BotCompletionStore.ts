import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import {
  BotCompletionDelivery,
  BotCompletionDestination,
  BotsError,
  BotRunComputer,
  type BotCompletionDeliveriesInput,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

type CompletionKind = BotCompletionDelivery["kind"];
export const UNRESOLVED_COMPLETION_STATUSES = [
  "pending",
  "retrying",
  "sending",
  "accepted",
  "needs_attention",
] as const;
interface CompletionDestinationRow {
  readonly id: string;
  readonly label: string;
  readonly project_id: string;
  readonly host: string;
  readonly enabled: number;
  readonly fingerprint: string;
  readonly created_at: string;
  readonly deleted_at: string | null;
}
interface DeliveryRow {
  readonly id: string;
  readonly destination_id: string;
  readonly kind: string;
  readonly job_id: string;
  readonly project_id: string;
  readonly status: string;
  readonly attempts: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly accepted_at: string | null;
  readonly acknowledged_at: string | null;
  readonly receiver_outcome: string | null;
  readonly last_http_status: number | null;
  readonly reason: string | null;
}
const completionStorageError = () =>
  new BotsError({
    reason: "storage",
    message: "Loom could not read or save bot completion delivery state.",
  });
const Snapshot = Schema.Struct({
  status: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  name: Schema.String.check(Schema.isMaxLength(120)),
  verdict: Schema.NullOr(Schema.String),
  threads: Schema.Array(
    Schema.Struct({ threadId: ThreadId, environmentId: Schema.NullOr(EnvironmentId) }),
  ).check(Schema.isMaxLength(5)),
});
const snapshotJson = Schema.fromJsonString(Snapshot);
const encodeSnapshot = Schema.encodeEffect(snapshotJson);
const decodeSnapshot = Schema.decodeUnknownEffect(snapshotJson);
const decodeComputer = Schema.decodeUnknownOption(Schema.fromJsonString(BotRunComputer));
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const decodeDestination = Schema.decodeUnknownEffect(BotCompletionDestination);
const decodeDelivery = Schema.decodeUnknownEffect(BotCompletionDelivery);
const destination = (row: CompletionDestinationRow) =>
  decodeDestination({
    id: row.id,
    label: row.label,
    projectId: row.project_id,
    host: row.host,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  }).pipe(Effect.mapError(completionStorageError));
const delivery = (row: DeliveryRow) =>
  decodeDelivery({
    id: row.id,
    destinationId: row.destination_id,
    kind: row.kind,
    jobId: row.job_id,
    projectId: row.project_id,
    status: row.status,
    attempts: Number(row.attempts),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    acceptedAt: row.accepted_at,
    acknowledgedAt: row.acknowledged_at,
    receiverOutcome: row.receiver_outcome,
    lastHttpStatus: row.last_http_status,
    reason: row.reason,
  }).pipe(Effect.mapError(completionStorageError));

export const makeBotCompletionStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const getDestination = Effect.fn("BotCompletionStore.getDestination")(function* (id: string) {
    const rows =
      yield* sql<CompletionDestinationRow>`SELECT * FROM fork_bots_completion_destinations WHERE id = ${id}`.pipe(
        Effect.mapError(completionStorageError),
      );
    return rows[0] ?? null;
  });
  const requireDestination = Effect.fn("BotCompletionStore.requireDestination")(function* (
    id: string,
  ) {
    const stored = yield* getDestination(id);
    if (stored === null || stored.deleted_at !== null)
      return yield* new BotsError({
        reason: "invalid",
        message: "This completion destination no longer exists.",
      });
    return stored;
  });
  const getDelivery = Effect.fn("BotCompletionStore.getDelivery")(function* (id: string) {
    const rows =
      yield* sql<DeliveryRow>`SELECT * FROM fork_bots_completion_deliveries WHERE id = ${id}`.pipe(
        Effect.mapError(completionStorageError),
      );
    if (rows[0] === undefined)
      return yield* new BotsError({
        reason: "invalid",
        message: "This completion delivery does not exist.",
      });
    return yield* delivery(rows[0]);
  });
  const currentOutcome = Effect.fn("BotCompletionStore.outcome")(function* (
    kind: CompletionKind,
    id: string,
  ) {
    const rows =
      kind === "run"
        ? yield* sql<{
            status: string;
            finished_at: string | null;
            name: string;
            verdict: string | null;
          }>`SELECT status,finished_at,bot_name AS name,verdict FROM fork_bots_runs WHERE id = ${id}`
        : kind === "batch"
          ? yield* sql<{
              status: string;
              finished_at: string | null;
              name: string;
              verdict: string | null;
            }>`SELECT status,finished_at,bot_name AS name,NULL AS verdict FROM fork_bots_batches WHERE id = ${id}`
          : yield* sql<{
              status: string;
              finished_at: string | null;
              name: string;
              verdict: string | null;
            }>`SELECT status,finished_at,pipeline_name AS name,final_verdict AS verdict FROM fork_bots_pipeline_runs WHERE id = ${id}`;
    return rows[0] ?? null;
  }, Effect.mapError(completionStorageError));
  const currentThreads = Effect.fn("BotCompletionStore.threads")(function* (
    kind: CompletionKind,
    id: string,
  ) {
    return yield* sql<{
      thread_id: string;
      ran_on_json: string | null;
    }>`SELECT thread_id,ran_on_json FROM fork_bots_runs WHERE (${kind} = 'run' AND id = ${id}) OR (${kind} = 'batch' AND batch_id = ${id}) OR (${kind} = 'pipeline' AND pipeline_run_id = ${id}) ORDER BY created_at LIMIT 5`.pipe(
      Effect.mapError(completionStorageError),
    );
  });
  const snapshot = Effect.fn("BotCompletionStore.snapshot")(function* (
    kind: CompletionKind,
    id: string,
  ) {
    const intents = yield* sql<{
      id: string;
    }>`SELECT id FROM fork_bots_completion_deliveries WHERE kind = ${kind} AND job_id = ${id} AND outcome_json IS NULL`.pipe(
      Effect.mapError(completionStorageError),
    );
    if (intents.length === 0) return false;
    const outcome = yield* currentOutcome(kind, id);
    if (outcome === null) return false;
    const terminal =
      kind === "run"
        ? outcome.status !== "queued" && outcome.status !== "running"
        : kind === "batch"
          ? outcome.status === "finished" || outcome.status === "cancelled"
          : outcome.status === "completed" ||
            outcome.status === "failed" ||
            outcome.status === "cancelled";
    if (!terminal) return false;
    const threads = yield* currentThreads(kind, id);
    const json = yield* encodeSnapshot({
      status: outcome.status,
      finishedAt: outcome.finished_at,
      name: outcome.name.slice(0, 120),
      verdict: outcome.verdict,
      threads: threads.map((thread) => {
        const computer =
          thread.ran_on_json === null ? Option.none() : decodeComputer(thread.ran_on_json);
        return {
          threadId: ThreadId.make(thread.thread_id),
          environmentId: Option.isSome(computer) ? computer.value.environmentId : null,
        };
      }),
    }).pipe(Effect.mapError(completionStorageError));
    const updated = yield* sql<{
      id: string;
    }>`UPDATE fork_bots_completion_deliveries SET outcome_json = ${json} WHERE kind = ${kind} AND job_id = ${id} AND outcome_json IS NULL RETURNING id`.pipe(
      Effect.mapError(completionStorageError),
    );
    return updated.length > 0;
  });

  return {
    getDestination,
    requireDestination,
    getDelivery,
    destination,
    prepare: Effect.fn("BotCompletionStore.prepare")(function* (
      kind: CompletionKind,
      jobId: string,
      projectId: ProjectId | null,
      destinationId: string | undefined,
    ) {
      if (destinationId === undefined) return;
      const target = yield* requireDestination(destinationId);
      if (projectId === null || target.project_id !== projectId)
        return yield* new BotsError({
          reason: "permission",
          message: "The completion destination belongs to a different execution project.",
        });
      if (target.enabled !== 1)
        return yield* new BotsError({
          reason: "invalid",
          message: "This completion destination is disabled.",
        });
      const at = yield* nowIso;
      const id = `bot-completion:${kind}:${jobId}`;
      yield* sql`INSERT INTO fork_bots_completion_deliveries (id,destination_id,kind,job_id,project_id,status,created_at,updated_at,next_attempt_at) VALUES (${id},${destinationId},${kind},${jobId},${projectId},'pending',${at},${at},${at})`.pipe(
        Effect.mapError(completionStorageError),
      );
      yield* snapshot(kind, jobId);
    }),
    listDestinations: Effect.fn("BotCompletionStore.listDestinations")(function* (
      projectId?: ProjectId,
    ) {
      const project = projectId ?? null;
      const rows =
        yield* sql<CompletionDestinationRow>`SELECT * FROM fork_bots_completion_destinations WHERE deleted_at IS NULL AND (${project} IS NULL OR project_id = ${project}) ORDER BY created_at DESC, id LIMIT 100`.pipe(
          Effect.mapError(completionStorageError),
        );
      return { destinations: yield* Effect.forEach(rows, destination) };
    }),
    saveDestination: Effect.fn("BotCompletionStore.saveDestination")(function* (
      row: CompletionDestinationRow,
    ) {
      yield* sql`INSERT INTO fork_bots_completion_destinations (id,label,project_id,host,enabled,fingerprint,created_at) VALUES (${row.id},${row.label},${row.project_id},${row.host},${row.enabled},${row.fingerprint},${row.created_at})`.pipe(
        Effect.mapError(completionStorageError),
      );
      return yield* destination(row);
    }),
    setEnabled: Effect.fn("BotCompletionStore.setEnabled")(function* (
      id: string,
      enabled: boolean,
    ) {
      const current = yield* requireDestination(id);
      yield* sql`UPDATE fork_bots_completion_destinations SET enabled = ${enabled ? 1 : 0} WHERE id = ${id}`.pipe(
        Effect.mapError(completionStorageError),
      );
      return yield* destination({ ...current, enabled: enabled ? 1 : 0 });
    }),
    remove: Effect.fn("BotCompletionStore.remove")(function* (id: string) {
      const at = yield* nowIso;
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`UPDATE fork_bots_completion_destinations SET enabled = 0, deleted_at = COALESCE(deleted_at,${at}) WHERE id = ${id}`;
            yield* sql`UPDATE fork_bots_completion_deliveries SET status = 'cancelled', reason = 'destination_removed', updated_at = ${at} WHERE destination_id = ${id} AND (status IN ('pending','retrying') OR (status = 'needs_attention' AND reason IN ('credentials_unavailable','destination_invalid','job_unavailable')))`;
          }),
        )
        .pipe(Effect.mapError(completionStorageError));
    }),
    deliveries: Effect.fn("BotCompletionStore.deliveries")(function* (
      input: typeof BotCompletionDeliveriesInput.Type,
    ) {
      const target = input.destinationId ?? null;
      const project = input.projectId ?? null;
      const rows =
        yield* sql<DeliveryRow>`SELECT * FROM fork_bots_completion_deliveries WHERE (${target} IS NULL OR destination_id = ${target}) AND (${project} IS NULL OR project_id = ${project}) ORDER BY created_at DESC, id DESC LIMIT 20`.pipe(
          Effect.mapError(completionStorageError),
        );
      return { deliveries: yield* Effect.forEach(rows, delivery) };
    }),
    recoverSending: Effect.fn("BotCompletionStore.recoverSending")(function* () {
      const at = yield* nowIso;
      const uncertain = yield* sql<{
        id: string;
      }>`UPDATE fork_bots_completion_deliveries SET status = 'needs_attention', reason = 'outcome_unknown', updated_at = ${at} WHERE status = 'sending' RETURNING id`;
      const missing = yield* sql<{
        id: string;
      }>`UPDATE fork_bots_completion_deliveries SET status = 'needs_attention', reason = 'job_unavailable', updated_at = ${at} WHERE status IN ('pending','retrying') AND outcome_json IS NULL AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT 'run' AS kind,id FROM fork_bots_runs
          UNION ALL SELECT 'batch',id FROM fork_bots_batches
          UNION ALL SELECT 'pipeline',id FROM fork_bots_pipeline_runs
        ) job WHERE job.kind = fork_bots_completion_deliveries.kind AND job.id = fork_bots_completion_deliveries.job_id
      ) RETURNING id`;
      return uncertain.length + missing.length > 0;
    }, Effect.mapError(completionStorageError)),
    due: Effect.fn("BotCompletionStore.due")(function* () {
      const at = yield* nowIso;
      const rows =
        yield* sql<DeliveryRow>`SELECT delivery.* FROM fork_bots_completion_deliveries delivery JOIN fork_bots_completion_destinations target ON delivery.destination_id = target.id
      WHERE delivery.status IN ('pending','retrying') AND delivery.outcome_json IS NOT NULL AND delivery.next_attempt_at <= ${at} AND target.enabled = 1 AND target.deleted_at IS NULL
      ORDER BY delivery.next_attempt_at,delivery.id LIMIT 20`.pipe(
          Effect.mapError(completionStorageError),
        );
      return yield* Effect.forEach(rows, delivery);
    }),
    claim: Effect.fn("BotCompletionStore.claim")(function* (id: string) {
      const at = yield* nowIso;
      const rows = yield* sql<{
        id: string;
      }>`UPDATE fork_bots_completion_deliveries SET status = 'sending', attempts = attempts + 1, updated_at = ${at}, reason = NULL WHERE id = ${id} AND status IN ('pending','retrying') RETURNING id`.pipe(
        Effect.mapError(completionStorageError),
      );
      return rows.length > 0;
    }),
    settle: Effect.fn("BotCompletionStore.settle")(function* (
      id: string,
      status: BotCompletionDelivery["status"],
      reason: string | null,
      httpStatus: number | null,
      nextAttemptAt: string | null = null,
    ) {
      const at = yield* nowIso;
      const updated = yield* sql<{
        id: string;
      }>`UPDATE fork_bots_completion_deliveries SET status = ${status}, reason = ${reason}, last_http_status = ${httpStatus}, updated_at = ${at}, accepted_at = CASE WHEN ${status} = 'accepted' THEN ${at} ELSE accepted_at END, next_attempt_at = COALESCE(${nextAttemptAt},next_attempt_at) WHERE id = ${id} AND status = 'sending' RETURNING id`.pipe(
        Effect.mapError(completionStorageError),
      );
      return updated.length > 0;
    }),
    acknowledge: Effect.fn("BotCompletionStore.acknowledge")(function* (input: {
      deliveryId: string;
      projectId: ProjectId;
      outcome: "completed" | "failed";
    }) {
      const current = yield* getDelivery(input.deliveryId);
      if (current.projectId !== input.projectId)
        return yield* new BotsError({
          reason: "permission",
          message: "The completion delivery belongs to another project.",
        });
      if (current.status === "acknowledged") {
        if (current.receiverOutcome !== input.outcome)
          return yield* new BotsError({
            reason: "invalid",
            message: "This completion was already acknowledged with a different outcome.",
          });
        return current;
      }
      if (
        current.status !== "accepted" &&
        !(current.status === "needs_attention" && current.reason === "outcome_unknown")
      )
        return yield* new BotsError({
          reason: "invalid",
          message: "Only an accepted or uncertain completion delivery can be acknowledged.",
        });
      const at = yield* nowIso;
      yield* sql`UPDATE fork_bots_completion_deliveries SET status = 'acknowledged', acknowledged_at = ${at}, receiver_outcome = ${input.outcome}, updated_at = ${at}, reason = NULL WHERE id = ${input.deliveryId}`.pipe(
        Effect.mapError(completionStorageError),
      );
      return yield* getDelivery(input.deliveryId);
    }),
    outcome: Effect.fn("BotCompletionStore.outcome")(function* (kind: CompletionKind, id: string) {
      const rows = yield* sql<{
        outcome_json: string | null;
      }>`SELECT outcome_json FROM fork_bots_completion_deliveries WHERE kind = ${kind} AND job_id = ${id}`;
      const json = rows[0]?.outcome_json;
      return json == null ? null : yield* decodeSnapshot(json);
    }, Effect.mapError(completionStorageError)),
    snapshot,
  };
});
