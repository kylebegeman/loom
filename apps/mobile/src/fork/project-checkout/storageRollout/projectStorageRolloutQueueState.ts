import {
  canReviewProjectStorageTarget,
  projectStorageRolloutChoices,
  type ProjectStorageRolloutSnapshot,
} from "@t3tools/client-runtime/fork";

/** Completed entries stay visible and never become part of a retry. */
export function projectStorageRolloutQueueState(snapshot: ProjectStorageRolloutSnapshot) {
  const rows = snapshot.rows.filter((row) => row.selected || row.status === "saved");
  const unfinished = rows.filter((row) => row.selected && row.status !== "saved");
  const busy = snapshot.phase === "reviewing" || snapshot.phase === "saving";
  return {
    rows,
    unfinished,
    busy,
    savedCount: rows.filter((row) => row.status === "saved").length,
    errorCount: unfinished.filter((row) => row.status === "error").length,
    reviewable: unfinished.filter(
      (row) => row.status !== "reviewed" && canReviewProjectStorageTarget(row.target),
    ),
    canConfirm:
      !busy &&
      unfinished.length > 0 &&
      unfinished.every(
        (row) => row.choice !== null && projectStorageRolloutChoices(row).includes(row.choice),
      ),
  };
}
