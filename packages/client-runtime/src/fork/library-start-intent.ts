import type {
  LibraryFolderInspection,
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

/**
 * The project holding a folder, as its computer recorded it, judged against the Library now.
 * Only a current owner keeps the folder; an archived or missing one gives it up when the folder
 * is added elsewhere. `projects` must include archived ones; null means they have not loaded.
 */
export function libraryFolderOwner(
  registration: LibraryFolderInspection["registration"],
  projects: readonly LibraryProject[] | null | undefined,
) {
  if (registration === undefined) return null;
  const managed = registration.ownership === "managed";
  if (!projects) return { kind: "unchecked" as const, title: registration.projectTitle, managed };
  const project = projects.find((entry) => entry.id === registration.projectId);
  if (project === undefined)
    return { kind: "missing" as const, title: registration.projectTitle, managed };
  if (project.archived) return { kind: "archived" as const, title: project.title, managed };
  return { kind: "current" as const, title: project.title, managed, project };
}
export type LibraryFolderOwner = NonNullable<ReturnType<typeof libraryFolderOwner>>;

/**
 * Why the folder's computer would refuse adding it to `projectId` (null until one is chosen).
 * The computer decides too, but only after a new project exists; deciding first keeps a refused
 * folder from leaving an empty project behind.
 */
export function libraryFolderOwnerIssue(
  owner: LibraryFolderOwner | null,
  projectId: string | null,
) {
  if (owner === null) return null;
  if (owner.kind === "unchecked")
    return "Loom could not check which project owns this folder. Reconnect your Library and try again.";
  if (owner.kind === "current")
    return projectId === null || projectId === owner.project.id
      ? null
      : `This folder already belongs to ${owner.title}. Add it to that project instead.`;
  // Files Loom created can hold unpushed work, so only their own project's review frees them.
  if (!owner.managed) return null;
  return owner.kind === "archived"
    ? `This folder holds files Loom created for archived ${owner.title}. Restore that project, then review and remove them before adding the folder to another one.`
    : `This folder holds files Loom created for ${owner.title}, which is no longer in your Library. Choose another folder.`;
}

/** What adding the folder does to the project it leaves, when that project is not current. */
export function libraryFolderTakeover(owner: LibraryFolderOwner | null) {
  if (owner === null || owner.managed) return null;
  if (owner.kind === "archived")
    return `Takes this folder over from archived ${owner.title}. Its conversations stay in the archive.`;
  if (owner.kind === "missing")
    return `Takes this folder over from ${owner.title}, which is no longer in your Library.`;
  return null;
}
