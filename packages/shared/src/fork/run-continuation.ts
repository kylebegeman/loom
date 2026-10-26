import type {
  OrchestrationV2ProviderFailure,
  OrchestrationV2ProviderFailureClass,
  OrchestrationV2Run,
} from "@t3tools/contracts";

import { latestExecutedRun, latestRootProviderFailure } from "../orchestrationV2ThreadError.ts";

/**
 * Failures the same request can get past on another try: a usage limit once it resets, an
 * overloaded or erroring provider, a dropped connection. A refused permission or a rejected request
 * fails the same way again, so those need a changed message instead.
 */
const RETRYABLE_FAILURE_CLASSES: ReadonlySet<OrchestrationV2ProviderFailureClass> = new Set([
  "usage_limit",
  "provider_error",
  "transport_error",
  "unknown",
]);

export const isRetryableProviderFailure = (
  failure: OrchestrationV2ProviderFailure | null,
): failure is OrchestrationV2ProviderFailure =>
  failure !== null && RETRYABLE_FAILURE_CLASSES.has(failure.class);

export interface ContinuableRun {
  readonly run: OrchestrationV2Run;
  /** How the run failed; null for a run that was cut off. */
  readonly failure: OrchestrationV2ProviderFailure | null;
}

/**
 * The run a person can continue in one step, as the server's manual continuation accepts it: the
 * latest run, cut off or failed in a way another try can get past. A usage limit counts only while
 * the thread still shows it, since a later session error replaces it.
 */
export function continuableRun(input: {
  readonly runs: ReadonlyArray<OrchestrationV2Run>;
  // Only error items are read, so the quiet thread's items without streamed text fit too.
  readonly turnItems: Parameters<typeof latestRootProviderFailure>[1];
  readonly lastErrorClass: OrchestrationV2ProviderFailureClass | null | undefined;
}): ContinuableRun | null {
  const run = latestExecutedRun(input.runs);
  if (run === null) return null;
  if (run.status === "interrupted") return { run, failure: null };
  const failure = latestRootProviderFailure(run, input.turnItems);
  if (!isRetryableProviderFailure(failure)) return null;
  if (failure.class === "usage_limit" && input.lastErrorClass !== "usage_limit") return null;
  return { run, failure };
}
