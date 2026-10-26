import type {
  LibraryFolderInspection,
  LibraryProject,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";

const remoteKey = (remote: string | null) =>
  remote ? sourceControlClients.canonicalRepositoryKey(normalizeGitRemoteUrl(remote)) : null;

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

/**
 * Copies that still hold their folder. Managed files keep it after removal, so their recovery stays
 * reachable. A borrowed folder is let go once released or unregistered.
 */
export function libraryFolderHolders(copies: readonly LibraryWorkingCopy[]) {
  return copies.filter(
    (copy) =>
      copy.ownership === "managed" || (copy.state !== "released" && copy.registered !== false),
  );
}
