import type { LibraryFolderInspection, LibraryProject } from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";

const remoteKey = (remote: string | null) =>
  remote ? canonicalRepositoryKey(normalizeGitRemoteUrl(remote)) : null;

/** Repository origins and layouts are evidence; a shared name alone never joins projects. */
export function folderProjectMatches(
  projects: readonly LibraryProject[],
  inspection: LibraryFolderInspection,
) {
  return projects.filter((project) => {
    const repositories = project.resources.filter((resource) => resource.kind !== "link");
    return (
      !project.archived &&
      repositories.length > 0 &&
      repositories.length === inspection.repositories.length &&
      repositories.every((resource) => {
        const key = remoteKey(resource.remoteUrl);
        return (
          key !== null &&
          inspection.repositories.some(
            (repository) =>
              repository.relativePath === resource.relativePath &&
              remoteKey(repository.remoteUrl) === key,
          )
        );
      })
    );
  });
}
