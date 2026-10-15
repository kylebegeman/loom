import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryResource,
  LibraryThreadBinding,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

export function libraryRepositories(project: LibraryProject) {
  return project.resources.filter((resource) => resource.kind !== "link");
}

/** Cached empty data cannot justify preparing another copy while its refresh is unsettled. */
export function libraryListState(query: {
  readonly data: readonly unknown[] | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
}) {
  if (query.error !== null) return "error";
  if (query.isPending || !query.isSuccess || query.data === null) return "loading";
  return query.data.length === 0 ? "empty" : "ready";
}

export function libraryEligibleCopies(
  project: LibraryProject,
  environmentId: EnvironmentId | null,
  resourceIds: readonly string[],
  copies: readonly LibraryWorkingCopy[],
) {
  const resources = libraryRepositories(project);
  if (
    new Set(resourceIds).size !== resourceIds.length ||
    (resourceIds.length === 0 && resources.length > 0) ||
    resourceIds.some((id) => !resources.some((resource) => resource.id === id))
  )
    return [];
  const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
  return copies.filter(
    (copy) =>
      copy.projectId === project.id &&
      copy.environmentId === environmentId &&
      copy.registered !== false &&
      copy.state === "ready" &&
      (resources.length > 0 || copy.repositories.length === 0) &&
      resourceIds.every((id) => {
        const resource = resources.find((resource) => resource.id === id)!;
        const expected = `${normalizePath(copy.rootPath)}/${resource.relativePath}`;
        return copy.repositories.some(
          (repo) => repo.resourceId === id && normalizePath(repo.path) === expected,
        );
      }),
  );
}

export function libraryBinding(
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  resourceIds: readonly string[],
): LibraryThreadBinding {
  if (!libraryEligibleCopies(project, copy.environmentId, resourceIds, [copy]).length)
    throw new Error("Choose a current working copy containing every selected component.");
  return {
    projectId: project.id,
    projectRevision: project.revision,
    workingCopyId: copy.id,
    environmentId: copy.environmentId,
    resourceIds: [...resourceIds],
  };
}

export function libraryResourceDraft(input: {
  id: string;
  title: string;
  remoteUrl: string;
  relativePath: string;
  defaultBranch?: string;
}): LibraryResource {
  const title = input.title.trim(),
    relativePath = input.relativePath.trim(),
    remoteUrl = input.remoteUrl.trim();
  if (!title || !relativePath)
    throw new Error("Each component needs a name and a relative folder.");
  if (
    relativePath.startsWith("/") ||
    relativePath.startsWith("~") ||
    relativePath.includes("\\") ||
    /^[a-z]:/i.test(relativePath) ||
    relativePath.split("/").some((part) => part === ".." || part === "." || !part)
  )
    throw new Error("Component folders must stay inside the project's parent folder.");
  if (remoteUrl && !/^https:\/\/|^ssh:\/\/|^git@[^:]+:/i.test(remoteUrl))
    throw new Error("Use an HTTPS or SSH repository URL.");
  return {
    id: input.id,
    title,
    kind: "repository",
    relativePath,
    remoteUrl: remoteUrl || null,
    defaultBranch: input.defaultBranch?.trim() || null,
  };
}

export function libraryScopeLabel(project: LibraryProject, ids: readonly string[]) {
  return ids.length === libraryRepositories(project).length &&
    libraryRepositories(project).every((resource) => ids.includes(resource.id))
    ? "Whole project"
    : ids
        .map(
          (id) =>
            project.resources.find((resource) => resource.id === id)?.title ?? "Earlier component",
        )
        .join(", ");
}
