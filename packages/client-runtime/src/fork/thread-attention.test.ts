import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { selectAttentionThreadShells, threadAttentionKind } from "@t3tools/contracts/fork";
import * as DateTime from "effect/DateTime";
import { v2Now, v2ThreadShell } from "../state/orchestrationV2TestFixtures.ts";
import { presentThreadShell } from "../state/models.ts";
import { attentionThreads, nextAttentionThread } from "./thread-attention.ts";

const now = DateTime.toEpochMillis(v2Now);
const raw = (
  id: string,
  changes: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({ ...v2ThreadShell, id: ThreadId.make(id), ...changes });
const request = (kind: "command" | "user_input", blocking = true) => ({
  id: RuntimeRequestId.make("request"),
  kind,
  blocking,
  createdAt: v2Now,
});

describe("thread attention", () => {
  it("counts held queues, failures and requests without mistaking active or completed work for attention", () => {
    const threads = [
      raw("paused", { queueHeld: true }),
      raw("failed", { status: "failed" }),
      raw("limited", { status: "failed", lastErrorClass: "usage_limit" }),
      raw("approval", { pendingRuntimeRequest: request("command") }),
      raw("input", { pendingRuntimeRequest: request("user_input") }),
      raw("working", { status: "running" }),
      raw("done", { status: "completed" }),
      raw("async", { status: "running", pendingRuntimeRequest: request("user_input", false) }),
      raw("stopped-async", {
        status: "completed",
        pendingRuntimeRequest: request("user_input", false),
      }),
    ];
    expect(selectAttentionThreadShells(threads, now).map((thread) => thread.id)).toEqual([
      "approval",
      "failed",
      "input",
      "limited",
      "paused",
      "stopped-async",
    ]);
    expect(threadAttentionKind(threads[0]!)).toBe("paused");
    expect(threadAttentionKind(threads[2]!)).toBe("limited");
    expect(
      threadAttentionKind(
        raw("precedence", { queueHeld: true, pendingRuntimeRequest: request("command") }),
      ),
    ).toBe("approval");
  });

  it("excludes archived, deleted and bot threads and honors snoozes until a new hand raise", () => {
    const snoozed = {
      queueHeld: true,
      snoozedUntil: DateTime.add(v2Now, { hours: 1 }),
      snoozedAt: v2Now,
    };
    const threads = [
      raw("archived", { queueHeld: true, archivedAt: v2Now }),
      raw("deleted", { queueHeld: true, deletedAt: v2Now }),
      raw("bot-run-test", { queueHeld: true }),
      raw("paused", snoozed),
      raw("old-failure", {
        ...snoozed,
        status: "failed",
        latestRunCompletedAt: DateTime.subtract(v2Now, { minutes: 1 }),
      }),
      raw("new-failure", {
        ...snoozed,
        status: "failed",
        latestRunCompletedAt: DateTime.add(v2Now, { minutes: 1 }),
      }),
      raw("question", { ...snoozed, pendingRuntimeRequest: request("user_input") }),
    ];
    expect(selectAttentionThreadShells(threads, now).map((thread) => thread.id)).toEqual([
      "question",
      "new-failure",
    ]);
    expect(selectAttentionThreadShells([raw("paused", snoozed)], now + 3_600_000)).toHaveLength(1);
  });

  it("rolls live child questions up once, keeps forks and ignores ended child questions", () => {
    const parent = raw("parent");
    const child = raw("child", {
      creationSource: "mcp",
      status: "running",
      pendingRuntimeRequest: request("user_input"),
      lineage: { ...parent.lineage, parentThreadId: parent.id, relationshipToParent: "subagent" },
    });
    const fork = raw("fork", {
      queueHeld: true,
      lineage: { ...parent.lineage, parentThreadId: parent.id, relationshipToParent: "fork" },
    });
    expect(
      selectAttentionThreadShells([parent, child, fork], now).map((thread) => thread.id),
    ).toEqual(["fork", "parent"]);
    expect(
      selectAttentionThreadShells(
        [parent, { ...child, pendingRuntimeRequest: request("user_input", false) }],
        now,
      ).map((thread) => thread.id),
    ).toEqual(["parent"]);
    expect(selectAttentionThreadShells([parent, { ...child, status: "completed" }], now)).toEqual(
      [],
    );
    expect(
      selectAttentionThreadShells([parent, { ...child, creationSource: "provider" }], now),
    ).toEqual([]);
  });

  it("orders every environment oldest first, scopes duplicate ids and cycles through the result", () => {
    const first = presentThreadShell(
      EnvironmentId.make("one"),
      raw("same", { queueHeld: true, updatedAt: DateTime.subtract(v2Now, { hours: 2 }) }),
    );
    const second = presentThreadShell(
      EnvironmentId.make("two"),
      raw("same", {
        status: "failed",
        latestRunId: RunId.make("run"),
        latestRunCompletedAt: v2Now,
      }),
    );
    const selected = attentionThreads([second, first], now);
    expect(selected).toEqual([first, second]);
    expect(nextAttentionThread(selected, null)).toBe(first);
    expect(
      nextAttentionThread(selected, { environmentId: first.environmentId, threadId: first.id }),
    ).toBe(second);
    expect(
      nextAttentionThread(selected, { environmentId: second.environmentId, threadId: second.id }),
    ).toBe(first);
    expect(nextAttentionThread([], null)).toBeNull();
  });
});
