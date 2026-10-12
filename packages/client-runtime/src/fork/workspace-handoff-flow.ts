import type {
  WorkspaceHandoffOffer,
  WorkspaceHandoffReceipt,
  WorkspaceHandoffFinishResult,
} from "@t3tools/contracts/fork";

export type WorkspaceHandoffPhase = "checking" | "preparing" | "settling" | "continuing" | "done";
export interface WorkspaceHandoffAttempt {
  readonly offer: WorkspaceHandoffOffer | null;
  readonly receipt: WorkspaceHandoffReceipt | null;
  readonly sourceResult: WorkspaceHandoffFinishResult | null;
}

/** Destination readiness is confirmed before the source is settled; retries reuse accepted steps. */
export async function runWorkspaceHandoff(input: {
  readonly attempt: WorkspaceHandoffAttempt;
  readonly offer: () => Promise<WorkspaceHandoffOffer>;
  readonly prepare: (offer: WorkspaceHandoffOffer) => Promise<WorkspaceHandoffReceipt>;
  readonly finish: (
    offer: WorkspaceHandoffOffer,
    receipt: WorkspaceHandoffReceipt,
  ) => Promise<WorkspaceHandoffFinishResult>;
  readonly resume: (
    offer: WorkspaceHandoffOffer,
    receipt: WorkspaceHandoffReceipt,
  ) => Promise<WorkspaceHandoffReceipt>;
  readonly progress: (
    phase: WorkspaceHandoffPhase,
    attempt: WorkspaceHandoffAttempt,
  ) => void | Promise<void>;
}) {
  let attempt = input.attempt;
  await input.progress("checking", attempt);
  const offer = attempt.offer ?? (await input.offer());
  attempt = { ...attempt, offer };
  await input.progress("preparing", attempt);
  // A saved receipt proves past readiness, not that the destination is still usable.
  // Once source finish is accepted, delivery validates its own workspace instead.
  const receipt =
    attempt.sourceResult !== null && attempt.receipt !== null
      ? attempt.receipt
      : await input.prepare(offer);
  attempt = { ...attempt, receipt };
  await input.progress("settling", attempt);
  const sourceResult = attempt.sourceResult ?? (await input.finish(offer, receipt));
  attempt = { ...attempt, sourceResult };
  await input.progress("continuing", attempt);
  const ready = await input.resume(offer, receipt);
  await input.progress("done", attempt);
  return ready;
}
