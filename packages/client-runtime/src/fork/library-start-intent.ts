import type {
  LibraryFolderInspection,
  LibraryFolderRegistration,
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
 * Every project holding a folder, newest first. Builds before one-owner folders could register a
 * folder to several projects; computers that predate reporting them all name only one.
 */
export function libraryFolderRegistrations(
  inspection: Pick<LibraryFolderInspection, "registration" | "registrations"> | null | undefined,
) {
  if (!inspection) return [];
  if (inspection.registrations?.length) return inspection.registrations;
  return inspection.registration ? [inspection.registration] : [];
}

const folderHolder = (
  registration: LibraryFolderRegistration,
  projects: readonly LibraryProject[] | null | undefined,
) => {
  const recorded = {
    workingCopyId: registration.workingCopyId,
    projectId: registration.projectId,
    managed: registration.ownership === "managed",
  };
  if (!projects)
    return { ...recorded, kind: "unchecked" as const, title: registration.projectTitle };
  const project = projects.find((entry) => entry.id === registration.projectId);
  if (project === undefined)
    return { ...recorded, kind: "missing" as const, title: registration.projectTitle };
  if (project.archived) return { ...recorded, kind: "archived" as const, title: project.title };
  return { ...recorded, kind: "current" as const, title: project.title, project };
};
export type LibraryFolderHolder = ReturnType<typeof folderHolder>;

/**
 * The projects holding a folder, as its computer recorded them, judged against the Library now.
 * A current holder keeps the folder and files Loom created hold it for their own project, so the
 * owner is the first current holder, then the first managed one. Archived or missing borrowed
 * holders give the folder up when it is added elsewhere. `projects` must include archived ones;
 * null means they have not loaded.
 */
export function libraryFolderOwner(
  registrations: readonly LibraryFolderRegistration[],
  projects: readonly LibraryProject[] | null | undefined,
) {
  const holders = registrations.map((registration) => folderHolder(registration, projects));
  const owner =
    holders.find((holder) => holder.kind === "current") ??
    holders.find((holder) => holder.managed) ??
    holders.at(0);
  return owner === undefined ? null : { ...owner, holders };
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
  // A project that already holds the folder reuses it. Its computer weighs the other holders only
  // when that copy no longer fits the project, and then explains its refusal itself.
  if (
    projectId !== null &&
    owner.holders.some((holder) => holder.kind === "current" && holder.project.id === projectId)
  )
    return null;
  if (owner.kind === "current")
    return projectId === null
      ? null
      : `This folder already belongs to ${owner.title}. Add it to that project instead.`;
  // Files Loom created can hold unpushed work, so only their own project's review frees them.
  if (!owner.managed) return null;
  return owner.kind === "archived"
    ? `This folder holds files Loom created for archived ${owner.title}. Restore that project, then review and remove them before adding the folder to another one.`
    : `This folder holds files Loom created for ${owner.title}, which is no longer in your Library. Choose another folder.`;
}

const listTitles = (titles: readonly string[]) =>
  titles.length < 2 ? titles.join("") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;

/** What adding the folder does to the projects it leaves, when every one is archived or gone. */
export function libraryFolderTakeover(owner: LibraryFolderOwner | null) {
  // The owner is current or managed when any holder is, so past this check every holder is
  // borrowed and its project archived or gone.
  if (owner === null || owner.managed || owner.kind === "current" || owner.kind === "unchecked")
    return null;
  const titles = (kind: "archived" | "missing") => [
    ...new Map(
      owner.holders
        .filter((holder) => holder.kind === kind)
        .map((holder) => [holder.projectId, holder.title]),
    ).values(),
  ];
  const archived = titles("archived");
  const missing = titles("missing");
  const from = [
    ...(archived.length ? [`archived ${listTitles(archived)}`] : []),
    ...(missing.length
      ? [
          `${listTitles(missing)}, which ${missing.length === 1 ? "is" : "are"} no longer in your Library`,
        ]
      : []),
  ].join(" and from ");
  // Beside a project the Library no longer has, "its" would point at that one, which has no archive.
  const archive = !archived.length
    ? ""
    : missing.length
      ? ` Conversations from ${listTitles(archived)} stay in the archive.`
      : ` ${archived.length === 1 ? "Its" : "Their"} conversations stay in the archive.`;
  return `Takes this folder over from ${from}.${archive}`;
}
