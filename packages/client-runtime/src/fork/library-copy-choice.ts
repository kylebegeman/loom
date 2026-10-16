import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";

const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");

/** Where a resource sits inside a copy, matching how the server resolves it against the root. */
const resourcePath = (rootPath: string, relativePath: string) =>
  relativePath === "." ? normalizePath(rootPath) : `${normalizePath(rootPath)}/${relativePath}`;

/**
 * Reuse only the chosen host and current resource scope, including explicit copy identity.
 * `resourceIds` lists the selected components, or is null for the whole project. A copy counts
 * only while each selected repository still sits where the project now places it.
 */
export const libraryCopiesForScope = (
  project: LibraryProject,
  copies: readonly LibraryWorkingCopy[],
  environmentId: EnvironmentId | null,
  resourceIds: readonly string[] | null,
): LibraryWorkingCopy[] => {
  const repositories = project.resources.filter((resource) => resource.kind !== "link");
  if (
    project.archived ||
    !environmentId ||
    (resourceIds !== null &&
      (new Set(resourceIds).size !== resourceIds.length ||
        (resourceIds.length === 0 && repositories.length > 0) ||
        resourceIds.some((id) => !repositories.some((resource) => resource.id === id))))
  )
    return [];
  const required = repositories.filter(
    (resource) => resourceIds === null || resourceIds.includes(resource.id),
  );
  return copies.filter(
    (copy) =>
      copy.projectId === project.id &&
      copy.environmentId === environmentId &&
      copy.state === "ready" &&
      copy.registered !== false &&
      (repositories.length > 0 || copy.repositories.length === 0) &&
      required.every((resource) =>
        copy.repositories.some(
          (repository) =>
            repository.resourceId === resource.id &&
            normalizePath(repository.path) === resourcePath(copy.rootPath, resource.relativePath),
        ),
      ),
  );
};

/** File preparation waits for the existing-copy catalog, including retries and refreshes. */
export function libraryCopyReadiness(query: {
  readonly isPending: boolean;
  readonly isSuccess: boolean;
  readonly error: string | null;
}): "loading" | "error" | "ready" {
  if (query.isPending) return "loading";
  if (query.error !== null) return "error";
  return query.isSuccess ? "ready" : "loading";
}
