import {
  MessageId,
  NodeId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProviderFailureClass,
  type OrchestrationV2Run,
  type OrchestrationV2RunStatus,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { continuableRun, isRetryableFailureClass } from "./run-continuation.ts";

const threadId = ThreadId.make("thread");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 9, 25, 9, minute));

const run = (
  id: string,
  ordinal: number,
  status: OrchestrationV2RunStatus,
): OrchestrationV2Run => ({
  id: RunId.make(id),
  threadId,
  ordinal,
  providerInstanceId: ProviderInstanceId.make("codex"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  providerThreadId: null,
  userMessageId: MessageId.make(`message-${id}`),
  rootNodeId: NodeId.make(`root-${id}`),
  activeAttemptId: null,
  status,
  requestedAt: at(ordinal),
  startedAt: at(ordinal),
  completedAt: at(ordinal + 1),
  checkpointId: null,
  contextHandoffId: null,
});

const failure = (
  source: OrchestrationV2Run,
  failureClass: OrchestrationV2ProviderFailureClass,
  nodeId = source.rootNodeId,
): OrchestrationV2TurnItem => ({
  id: TurnItemId.make(`error-${source.id}-${failureClass}`),
  threadId,
  runId: source.id,
  nodeId,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  type: "error",
  status: "failed",
  title: "Failed",
  startedAt: at(source.ordinal),
  completedAt: at(source.ordinal),
  updatedAt: at(source.ordinal),
  failure: { class: failureClass, message: "It failed.", code: null, retryable: null },
});

describe("continuableRun", () => {
  it("classifies shell failures without requiring turn items", () => {
    for (const value of ["usage_limit", "provider_error", "transport_error", "unknown"] as const)
      expect(isRetryableFailureClass(value)).toBe(true);
    for (const value of ["permission_error", "validation_error", null, undefined] as const)
      expect(isRetryableFailureClass(value)).toBe(false);
  });
  it("continues a cut-off run, or a failure another try can get past", () => {
    const stopped = run("stopped", 1, "interrupted");
    expect(continuableRun({ runs: [stopped], turnItems: [], lastErrorClass: null })).toEqual({
      run: stopped,
      failure: null,
    });
    const failed = run("failed", 1, "failed");
    for (const failureClass of ["provider_error", "transport_error", "unknown"] as const)
      expect(
        continuableRun({
          runs: [failed],
          turnItems: [failure(failed, failureClass)],
          lastErrorClass: failureClass,
        })?.failure?.class,
      ).toBe(failureClass);
  });

  it("leaves failures that would repeat, and failures it cannot see, to a new message", () => {
    const failed = run("failed", 1, "failed");
    for (const failureClass of ["permission_error", "validation_error"] as const)
      expect(
        continuableRun({
          runs: [failed],
          turnItems: [failure(failed, failureClass)],
          lastErrorClass: failureClass,
        }),
      ).toBeNull();
    expect(continuableRun({ runs: [failed], turnItems: [], lastErrorClass: null })).toBeNull();
    expect(
      continuableRun({
        runs: [failed],
        turnItems: [failure(failed, "transport_error", NodeId.make("child"))],
        lastErrorClass: null,
      }),
    ).toBeNull();
    const later = run("later", 2, "completed");
    expect(
      continuableRun({
        runs: [failed, later],
        turnItems: [failure(failed, "transport_error")],
        lastErrorClass: null,
      }),
    ).toBeNull();
  });

  it("continues a usage limit only while the thread still shows it", () => {
    const limited = run("limited", 1, "failed");
    const turnItems = [failure(limited, "usage_limit")];
    expect(continuableRun({ runs: [limited], turnItems, lastErrorClass: "usage_limit" })?.run).toBe(
      limited,
    );
    expect(continuableRun({ runs: [limited], turnItems, lastErrorClass: null })).toBeNull();
  });
});
