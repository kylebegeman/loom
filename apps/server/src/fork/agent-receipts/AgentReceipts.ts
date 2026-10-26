import {
  type NodeId,
  type OrchestrationV2Subagent,
  type OrchestrationV2ThreadProjection,
  type RunId,
  ThreadId,
} from "@t3tools/contracts";
import { AgentReceipt, AgentReceiptError, type AgentReceiptSummary } from "@t3tools/contracts/fork";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import {
  buildRunReceipt,
  buildSubagentReceipt,
  type ChildRecords,
  isTerminalReceiptStatus,
  type Lineage,
  type ReceiptBody,
  resultLine,
  runPrompt,
  subagentGeneration,
  subagentPrompt,
} from "./buildReceipt.ts";
import {
  type ClaudeAgentTranscript,
  locateClaudeAgentTranscript,
  readClaudeAgentTranscript,
} from "./claudeTranscript.ts";

/** Bump when receipts gain a source the backfill should fill in for older records. */
export const BACKFILL_VERSION = 1;

/** Claude config folders searched for sub-agent transcripts; discovered from HOME when unset. */
export const ClaudeConfigDirs = Context.Reference<ReadonlyArray<string> | undefined>(
  "t3/fork/agent-receipts/ClaudeConfigDirs",
  { defaultValue: () => undefined },
);

export interface BackfillResult {
  readonly scanned: number;
  readonly written: number;
  readonly unchanged: number;
  readonly failed: number;
}

export interface EvictionCandidate {
  readonly childThreadId: ThreadId;
  readonly threadId: ThreadId;
  readonly subjectId: string;
  readonly receiptId: string | null;
  readonly evictable: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly childBytes: number;
  readonly receiptBytes: number;
}

export interface EvictionReport {
  readonly children: number;
  readonly evictable: number;
  readonly evictableBytes: number;
  readonly keptBytes: number;
  readonly receiptBytes: number;
  readonly reasons: Readonly<Record<string, number>>;
  readonly candidates: ReadonlyArray<EvictionCandidate>;
}

type Parent = Pick<
  OrchestrationV2ThreadProjection,
  "thread" | "subagents" | "runs" | "checkpoints" | "providerThreads" | "providerSessions"
>;

export class AgentReceipts extends Context.Service<
  AgentReceipts,
  {
    readonly recordSubagent: (
      threadId: ThreadId,
      subagentId: NodeId,
      options?: { readonly refreshMembers?: boolean },
    ) => Effect.Effect<AgentReceipt | null, AgentReceiptError>;
    readonly recordRun: (
      threadId: ThreadId,
      runId: RunId,
    ) => Effect.Effect<AgentReceipt | null, AgentReceiptError>;
    /** Rebuilds receipts a newly captured checkpoint can add files to. */
    readonly noteCheckpoint: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId | null;
      readonly nodeId: NodeId;
    }) => Effect.Effect<void, AgentReceiptError>;
    readonly list: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<AgentReceiptSummary>, AgentReceiptError>;
    readonly get: (
      threadId: ThreadId,
      subjectId: string,
    ) => Effect.Effect<AgentReceipt, AgentReceiptError>;
    readonly forThread: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<AgentReceipt>, AgentReceiptError>;
    readonly backfill: Effect.Effect<BackfillResult, AgentReceiptError>;
    /** Runs the backfill unless this version already finished on this database. */
    readonly backfillOnce: Effect.Effect<BackfillResult | null, AgentReceiptError>;
    readonly evictionReport: Effect.Effect<EvictionReport, AgentReceiptError>;
  }
>()("t3/fork/agent-receipts/AgentReceipts") {}

const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(AgentReceipt));
const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(AgentReceipt));

const isReceiptError = Schema.is(AgentReceiptError);
const ioError = (message: string) => (cause: unknown) =>
  isReceiptError(cause)
    ? cause
    : new AgentReceiptError({
        reason: "io",
        message: `${message}: ${cause instanceof Error ? cause.message : String(cause)}`,
      });

/**
 * The receipts a Library snapshot of `threadId` at `sequence` carries: every receipt under that
 * conversation written before the event after `sequence`, so one sequence always gives one set.
 */
export const receiptsForArchive = Effect.fn("AgentReceipts.forArchive")(function* (
  sql: SqlClient.SqlClient,
  threadId: ThreadId,
  sequence: number,
) {
  const rows = yield* sql<{ payload_json: string }>`
    SELECT payload_json FROM fork_agent_receipts
    WHERE root_thread_id=${threadId} AND visible_sequence<=${sequence}
      AND (superseded_sequence IS NULL OR superseded_sequence>${sequence})
    ORDER BY visible_sequence, subject_id, generation`;
  return yield* Effect.forEach(rows, (row) => decodeReceipt(row.payload_json));
});

const summarize = (receipt: AgentReceipt): AgentReceiptSummary => ({
  id: receipt.id,
  kind: receipt.kind,
  subjectId: receipt.subjectId,
  generation: receipt.generation,
  status: receipt.status,
  resultLine: resultLine(receipt.result.text),
  resultLength: receipt.result.text.length,
  filesChanged: receipt.files.length,
  commandCount: receipt.commands.count,
  failedCommands: receipt.commands.failed.length,
  memberCount: receipt.memberReceiptIds.length,
});

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configuredDirs = yield* ClaudeConfigDirs;
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const claudeDirEnv = yield* Config.String("CLAUDE_CONFIG_DIR").pipe(Config.withDefault(""));

  const withFiles = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const sha256 = (text: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(text)).pipe(Effect.map(Hex.encode));

  let discoveredDirs: ReadonlyArray<string> | undefined = configuredDirs;
  const claudeDirs = Effect.gen(function* () {
    if (discoveredDirs !== undefined) return discoveredDirs;
    const names =
      home === "" ? [] : yield* fs.readDirectory(home).pipe(Effect.orElseSucceed(() => []));
    const dirs = new Set<string>(claudeDirEnv === "" ? [] : [claudeDirEnv]);
    for (const name of names.toSorted())
      if (name === ".claude" || /^\.claude_[A-Za-z0-9_-]+$/u.test(name))
        if (
          yield* fs
            .exists(path.join(home, name, "projects"))
            .pipe(Effect.orElseSucceed(() => false))
        )
          dirs.add(path.join(home, name));
    discoveredDirs = [...dirs];
    return discoveredDirs;
  });

  const parentRecords = (threadId: ThreadId) =>
    projections.getThreadRecords(threadId, [
      "subagents",
      "runs",
      "checkpoints",
      "providerThreads",
      "providerSessions",
    ]);

  const childRecords = (threadId: ThreadId | null) =>
    threadId === null
      ? Effect.succeed(null)
      : projections
          .getThreadRecords(threadId, ["runs", "messages", "turnItems", "checkpoints", "subagents"])
          .pipe(Effect.orElseSucceed(() => null));

  const lineageOf = Effect.fnUntraced(function* (parent: Parent, fallbackSubject: string | null) {
    const lineage = parent.thread.lineage;
    let parentSubjectId = fallbackSubject;
    if (lineage.parentThreadId !== null) {
      const grand = yield* projections
        .getThreadRecords(lineage.parentThreadId, ["subagents"])
        .pipe(Effect.orElseSucceed(() => null));
      parentSubjectId =
        grand?.subagents.find((candidate) => candidate.childThreadId === parent.thread.id)?.id ??
        null;
    }
    return {
      threadId: parent.thread.id,
      parentThreadId: lineage.parentThreadId,
      rootThreadId: lineage.rootThreadId,
      parentSubjectId,
    } satisfies Lineage;
  });

  const existing = (subjectId: string, generation: string) =>
    sql<{ receipt_id: string; visible_sequence: number }>`
      SELECT receipt_id,visible_sequence FROM fork_agent_receipts
      WHERE subject_id=${subjectId} AND generation=${generation} AND superseded_sequence IS NULL`.pipe(
      Effect.map((rows) => rows[0]),
    );

  /**
   * Writes the receipt when its content changed; returns it and whether it was written. A version a
   * snapshot may already hold is closed rather than rewritten, so older snapshots stay reproducible.
   */
  const store = Effect.fnUntraced(function* (body: ReceiptBody) {
    // The encoded form follows the schema's field order, so equal content hashes equally.
    const id = yield* sha256(yield* encodeReceipt({ id: "", ...body }));
    const receipt: AgentReceipt = { id, ...body };
    const payload = yield* encodeReceipt(receipt);
    const now = DateTime.formatIso(yield* DateTime.now);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const current = yield* existing(body.subjectId, body.generation);
        if (current?.receipt_id === id) return { receipt, written: false };
        const next =
          (yield* sql<{ next: number }>`
            SELECT COALESCE(MAX(sequence),0)+1 AS next FROM orchestration_events`)[0]?.next ?? 1;
        if (current !== undefined && current.visible_sequence === next)
          yield* sql`DELETE FROM fork_agent_receipts WHERE subject_id=${body.subjectId} AND generation=${body.generation} AND visible_sequence=${next}`;
        else if (current !== undefined)
          yield* sql`UPDATE fork_agent_receipts SET superseded_sequence=${next} WHERE subject_id=${body.subjectId} AND generation=${body.generation} AND superseded_sequence IS NULL`;
        yield* sql`INSERT INTO fork_agent_receipts (subject_id,generation,kind,receipt_id,thread_id,root_thread_id,child_thread_id,visible_sequence,payload_json,recorded_at)
          VALUES (${body.subjectId},${body.generation},${body.kind},${id},${body.threadId},${body.rootThreadId},${body.childThreadId},${next},${payload},${now})`;
        return { receipt, written: true };
      }),
    );
  });

  const transcriptFor = Effect.fnUntraced(function* (
    parent: Parent,
    subagent: OrchestrationV2Subagent,
  ) {
    const agentId = subagent.nativeTaskRef?.nativeId;
    if (
      subagent.driver !== "claudeAgent" ||
      subagent.origin !== "provider_native" ||
      agentId === undefined ||
      agentId === null
    )
      return null;
    const run = parent.runs.find((candidate) => candidate.id === subagent.runId);
    const providerThread = parent.providerThreads.find(
      (candidate) =>
        candidate.id === (run?.providerThreadId ?? parent.thread.activeProviderThreadId),
    );
    const sessionId = providerThread?.nativeThreadRef?.nativeId;
    if (sessionId === undefined || sessionId === null) return null;
    const cwd = parent.providerSessions.find(
      (session) => session.id === providerThread?.providerSessionId,
    )?.cwd;
    const file = yield* locateClaudeAgentTranscript({
      configDirs: yield* claudeDirs,
      sessionId,
      agentId,
      cwd,
    }).pipe(withFiles);
    if (file === undefined) return null;
    return yield* readClaudeAgentTranscript(file).pipe(
      withFiles,
      Effect.orElseSucceed(() => null),
    );
  });

  /** A workflow member's roster entry and transcript, from the coordinator that owns its thread. */
  const workflowMemberOf = Effect.fnUntraced(function* (
    parent: Parent,
    subagent: OrchestrationV2Subagent,
  ) {
    const owner = parent.thread.lineage.parentThreadId;
    if (owner === null || subagent.childThreadId === null) return undefined;
    const grand = yield* projections
      .getThreadRecords(owner, ["subagents"])
      .pipe(Effect.orElseSucceed(() => null));
    const coordinator = grand?.subagents.find(
      (candidate) =>
        candidate.childThreadId === parent.thread.id && candidate.workflow !== undefined,
    );
    const member = coordinator?.workflow?.agents.find(
      (agent) => agent.childThreadId === subagent.childThreadId,
    );
    if (member === undefined) return undefined;
    const dir = coordinator?.workflow?.runHandles?.transcriptDir;
    return {
      member,
      transcriptPath:
        dir === undefined || member.agentId === undefined
          ? null
          : path.join(dir, `agent-${member.agentId}.jsonl`),
    };
  });

  const recordFrom: (
    parent: Parent,
    subagent: OrchestrationV2Subagent,
    options: { readonly refreshMembers: boolean; readonly cascade: boolean },
  ) => Effect.Effect<
    { readonly receipt: AgentReceipt; readonly written: boolean } | null,
    AgentReceiptError
  > = Effect.fnUntraced(
    function* (parent, subagent, options) {
      const status = subagent.status;
      if (!isTerminalReceiptStatus(status)) return null;
      const child = yield* childRecords(subagent.childThreadId);
      const memberReceiptIds: string[] = [];
      if (child !== null && subagent.childThreadId !== null && child.subagents.length > 0) {
        const childParent = yield* parentRecords(subagent.childThreadId);
        for (const member of child.subagents.toSorted((left, right) =>
          left.id.localeCompare(right.id),
        )) {
          const generation = isTerminalReceiptStatus(member.status)
            ? subagentGeneration(member)
            : undefined;
          if (generation === undefined) continue;
          const saved = options.refreshMembers ? undefined : yield* existing(member.id, generation);
          if (saved !== undefined) {
            memberReceiptIds.push(saved.receipt_id);
            continue;
          }
          const recorded = yield* recordFrom(childParent, member, {
            refreshMembers: options.refreshMembers,
            cascade: false,
          });
          if (recorded !== null) memberReceiptIds.push(recorded.receipt.id);
        }
      }
      const workflow = yield* workflowMemberOf(parent, subagent);
      const transcript: ClaudeAgentTranscript | null =
        workflow === undefined ? yield* transcriptFor(parent, subagent) : null;
      const body = buildSubagentReceipt({
        subagent: { ...subagent, status },
        lineage: yield* lineageOf(parent, subagent.runId),
        child: child satisfies ChildRecords | null,
        parentCheckpoints: parent.checkpoints.filter(
          (checkpoint) => checkpoint.nodeId === subagent.id,
        ),
        transcript:
          workflow?.transcriptPath === null || workflow === undefined
            ? transcript
            : { path: workflow.transcriptPath, finalText: undefined, model: undefined, usage: {} },
        workflowMember: workflow?.member,
        memberReceiptIds,
        promptSha256: yield* sha256(subagentPrompt(subagent, child)),
      });
      const result = yield* store(body);
      if (result.written && options.cascade) yield* refreshOwners(body);
      return result;
    },
    Effect.mapError(ioError("Recording a sub-agent receipt failed")),
  );

  const recordRunFrom = Effect.fnUntraced(function* (threadId: ThreadId, runId: RunId) {
    if ((yield* projections.getThread(threadId)).lineage.parentThreadId !== null) return null;
    const records = yield* projections.getThreadRecords(threadId, [
      "runs",
      "messages",
      "turnItems",
      "checkpoints",
      "subagents",
      "providerThreads",
      "providerSessions",
    ]);
    const run = records.runs.find((candidate) => candidate.id === runId);
    const status = run?.status;
    if (run === undefined || status === undefined || !isTerminalReceiptStatus(status)) return null;
    const completedAt = run.completedAt;
    if (completedAt === null) return null;
    const memberReceiptIds: string[] = [];
    for (const subagent of records.subagents
      .filter((candidate) => candidate.runId === runId)
      .toSorted((left, right) => left.id.localeCompare(right.id))) {
      if (!isTerminalReceiptStatus(subagent.status)) continue;
      const saved = yield* existing(subagent.id, subagentGeneration(subagent));
      const recorded =
        saved === undefined
          ? yield* recordFrom(records, subagent, { refreshMembers: false, cascade: false })
          : { receipt: { id: saved.receipt_id } };
      if (recorded !== null) memberReceiptIds.push(recorded.receipt.id);
    }
    const driver =
      records.providerThreads.find((candidate) => candidate.id === run.providerThreadId)?.driver ??
      run.modelSelection.instanceId;
    return yield* store(
      buildRunReceipt({
        run: { ...run, status },
        completedAt,
        lineage: yield* lineageOf(records, null),
        projection: records,
        driver,
        memberReceiptIds,
        promptSha256: yield* sha256(runPrompt(records, run)),
      }),
    );
  });

  /** A changed receipt changes the member list of the receipt above it. */
  const refreshOwners: (body: ReceiptBody) => Effect.Effect<void, AgentReceiptError> =
    Effect.fnUntraced(
      function* (body) {
        const owners = yield* sql<{ subject_id: string; kind: string; thread_id: string }>`
        SELECT subject_id,kind,thread_id FROM fork_agent_receipts
        WHERE superseded_sequence IS NULL AND ((child_thread_id=${body.threadId} AND kind='subagent')
           OR (kind='run' AND subject_id=${body.parentSubjectId ?? ""} AND thread_id=${body.threadId}))`;
        const seen = new Set<string>();
        for (const owner of owners) {
          if (seen.has(owner.subject_id)) continue;
          seen.add(owner.subject_id);
          if (owner.kind === "run") {
            yield* recordRunFrom(ThreadId.make(owner.thread_id), owner.subject_id as RunId);
            continue;
          }
          const parent = yield* parentRecords(ThreadId.make(owner.thread_id));
          const subagent = parent.subagents.find((candidate) => candidate.id === owner.subject_id);
          if (subagent !== undefined)
            yield* recordFrom(parent, subagent, { refreshMembers: false, cascade: true });
        }
      },
      Effect.mapError(ioError("Updating an owning receipt failed")),
    );

  const recordSubagent: AgentReceipts["Service"]["recordSubagent"] = Effect.fn(
    "AgentReceipts.recordSubagent",
  )(
    function* (threadId, subagentId, options) {
      const parent = yield* parentRecords(threadId);
      const subagent = parent.subagents.find((candidate) => candidate.id === subagentId);
      if (subagent === undefined) return null;
      const recorded = yield* recordFrom(parent, subagent, {
        refreshMembers: options?.refreshMembers ?? false,
        cascade: true,
      });
      return recorded?.receipt ?? null;
    },
    Effect.mapError(ioError("Recording a sub-agent receipt failed")),
  );

  const recordRun: AgentReceipts["Service"]["recordRun"] = (threadId, runId) =>
    recordRunFrom(threadId, runId).pipe(
      Effect.map((recorded) => recorded?.receipt ?? null),
      Effect.mapError(ioError("Recording a run receipt failed")),
      Effect.withSpan("AgentReceipts.recordRun"),
    );

  const noteCheckpoint: AgentReceipts["Service"]["noteCheckpoint"] = Effect.fn(
    "AgentReceipts.noteCheckpoint",
  )(
    function* (input) {
      const rows = yield* sql<{ subject_id: string; kind: string; thread_id: string }>`
        SELECT DISTINCT subject_id,kind,thread_id FROM fork_agent_receipts
        WHERE superseded_sequence IS NULL AND (subject_id IN (${input.runId ?? ""},${input.nodeId})
           OR (child_thread_id=${input.threadId} AND kind='subagent'))`;
      for (const row of rows) {
        if (row.kind === "run")
          yield* recordRun(ThreadId.make(row.thread_id), row.subject_id as RunId);
        else yield* recordSubagent(ThreadId.make(row.thread_id), row.subject_id as NodeId);
      }
    },
    Effect.mapError(ioError("Updating receipts after a checkpoint failed")),
  );

  const latestOnThread = (threadId: ThreadId) =>
    sql<{ payload_json: string }>`
      SELECT payload_json FROM fork_agent_receipts r
      WHERE thread_id=${threadId} AND superseded_sequence IS NULL AND generation=(
        SELECT MAX(generation) FROM fork_agent_receipts WHERE subject_id=r.subject_id)
      ORDER BY kind, subject_id`.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decodeReceipt(row.payload_json))),
    );

  const forThread: AgentReceipts["Service"]["forThread"] = (threadId) =>
    latestOnThread(threadId).pipe(Effect.mapError(ioError("Reading receipts failed")));

  const list: AgentReceipts["Service"]["list"] = (threadId) =>
    forThread(threadId).pipe(Effect.map((receipts) => receipts.map(summarize)));

  const get: AgentReceipts["Service"]["get"] = Effect.fn("AgentReceipts.get")(
    function* (threadId, subjectId) {
      const rows = yield* sql<{ payload_json: string }>`
        SELECT payload_json FROM fork_agent_receipts
        WHERE thread_id=${threadId} AND subject_id=${subjectId} AND superseded_sequence IS NULL
        ORDER BY generation DESC LIMIT 1`;
      const row = rows[0];
      if (row === undefined)
        return yield* new AgentReceiptError({
          reason: "not-found",
          message: `No receipt for ${subjectId} on this thread.`,
        });
      return yield* decodeReceipt(row.payload_json);
    },
    Effect.mapError(ioError("Reading a receipt failed")),
  );

  const backfill: AgentReceipts["Service"]["backfill"] = Effect.gen(function* () {
    // Deepest threads first, so a coordinator finds its members' receipts already written.
    const rows = yield* sql<{ subagent_id: string; thread_id: string }>`
      SELECT s.subagent_id,s.thread_id FROM orchestration_v2_projection_subagents s
      LEFT JOIN orchestration_v2_projection_threads t ON t.thread_id=s.thread_id
      WHERE s.status IN ('completed','failed','cancelled','interrupted')
      ORDER BY json_extract(t.payload_json,'$.lineage.parentThreadId') IS NULL,
        json_extract(s.payload_json,'$.workflow') IS NOT NULL, s.thread_id, s.subagent_id`;
    let written = 0;
    let unchanged = 0;
    let failed = 0;
    let current: { readonly threadId: string; readonly parent: Parent | null } | undefined;
    for (const row of rows) {
      if (current?.threadId !== row.thread_id) {
        current = {
          threadId: row.thread_id,
          parent: yield* parentRecords(ThreadId.make(row.thread_id)).pipe(
            Effect.orElseSucceed(() => null),
          ),
        };
      }
      const subagent = current.parent?.subagents.find(
        (candidate) => candidate.id === row.subagent_id,
      );
      if (current.parent === null || subagent === undefined) {
        failed++;
        continue;
      }
      const outcome = yield* recordFrom(current.parent, subagent, {
        refreshMembers: false,
        cascade: false,
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("A sub-agent receipt could not be backfilled", {
            subagentId: row.subagent_id,
            cause,
          }).pipe(Effect.as("failed" as const)),
        ),
      );
      if (outcome === "failed" || outcome === null) failed++;
      else if (outcome.written) written++;
      else unchanged++;
    }
    const result = { scanned: rows.length, written, unchanged, failed };
    const completedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`INSERT INTO fork_agent_receipt_state (key,value_json) VALUES ('backfill',json_object('version',${BACKFILL_VERSION},'completedAt',${completedAt},'scanned',${result.scanned},'written',${written},'unchanged',${unchanged},'failed',${failed}))
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json`;
    return result;
  }).pipe(
    Effect.mapError(ioError("The receipt backfill failed")),
    Effect.withSpan("AgentReceipts.backfill"),
  );

  const backfillOnce: AgentReceipts["Service"]["backfillOnce"] = Effect.gen(function* () {
    const rows = yield* sql<{
      version: number | null;
    }>`SELECT json_extract(value_json,'$.version') AS version FROM fork_agent_receipt_state WHERE key='backfill'`;
    if ((rows[0]?.version ?? 0) >= BACKFILL_VERSION) return null;
    return yield* backfill;
  }).pipe(Effect.catchTag("SqlError", ioError("Reading the receipt backfill state failed")));

  const evictionReport: AgentReceipts["Service"]["evictionReport"] = Effect.gen(function* () {
    const children = yield* sql<{
      subagent_id: string;
      thread_id: string;
      child_thread_id: string;
      status: string;
      completed_at: string | null;
      updated_at: string;
    }>`SELECT subagent_id,thread_id,child_thread_id,status,
        json_extract(payload_json,'$.completedAt') AS completed_at,
        json_extract(payload_json,'$.updatedAt') AS updated_at
      FROM orchestration_v2_projection_subagents WHERE child_thread_id IS NOT NULL`;
    const receipts = new Map(
      (yield* sql<{
        subject_id: string;
        generation: string;
        receipt_id: string;
        source: string;
        bytes: number;
      }>`SELECT subject_id,generation,receipt_id,json_extract(payload_json,'$.result.source') AS source,length(payload_json) AS bytes FROM fork_agent_receipts WHERE kind='subagent' AND superseded_sequence IS NULL`).map(
        (row) => [`${row.subject_id}\0${row.generation}`, row],
      ),
    );
    const sizes = new Map<string, number>();
    const add = (rows: ReadonlyArray<{ thread_id: string; bytes: number }>) => {
      for (const row of rows) sizes.set(row.thread_id, (sizes.get(row.thread_id) ?? 0) + row.bytes);
    };
    add(
      yield* sql<{
        thread_id: string;
        bytes: number;
      }>`SELECT stream_id AS thread_id,SUM(length(payload_json)) AS bytes FROM orchestration_events WHERE aggregate_kind='thread' GROUP BY stream_id`,
    );
    add(
      yield* sql<{
        thread_id: string;
        bytes: number;
      }>`SELECT thread_id,SUM(length(payload_json)) AS bytes FROM orchestration_v2_projection_turn_items GROUP BY thread_id`,
    );
    add(
      yield* sql<{
        thread_id: string;
        bytes: number;
      }>`SELECT thread_id,SUM(length(payload_json)) AS bytes FROM orchestration_v2_projection_messages GROUP BY thread_id`,
    );
    // Anything only the child holds: a person's own message, a plan, a pending question, or a
    // nested child the receipts do not cover yet.
    const holdouts = new Map<string, string[]>();
    const hold = (rows: ReadonlyArray<{ thread_id: string }>, reason: string) => {
      for (const row of rows)
        holdouts.set(row.thread_id, [...(holdouts.get(row.thread_id) ?? []), reason]);
    };
    hold(
      yield* sql<{
        thread_id: string;
      }>`SELECT DISTINCT thread_id FROM orchestration_v2_projection_turn_items WHERE type='user_message' AND json_extract(payload_json,'$.createdBy')='user'`,
      "user-message",
    );
    hold(
      yield* sql<{
        thread_id: string;
      }>`SELECT DISTINCT thread_id FROM orchestration_v2_projection_turn_items WHERE type='proposed_plan'`,
      "plan",
    );
    hold(
      yield* sql<{
        thread_id: string;
      }>`SELECT DISTINCT thread_id FROM orchestration_v2_projection_runtime_requests WHERE status='pending'`,
      "pending-request",
    );
    hold(
      yield* sql<{
        thread_id: string;
      }>`SELECT DISTINCT s.thread_id FROM orchestration_v2_projection_subagents s
        WHERE s.status NOT IN ('completed','failed','cancelled','interrupted')
           OR NOT EXISTS (SELECT 1 FROM fork_agent_receipts r WHERE r.subject_id=s.subagent_id)`,
      "unreceipted-child",
    );
    const candidates: EvictionCandidate[] = [];
    const reasons: Record<string, number> = {};
    let evictableBytes = 0;
    let keptBytes = 0;
    let receiptBytes = 0;
    for (const child of children) {
      const generation = child.completed_at ?? child.updated_at;
      const receipt = receipts.get(`${child.subagent_id}\0${generation}`);
      const why: string[] = [];
      if (!isTerminalReceiptStatus(child.status)) why.push("active");
      if (receipt === undefined) why.push("no-receipt");
      else if (receipt.source === "none") why.push("no-result");
      why.push(...(holdouts.get(child.child_thread_id) ?? []));
      const childBytes = sizes.get(child.child_thread_id) ?? 0;
      const bytes = receipt?.bytes ?? 0;
      receiptBytes += bytes;
      if (why.length === 0) evictableBytes += childBytes;
      else keptBytes += childBytes;
      for (const reason of why) reasons[reason] = (reasons[reason] ?? 0) + 1;
      candidates.push({
        childThreadId: ThreadId.make(child.child_thread_id),
        threadId: ThreadId.make(child.thread_id),
        subjectId: child.subagent_id,
        receiptId: receipt?.receipt_id ?? null,
        evictable: why.length === 0,
        reasons: why,
        childBytes,
        receiptBytes: bytes,
      });
    }
    return {
      children: candidates.length,
      evictable: candidates.filter((candidate) => candidate.evictable).length,
      evictableBytes,
      keptBytes,
      receiptBytes,
      reasons,
      candidates: candidates.toSorted((left, right) => right.childBytes - left.childBytes),
    };
  }).pipe(
    Effect.mapError(ioError("The eviction report failed")),
    Effect.withSpan("AgentReceipts.evictionReport"),
  );

  return AgentReceipts.of({
    recordSubagent,
    recordRun,
    noteCheckpoint,
    list,
    get,
    forThread,
    backfill,
    backfillOnce,
    evictionReport,
  });
});

export const layer = Layer.effect(AgentReceipts, make);
