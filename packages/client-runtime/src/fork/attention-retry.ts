import {
  ATTENTION_STATUS_WS_METHODS as A,
  threadAttentionKind,
  type ThreadAttentionKind,
} from "@t3tools/contracts/fork";
import type { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { isRetryableFailureClass } from "@t3tools/shared/fork/run-continuation";
import type { EnvironmentThreadShell } from "../state/models.ts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

export function createAttentionRetryAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    retry: createEnvironmentRpcCommand(runtime, { label: "loom:attention-retry", tag: A.retry }),
  };
}

export interface AttentionRetryTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly runId: RunId;
}

export function attentionRow(thread: EnvironmentThreadShell) {
  const kind: ThreadAttentionKind | null = thread.pendingSubagentRequest
    ? thread.pendingSubagentRequest === "user_input"
      ? "input"
      : "approval"
    : threadAttentionKind(thread.source);
  if (kind === null) return null;
  const runId = thread.source.latestRunId;
  const target: AttentionRetryTarget | null =
    (kind === "failed" || kind === "limited") &&
    runId !== null &&
    thread.source.activeRunId === null &&
    thread.source.pendingRuntimeRequest === null &&
    isRetryableFailureClass(thread.source.lastErrorClass)
      ? { environmentId: thread.environmentId, threadId: thread.id, runId }
      : null;
  return { thread, kind, target };
}
export type AttentionRow = NonNullable<ReturnType<typeof attentionRow>>;

export const ATTENTION_REASON_LABELS: Record<ThreadAttentionKind, string> = {
  approval: "Needs approval",
  input: "Needs an answer",
  paused: "Queue paused",
  failed: "Failed",
  limited: "Usage limited",
};
export type AttentionRetryOutcome =
  | { readonly status: "retrying" | "retried" }
  | { readonly status: "failed"; readonly message: string };

export async function runAttentionRetries<T>(
  targets: readonly T[],
  retry: (target: T) => Promise<void>,
  onResult: (target: T, outcome: AttentionRetryOutcome) => void,
) {
  for (const target of targets) {
    onResult(target, { status: "retrying" });
    try {
      await retry(target);
      onResult(target, { status: "retried" });
    } catch (error) {
      onResult(target, {
        status: "failed",
        message: error instanceof Error ? error.message : "Could not retry this run.",
      });
    }
  }
}
