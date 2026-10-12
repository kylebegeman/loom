import * as Schema from "effect/Schema";
import { MiniSubmit, type MiniReceipt } from "@t3tools/contracts/fork";

/** An uncertain transfer remains uncertain even if a cached job has finished. */
export function jobStateLabel(receipt: MiniReceipt): string {
  if (receipt.state === "transfer_pending") return "Check transfer";
  switch (receipt.job?.state) {
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "interrupted":
      return "Interrupted";
    case "queued":
      return "Queued";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "cancelling":
      return "Stopping";
    default:
      return "Waiting for status";
  }
}
export function jobStateTone(receipt: MiniReceipt): string {
  if (receipt.state === "transfer_pending") return "bg-warning-surface text-warning-foreground";
  if (receipt.job?.state === "failed" || receipt.job?.state === "interrupted")
    return "bg-destructive/8 text-destructive";
  if (receipt.job?.state === "succeeded") return "bg-primary/8 text-primary";
  return "bg-muted text-muted-foreground";
}

const validOutputPaths = Schema.is(MiniSubmit.fields.outputs);

export function parseOutputFiles(text: string) {
  const outputs = text
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean);
  return {
    outputs,
    error: validOutputPaths(outputs)
      ? null
      : "Use up to 32 unique repository-relative file paths, one per line. Paths cannot include .git, .. or empty segments.",
  };
}
