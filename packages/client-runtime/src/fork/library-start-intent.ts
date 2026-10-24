import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { canonicalRepositoryKey } from "@t3tools/shared/sourceControl";
import { libraryResourceFromInput } from "./library-project.ts";

export type LibraryStartIntent =
  | { readonly kind: "folder"; readonly path: string; readonly title: string }
  | { readonly kind: "repository"; readonly url: string; readonly title: string }
  | { readonly kind: "search"; readonly text: string };

export function libraryStartIntent(value: string): LibraryStartIntent {
  const text = value.trim();
  if (/^(?:\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(text))
    return {
      kind: "folder",
      path: text,
      title:
        text
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .at(-1) || "Project",
    };
  const resource = libraryResourceFromInput(text, []);
  if (resource && resource.kind !== "link" && resource.remoteUrl)
    return { kind: "repository", url: resource.remoteUrl, title: resource.title };
  return { kind: "search", text };
}

export function rankLibraryStartProjects(
  projects: readonly LibraryProject[],
  threads: readonly LibraryThreadSummary[],
) {
  const recent = new Map<string, number>();
  for (const thread of threads) {
    if (thread.deleted || thread.archived) continue;
    recent.set(
      thread.projectId,
      Math.max(recent.get(thread.projectId) ?? 0, Date.parse(thread.updatedAt) || 0),
    );
  }
  return projects
    .filter((project) => !project.archived)
    .sort(
      (a, b) =>
        (recent.get(b.id) ?? 0) - (recent.get(a.id) ?? 0) ||
        Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
        a.title.localeCompare(b.title),
    );
}

/** Match repository identity across HTTPS and SSH without guessing from project names. */
export function libraryStartRepositoryProjects(
  projects: readonly LibraryProject[],
  remote: string,
) {
  const key = canonicalRepositoryKey(normalizeGitRemoteUrl(remote));
  return projects.filter(
    (project) =>
      !project.archived &&
      project.resources.some(
        (resource) =>
          resource.kind !== "link" &&
          resource.remoteUrl &&
          canonicalRepositoryKey(normalizeGitRemoteUrl(resource.remoteUrl)) === key,
      ),
  );
}

/** A folder association belongs to its computer, including projects without Git remotes. */
export function libraryStartFolderProjects(
  projects: readonly LibraryProject[],
  copies: readonly LibraryWorkingCopy[],
  environmentId: string,
  rootPath: string,
) {
  const normalize = (path: string) => {
    const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
    return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
  };
  const associated = new Set(
    copies
      .filter(
        (copy) =>
          copy.environmentId === environmentId &&
          copy.registered !== false &&
          copy.state !== "released" &&
          normalize(copy.rootPath) === normalize(rootPath),
      )
      .map((copy) => copy.projectId),
  );
  return projects.filter((project) => !project.archived && associated.has(project.id));
}
