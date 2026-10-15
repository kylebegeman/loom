import type { EnvironmentId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";

/** Reuse only the chosen host and current resource scope, including explicit copy identity. */
export function libraryCopiesForScope(
  project: LibraryProject,
  copies: readonly LibraryWorkingCopy[],
  environmentId: EnvironmentId | null,
  resourceId: string | null,
) {
  if (
    project.archived ||
    !environmentId ||
    (resourceId &&
      !project.resources.some((resource) => resource.id === resourceId && resource.kind !== "link"))
  )
    return [];
  const required = project.resources.filter(
    (resource) => resource.kind !== "link" && (!resourceId || resource.id === resourceId),
  );
  return copies.filter(
    (copy) =>
      copy.projectId === project.id &&
      copy.environmentId === environmentId &&
      copy.state === "ready" &&
      copy.registered !== false &&
      (required.length > 0 || copy.repositories.length === 0) &&
      required.every((resource) =>
        copy.repositories.some((repository) => repository.resourceId === resource.id),
      ),
  );
}

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
