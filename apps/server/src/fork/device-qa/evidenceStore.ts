import { DevicePlatform, ThreadId } from "@t3tools/contracts";
import {
  DeviceQaEvidenceKind,
  DeviceQaEvidenceStatus,
  type DeviceQaEvidence,
} from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** watchEvidence sends at most this many items; totals cover all of them. */
export const EVIDENCE_LISTED = 200;

interface EvidenceRow {
  readonly id: string;
  readonly thread_id: string;
  readonly kind: string;
  readonly status: string;
  readonly host_id: string;
  readonly device_id: string;
  readonly platform: string;
  readonly device_name: string;
  readonly label: string | null;
  readonly path: string | null;
  readonly mime_type: string | null;
  readonly size_bytes: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration_ms: number | null;
  readonly detail: string | null;
  readonly created_by: string;
  readonly created_at: string;
}

const isKind = Schema.is(DeviceQaEvidenceKind);
const isStatus = Schema.is(DeviceQaEvidenceStatus);
const isPlatform = Schema.is(DevicePlatform);
const numberOrNull = (value: number | null) => (value === null ? null : Number(value));

const toEvidence = (row: EvidenceRow): DeviceQaEvidence | null => {
  const { kind, status, platform } = row;
  if (!isKind(kind) || !isStatus(status) || !isPlatform(platform)) return null;
  return {
    id: row.id,
    threadId: ThreadId.make(row.thread_id),
    kind,
    status,
    target: { hostId: row.host_id, deviceId: row.device_id, platform },
    deviceName: row.device_name,
    label: row.label,
    path: row.path,
    mimeType: row.mime_type,
    sizeBytes: numberOrNull(row.size_bytes),
    width: numberOrNull(row.width),
    height: numberOrNull(row.height),
    durationMs: numberOrNull(row.duration_ms),
    detail: row.detail,
    createdBy: row.created_by === "agent" ? "agent" : "user",
    createdAt: row.created_at,
  };
};

const toEvidenceList = (rows: ReadonlyArray<EvidenceRow>) =>
  rows.flatMap((row) => toEvidence(row) ?? []);

/** Items a sweep may delete: never one still recording or finalizing. */
const SETTLED = ["ready", "failed"];

/** Items created before this ISO time are older than `days`. */
export const expiryCutoff = (nowMs: number, days: number) =>
  DateTime.formatIso(DateTime.subtract(DateTime.makeUnsafe(nowMs), { days }));

export const makeEvidenceStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  return {
    insert: Effect.fn("DeviceQaEvidenceStore.insert")(function* (item: DeviceQaEvidence) {
      yield* sql`INSERT INTO fork_device_qa_evidence (id,thread_id,kind,status,host_id,device_id,platform,device_name,label,path,mime_type,size_bytes,width,height,duration_ms,detail,created_by,created_at) VALUES (${item.id},${item.threadId},${item.kind},${item.status},${item.target.hostId},${item.target.deviceId},${item.target.platform},${item.deviceName},${item.label},${item.path},${item.mimeType},${item.sizeBytes},${item.width},${item.height},${item.durationMs === null ? null : Math.round(item.durationMs)},${item.detail},${item.createdBy},${item.createdAt})`;
    }),

    /** Writes what a capture learns after it starts: status, file and its measurements. */
    save: Effect.fn("DeviceQaEvidenceStore.save")(function* (item: DeviceQaEvidence) {
      yield* sql`UPDATE fork_device_qa_evidence SET status = ${item.status}, path = ${item.path}, mime_type = ${item.mimeType}, size_bytes = ${item.sizeBytes}, width = ${item.width}, height = ${item.height}, duration_ms = ${item.durationMs === null ? null : Math.round(item.durationMs)}, detail = ${item.detail} WHERE id = ${item.id}`;
    }),

    get: Effect.fn("DeviceQaEvidenceStore.get")(function* (id: string) {
      const rows = yield* sql<EvidenceRow>`SELECT * FROM fork_device_qa_evidence WHERE id = ${id}`;
      return rows[0] ? toEvidence(rows[0]) : null;
    }),

    /** Newest first. */
    listForThread: Effect.fn("DeviceQaEvidenceStore.listForThread")(function* (
      threadId: string,
      limit = EVIDENCE_LISTED,
    ) {
      return toEvidenceList(
        yield* sql<EvidenceRow>`SELECT * FROM fork_device_qa_evidence WHERE thread_id = ${threadId} ORDER BY created_at DESC, id DESC LIMIT ${limit}`,
      );
    }),

    /** Every item of a thread, for deleting them all. */
    allForThread: Effect.fn("DeviceQaEvidenceStore.allForThread")(function* (threadId: string) {
      return toEvidenceList(
        yield* sql<EvidenceRow>`SELECT * FROM fork_device_qa_evidence WHERE thread_id = ${threadId}`,
      );
    }),

    /**
     * Count over the thread's whole evidence, and the bytes deleting it frees. Installs have no
     * file, and a flow report's file belongs to its run, so neither adds bytes.
     */
    totals: Effect.fn("DeviceQaEvidenceStore.totals")(function* (threadId: string) {
      const rows = yield* sql<{
        count: number;
        bytes: number;
      }>`SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN kind = 'flow-report' THEN 0 ELSE size_bytes END), 0) AS bytes FROM fork_device_qa_evidence WHERE thread_id = ${threadId}`;
      return { totalCount: Number(rows[0]?.count ?? 0), totalBytes: Number(rows[0]?.bytes ?? 0) };
    }),

    threadIds: Effect.fn("DeviceQaEvidenceStore.threadIds")(function* () {
      const rows = yield* sql<{
        thread_id: string;
      }>`SELECT DISTINCT thread_id FROM fork_device_qa_evidence`;
      return rows.map((row) => row.thread_id);
    }),

    /** Settled items created before the cutoff, for the expiry sweep. */
    expired: Effect.fn("DeviceQaEvidenceStore.expired")(function* (cutoffIso: string) {
      return toEvidenceList(
        yield* sql<EvidenceRow>`SELECT * FROM fork_device_qa_evidence WHERE created_at < ${cutoffIso} AND status IN ${sql.in(SETTLED)}`,
      );
    }),

    delete: Effect.fn("DeviceQaEvidenceStore.delete")(function* (id: string) {
      yield* sql`DELETE FROM fork_device_qa_evidence WHERE id = ${id}`;
    }),

    deleteForThread: Effect.fn("DeviceQaEvidenceStore.deleteForThread")(function* (
      threadId: string,
    ) {
      yield* sql`DELETE FROM fork_device_qa_evidence WHERE thread_id = ${threadId}`;
    }),

    /** Recordings the previous server left open cannot be finalized any more. */
    failStaleRecordings: Effect.fn("DeviceQaEvidenceStore.failStaleRecordings")(function* () {
      const rows =
        yield* sql<EvidenceRow>`SELECT * FROM fork_device_qa_evidence WHERE status IN ('recording', 'finalizing')`;
      yield* sql`UPDATE fork_device_qa_evidence SET status = 'failed', detail = 'The server stopped during the recording.' WHERE status IN ('recording', 'finalizing')`;
      return toEvidenceList(rows);
    }),
  };
});

export type DeviceQaEvidenceStore = Effect.Success<typeof makeEvidenceStore>;
