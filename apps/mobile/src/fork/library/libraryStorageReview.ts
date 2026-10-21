import type { ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";

export function libraryFolderProjectId(copy: LibraryWorkingCopy) {
  return (
    copy.rootLocalProjectId ??
    copy.repositories.find((repository) => repository.path === copy.rootPath)?.localProjectId
  );
}

export function libraryFolderStorageChange(
  copy: LibraryWorkingCopy,
  projectId: ProjectId,
  preview: ProjectCheckoutPreview,
  keep: boolean,
  consentToken: string | null,
) {
  if (preview.projectId !== projectId || preview.workspaceRoot !== copy.rootPath)
    throw new Error("The file location changed. Refresh the project before changing its files.");
  if (!preview.reviewToken || preview.state === "blocked")
    throw new Error("Review these files again before changing their storage setting.");
  const input = { projectId, reviewToken: preview.reviewToken };
  if (preview.state === "external" && preview.ownershipSource === null) {
    if (keep || consentToken !== preview.reviewToken)
      throw new Error("Review this folder and explicitly allow Loom to manage its files.");
    return { kind: "adopt" as const, input: { ...input, retention: "release-on-settle" as const } };
  }
  if (preview.ownershipSource === null)
    throw new Error("Review these files again before changing their storage setting.");
  return {
    kind: "retention" as const,
    input: { ...input, retention: keep ? ("keep" as const) : ("release-on-settle" as const) },
  };
}
