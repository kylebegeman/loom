import type { LibraryOperation } from "@t3tools/contracts/fork";
import { libraryOperationNeedsAction, sortLibraryOperations } from "./library-workflows.ts";

const COMPLETED: Record<LibraryOperation["kind"], string> = {
  import: "Existing files registered",
  create: "Project saved",
  update: "Project changes saved",
  prepare: "Files prepared",
  restore: "Files restored",
  reopen: "Files reopened",
  snapshot: "Recovery archive saved",
  release: "Files removed",
  unregister: "Folder forgotten; files kept on the computer",
  launch: "Conversation setup completed",
};
const REMAINING: Record<LibraryOperation["kind"], string> = {
  import: "Finish registering existing files",
  create: "Finish saving the project",
  update: "Finish saving project changes",
  prepare: "Finish preparing files",
  restore: "Finish restoring files",
  reopen: "Finish reopening files",
  snapshot: "Finish saving the recovery archive",
  release: "Finish removing files",
  unregister: "Finish forgetting the folder",
  launch: "Finish preparing files and conversation setup",
};

/** A phase names an attempted step; only a result or success confirms an outcome. */
export function libraryProjectRequestOutcome(operation: LibraryOperation) {
  const completed: string[] = [];
  const result = operation.result;
  const threadId = result && "threadId" in result ? result.threadId : null;
  if (result && "resources" in result)
    completed.push(operation.kind === "update" ? "Project changes saved" : "Project saved");
  if (threadId) completed.push("Conversation created");
  if (operation.state === "succeeded" && !completed.includes(COMPLETED[operation.kind]))
    completed.push(COMPLETED[operation.kind]);
  const needsRepair = operation.state === "failed" || operation.state === "needs-input";
  const cancelled = operation.state === "cancelled";
  const finished = cancelled || operation.state === "succeeded";
  return {
    requestId: operation.id,
    error: needsRepair ? operation.error : null,
    accessRepair: needsRepair ? operation.accessRepair : undefined,
    repair: needsRepair ? operation.repair : undefined,
    completed,
    remaining: finished ? [] : [REMAINING[operation.kind]],
    conversation:
      operation.kind === "launch"
        ? threadId
          ? "Conversation created"
          : "Conversation creation not confirmed"
        : "No conversation requested",
    threadId,
    path: result && "rootPath" in result ? result.rootPath : null,
    canResume: libraryOperationNeedsAction(operation),
    canCancel: libraryOperationNeedsAction(operation),
    resumeLabel: operation.kind === "restore" ? "Renew restore authorization" : "Resume request",
    detail: cancelled
      ? "Remaining steps cancelled. Completed steps were kept; cancellation does not undo them."
      : completed.length === 0 && operation.state !== "succeeded"
        ? "Check this request before retrying. No completed outcome is confirmed by this receipt."
        : null,
  };
}

/** The limit folds finished history only; every request still needing attention stays visible. */
export function selectLibraryProjectRequests(
  operations: readonly LibraryOperation[],
  limit: number | null,
) {
  const sorted = sortLibraryOperations(operations);
  const unfinished = sorted.filter(
    (operation) => libraryOperationNeedsAction(operation) || operation.state === "running",
  ).length;
  return {
    shown: limit === null ? sorted : sorted.slice(0, Math.max(limit, unfinished)),
    total: sorted.length,
    unfinished,
  };
}
