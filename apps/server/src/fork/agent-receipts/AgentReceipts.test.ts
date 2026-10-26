import { describe, expect, it } from "@effect/vitest";
import { NodeId, type OrchestrationV2Subagent, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { AgentReceipts, receiptsForArchive } from "./AgentReceipts.ts";
import {
  applyItem,
  applySubagent,
  applyThread,
  at,
  fileItem,
  makeSubagent,
  makeThread,
  receiptsLayer,
  rootThreadId,
  subagentEvent,
  toolItem,
} from "./AgentReceipts.testkit.ts";
import { AgentReceiptsReactor } from "./reactor.ts";

const root = makeThread(rootThreadId);
const childOf = (id: string, parent: ThreadId = rootThreadId) =>
  makeThread(ThreadId.make(id), { threadId: parent, rootThreadId });

const rowsFor = (subjectId: string) =>
  Effect.flatMap(
    SqlClient.SqlClient,
    (sql) => sql<{ generation: string; superseded_sequence: number | null }>`
      SELECT generation,superseded_sequence FROM fork_agent_receipts
      WHERE subject_id=${subjectId} ORDER BY generation, visible_sequence`,
  );

const addEvents = (count: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const start = (yield* sql<{ next: number }>`
      SELECT COALESCE(MAX(sequence),0)+1 AS next FROM orchestration_events`)[0]!.next;
    for (let sequence = start; sequence < start + count; sequence++)
      yield* sql`INSERT INTO orchestration_events (sequence,event_id,stream_version,occurred_at,actor_kind,metadata_json,application_event_version,aggregate_kind,stream_id,event_type,payload_json)
        VALUES (${sequence},${`event-${sequence}`},${sequence},'2026-10-20T09:00:00.000Z','server','{}',2,'thread',${rootThreadId},'thread.meta-updated','{}')`;
  });

describe("agent receipts", () => {
  it.effect("writes one receipt per finish generation for each terminal state", () =>
    Effect.gen(function* () {
      const reactor = yield* AgentReceiptsReactor;
      yield* applyThread(root);
      for (const status of ["completed", "failed", "cancelled", "interrupted"] as const) {
        const child = childOf(`thread:child-${status}`);
        yield* applyThread(child);
        const subagent = makeSubagent({
          id: NodeId.make(`node:${status}`),
          threadId: rootThreadId,
          childThreadId: child.id,
          status,
        });
        yield* applySubagent(subagent);
        yield* reactor.handle(subagentEvent(subagent));
        yield* reactor.handle(subagentEvent(subagent));
        expect(yield* rowsFor(subagent.id)).toEqual([
          { generation: "2026-10-20T09:05:00.000Z", superseded_sequence: null },
        ]);
      }

      const running = makeSubagent({
        id: NodeId.make("node:running"),
        threadId: rootThreadId,
        status: "running",
        completedAt: null,
      });
      yield* applySubagent(running);
      yield* reactor.handle(subagentEvent(running));
      expect(yield* rowsFor(running.id)).toEqual([]);

      // Reopened and finished again: a second generation beside the first.
      const reopened: OrchestrationV2Subagent = {
        ...makeSubagent({ id: NodeId.make("node:completed"), threadId: rootThreadId }),
        childThreadId: ThreadId.make("thread:child-completed"),
        completedAt: at(8),
        updatedAt: at(8),
      };
      yield* applySubagent(reopened);
      yield* reactor.handle(subagentEvent(reopened));
      expect((yield* rowsFor(reopened.id)).map((row) => row.generation)).toEqual([
        "2026-10-20T09:05:00.000Z",
        "2026-10-20T09:08:00.000Z",
      ]);
      const receipts = yield* AgentReceipts;
      expect((yield* receipts.get(rootThreadId, reopened.id)).generation).toBe(
        "2026-10-20T09:08:00.000Z",
      );
    }).pipe(Effect.provide(receiptsLayer)),
  );

  it.effect("lists a coordinator's member receipts and backfills idempotently", () =>
    Effect.gen(function* () {
      const receipts = yield* AgentReceipts;
      const workflow = childOf("thread:workflow");
      const first = childOf("thread:member-1", workflow.id);
      const second = childOf("thread:member-2", workflow.id);
      for (const thread of [root, workflow, first, second]) yield* applyThread(thread);
      yield* applyItem(toolItem(second.id, 1, "StructuredOutput", { verdict: "pass" }));
      const members = [first, second].map((thread, index) =>
        makeSubagent({
          id: NodeId.make(`node:member-${index + 1}`),
          threadId: workflow.id,
          childThreadId: thread.id,
        }),
      );
      for (const member of members) yield* applySubagent(member);
      const coordinator = makeSubagent({
        id: NodeId.make("node:coordinator"),
        threadId: rootThreadId,
        childThreadId: workflow.id,
        completedAt: at(9),
        updatedAt: at(9),
      });
      yield* applySubagent(coordinator);

      expect(yield* receipts.backfill).toEqual({ scanned: 3, written: 3, unchanged: 0, failed: 0 });
      const memberReceipts = yield* receipts.forThread(workflow.id);
      expect(memberReceipts.map((receipt) => receipt.result.source)).toEqual([
        "claude_agent_result",
        "workflow_structured_output",
      ]);
      const coordinatorReceipt = yield* receipts.get(rootThreadId, coordinator.id);
      expect(coordinatorReceipt.memberReceiptIds).toEqual(
        memberReceipts.map((receipt) => receipt.id),
      );
      expect(memberReceipts[0]?.parentSubjectId).toBe(coordinator.id);

      expect(yield* receipts.backfill).toEqual({ scanned: 3, written: 0, unchanged: 3, failed: 0 });
      expect(yield* receipts.backfillOnce).toBeNull();
      expect(yield* receipts.list(rootThreadId)).toMatchObject([
        { subjectId: coordinator.id, memberCount: 2, resultLine: "The flake is a shared port." },
      ]);
    }).pipe(Effect.provide(receiptsLayer)),
  );

  it.effect("keeps each snapshot's receipts reproducible when a receipt changes", () =>
    Effect.gen(function* () {
      const receipts = yield* AgentReceipts;
      const sql = yield* SqlClient.SqlClient;
      const child = childOf("thread:editor");
      yield* applyThread(root);
      yield* applyThread(child);
      const subagent = makeSubagent({
        id: NodeId.make("node:editor"),
        threadId: rootThreadId,
        childThreadId: child.id,
      });
      yield* applySubagent(subagent);
      const before = yield* receipts.recordSubagent(rootThreadId, subagent.id);
      yield* addEvents(2);

      yield* applyItem(fileItem(child.id, 1, "src/port.ts"));
      const after = yield* receipts.recordSubagent(rootThreadId, subagent.id);
      expect(after?.id).not.toBe(before?.id);
      expect(yield* receipts.recordSubagent(rootThreadId, subagent.id)).toEqual(after);

      // A snapshot taken at sequence 2 saw the first version and still does.
      expect(yield* receiptsForArchive(sql, rootThreadId, 0)).toEqual([]);
      expect(yield* receiptsForArchive(sql, rootThreadId, 2)).toEqual([before]);
      expect(yield* receiptsForArchive(sql, rootThreadId, 3)).toEqual([after]);
      expect((yield* receipts.forThread(rootThreadId)).map((receipt) => receipt.files)).toEqual([
        [{ path: "src/port.ts" }],
      ]);
    }).pipe(Effect.provide(receiptsLayer)),
  );

  it.effect("reports which finished children their receipts fully cover", () =>
    Effect.gen(function* () {
      const receipts = yield* AgentReceipts;
      yield* applyThread(root);
      const covered = childOf("thread:covered");
      const unreceipted = childOf("thread:unreceipted");
      yield* applyThread(covered);
      yield* applyThread(unreceipted);
      const done = makeSubagent({
        id: NodeId.make("node:covered"),
        threadId: rootThreadId,
        childThreadId: covered.id,
      });
      yield* applySubagent(done);
      yield* applySubagent(
        makeSubagent({
          id: NodeId.make("node:unreceipted"),
          threadId: rootThreadId,
          childThreadId: unreceipted.id,
        }),
      );
      yield* receipts.recordSubagent(rootThreadId, done.id);

      const report = yield* receipts.evictionReport;
      expect(report.children).toBe(2);
      expect(
        report.candidates.map((candidate) => [candidate.childThreadId, candidate.evictable]),
      ).toEqual(
        expect.arrayContaining([
          [covered.id, true],
          [unreceipted.id, false],
        ]),
      );
    }).pipe(Effect.provide(receiptsLayer)),
  );
});
