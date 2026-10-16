import {
  isRepositoryResource,
  libraryCopiesForScope,
  libraryCopyReadiness,
} from "@t3tools/client-runtime/fork";
import type {
  LibraryProject,
  LibraryResource,
  LibraryThreadBinding,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

export function libraryRepositories(project: LibraryProject) {
  return project.resources.filter(isRepositoryResource);
}

/** Cached empty data cannot justify preparing another copy while its refresh is unsettled. */
export function libraryListState(query: {
  readonly data: readonly unknown[] | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly isSuccess: boolean;
}) {
  const readiness = libraryCopyReadiness(query);
  if (readiness !== "ready") return readiness;
  if (query.data === null) return "loading";
  return query.data.length === 0 ? "empty" : "ready";
}

export function libraryBinding(
  project: LibraryProject,
  copy: LibraryWorkingCopy,
  resourceIds: readonly string[],
): LibraryThreadBinding {
  if (!libraryCopiesForScope(project, [copy], copy.environmentId, resourceIds).length)
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
