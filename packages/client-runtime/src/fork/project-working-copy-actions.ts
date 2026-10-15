import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";

/** A manual removal must pass the fresh review of this exact working copy. */
export function projectWorkingCopyActionBlocker(
  preview: ProjectCheckoutPreview,
  action: "release" | "restore",
): string | null {
  if (preview.state === "blocked")
    return preview.blockers[0] ?? "This working copy cannot be changed safely. Review it again.";
  if (action === "release") {
    if (preview.state === "released") return "This working copy has already been removed.";
    if (preview.ownershipSource === null)
      return "Review working file preferences and allow Loom to manage this folder before removing it.";
    if (preview.localFiles.trackedChanges + preview.localFiles.untrackedFiles > 0)
      return "This working copy has unpublished changes or local-only files. Publish or move them before removal.";
  } else if (preview.state !== "released") {
    return "This working copy is already available.";
  }
  return preview.reviewToken ? null : "This working copy changed. Review it again.";
}
