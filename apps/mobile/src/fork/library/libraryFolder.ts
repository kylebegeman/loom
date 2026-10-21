import type {
  LibraryFolderInspection,
  LibraryProject,
  LibraryResource,
} from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";

export function libraryFolderResources(inspection: LibraryFolderInspection) {
  if (!inspection.exists) throw new Error("This folder no longer exists on that computer.");
  if (inspection.repositories.length > 64)
    throw new Error("Choose a folder with at most 64 repositories.");
  const folder = inspection.rootPath.replace(/\\/gu, "/").replace(/\/+$/gu, "");
  const name = folder.slice(folder.lastIndexOf("/") + 1);
  const hasRoot = inspection.repositories.some((repository) => repository.relativePath === ".");
  if (hasRoot && inspection.repositories.length > 1)
    throw new Error(
      "This folder contains nested repositories. Choose a folder with separate repositories instead.",
    );
  const resources = inspection.repositories.map((repository): Omit<LibraryResource, "id"> => ({
    kind: "repository",
    title: (repository.path.split(/[\\/]/u).findLast(Boolean) ?? "Repository").slice(0, 160),
    relativePath: repository.relativePath,
    remoteUrl: repository.remoteUrl,
    defaultBranch: null,
  }));
  return { title: name.slice(0, 160) || "Project", rootPath: inspection.rootPath, resources };
}

export function libraryProjectsForFolder(
  inspection: LibraryFolderInspection,
  projects: readonly LibraryProject[],
) {
  const remotes = new Set(
    inspection.repositories.flatMap((repository) =>
      repository.remoteUrl ? [normalizeGitRemoteUrl(repository.remoteUrl)] : [],
    ),
  );
  return projects.filter((project) =>
    project.resources.some(
      (resource) =>
        resource.kind !== "link" &&
        resource.remoteUrl &&
        remotes.has(normalizeGitRemoteUrl(resource.remoteUrl)),
    ),
  );
}
