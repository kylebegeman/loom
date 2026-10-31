// @effect-diagnostics-next-line nodeBuiltinImport:off -- Request fingerprints use synchronous, deterministic SHA-256.
import * as NodeCrypto from "node:crypto";
import { ProjectId } from "@t3tools/contracts";
import { BotsError } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { BotCaller } from "./BotsService.ts";

type AdmissionKind = "run" | "batch" | "pipeline";
type AdmissionInput = { readonly clientRequestId?: string };

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};
const digest = (value: unknown) =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const scopeOf = (caller: BotCaller) =>
  digest([caller.actor, caller.requestScope ?? caller.threadId ?? "local", caller.projectId]);
const contentOf = (input: AdmissionInput, caller: BotCaller) =>
  digest([input, caller.threadId, caller.projectId, caller.runtimeMode]);

export const makeBotAdmissions = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return {
    find: Effect.fn("BotAdmissions.find")(function* (input: {
      readonly clientRequestId: string;
      readonly kind?: AdmissionKind;
      readonly projectId?: ProjectId;
    }) {
      const project = input.projectId ?? null;
      const kind = input.kind ?? null;
      const rows = yield* sql<{
        kind: AdmissionKind;
        id: string;
        project_id: string | null;
        created_at: string;
      }>`
        SELECT DISTINCT jobs.kind, jobs.id, jobs.project_id, jobs.created_at FROM fork_bots_admissions receipts
        JOIN (
          SELECT 'run' AS kind, id, project_id, created_at FROM fork_bots_runs
          UNION ALL SELECT 'batch', id, project_id, created_at FROM fork_bots_batches
          UNION ALL SELECT 'pipeline', id, project_id, created_at FROM fork_bots_pipeline_runs
        ) jobs ON receipts.kind = jobs.kind AND receipts.job_id = jobs.id
        WHERE receipts.request_id = ${input.clientRequestId}
          AND (${kind} IS NULL OR jobs.kind = ${kind})
          AND (${project} IS NULL OR jobs.project_id = ${project})
        ORDER BY jobs.created_at DESC, jobs.id DESC LIMIT 21
      `.pipe(
        Effect.mapError(
          () =>
            new BotsError({
              reason: "storage",
              message: "Loom could not find bot request receipts.",
            }),
        ),
      );
      return {
        matches: rows.slice(0, 20).map((row) => ({
          kind: row.kind,
          id: row.id,
          projectId: row.project_id === null ? null : ProjectId.make(row.project_id),
          createdAt: row.created_at,
        })),
        hasMore: rows.length > 20,
      };
    }),
    lookup: Effect.fn("BotAdmissions.lookup")(function* (
      kind: AdmissionKind,
      input: AdmissionInput,
      caller: BotCaller,
    ) {
      if (input.clientRequestId === undefined) return null;
      const rows = yield* sql<{
        request_hash: string;
        job_id: string;
      }>`SELECT request_hash, job_id FROM fork_bots_admissions WHERE caller_scope = ${scopeOf(caller)} AND kind = ${kind} AND request_id = ${input.clientRequestId}`.pipe(
        Effect.mapError(
          () =>
            new BotsError({
              reason: "storage",
              message: "Loom could not read bot request receipts.",
            }),
        ),
      );
      const row = rows[0];
      if (row === undefined) return null;
      if (row.request_hash !== contentOf(input, caller))
        return yield* new BotsError({
          reason: "invalid",
          message: "This clientRequestId was already used with different bot inputs or settings.",
        });
      return row.job_id;
    }),
    // The receipt and job row must commit together, before a worker can start.
    record: Effect.fn("BotAdmissions.record")(function* (
      kind: AdmissionKind,
      input: AdmissionInput,
      caller: BotCaller,
      jobId: string,
    ) {
      if (input.clientRequestId === undefined) return;
      yield* sql`INSERT INTO fork_bots_admissions (caller_scope, kind, request_id, request_hash, job_id) VALUES (${scopeOf(caller)}, ${kind}, ${input.clientRequestId}, ${contentOf(input, caller)}, ${jobId})`;
    }),
  };
});
