import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { libraryProjectForLocalRefs, libraryProjectScopeKey } from "./library-navigation.ts";
import { sidebarLocalProjectKey, type SidebarThreadProject } from "./sidebar-project-groups.ts";

/** A Projects view group: a Library project, or the local project group used without a Library. */
export type LibrarySidebarProject<TLocal extends SidebarThreadProject> =
  | {
      readonly kind: "library";
      readonly key: string;
      readonly title: string;
      readonly project: LibraryProject;
    }
  | {
      readonly kind: "local";
      readonly key: string;
      readonly title: string;
      readonly local: TLocal;
    };

export interface LibrarySidebarSource {
  readonly projects: ReadonlyArray<LibraryProject>;
  /** The Library's thread index; a thread registered there names its own project. */
  readonly threads: ReadonlyArray<LibraryThreadSummary>;
  readonly copies: ReadonlyArray<LibraryWorkingCopy>;
}

/**
 * The fork's `keyOf` for `groupSidebarThreadsByProject`. With a Library, a thread belongs to the
 * project it is registered in, else to the one project whose copy holds its folder, so the same
 * project on two computers is one group. Folders no project claims, or that two projects share,
 * return null and land under "Not in a project". Without a Library it falls back to `local`,
 * upstream's logical project grouping.
 */
export function createLibrarySidebarProjectKey<TLocal extends SidebarThreadProject>(input: {
  readonly library: LibrarySidebarSource | null;
  /** Local project groups by `sidebarLocalProjectKey`, from `sidebarProjectsByLocalProject`. */
  readonly local: ReadonlyMap<string, TLocal>;
}): (thread: {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
}) => LibrarySidebarProject<TLocal> | null {
  const { library } = input;
  if (library === null) {
    const byLocal = new Map<string, LibrarySidebarProject<TLocal>>();
    for (const [localKey, local] of input.local) {
      byLocal.set(localKey, { kind: "local", key: local.key, title: local.title, local });
    }
    return (thread) =>
      byLocal.get(sidebarLocalProjectKey(thread.environmentId, thread.projectId)) ?? null;
  }

  const groups = new Map<string, LibrarySidebarProject<TLocal>>();
  for (const project of library.projects) {
    groups.set(project.id, {
      kind: "library",
      key: libraryProjectScopeKey(project.id),
      title: project.title,
      project,
    });
  }
  const registered = new Map<string, string>();
  for (const thread of library.threads) {
    registered.set(`${thread.environmentId}:${thread.threadId}`, thread.projectId);
  }
  // Resolved once per folder: every thread in it asks the same question.
  const byFolder = new Map<string, LibrarySidebarProject<TLocal> | null>();
  const folderProject = (environmentId: string, projectId: string) => {
    const folderKey = sidebarLocalProjectKey(environmentId, projectId);
    let group = byFolder.get(folderKey);
    if (group === undefined) {
      const id = libraryProjectForLocalRefs(
        library.threads,
        [{ environmentId, projectId }],
        library.copies,
      );
      group = (id ? groups.get(id) : undefined) ?? null;
      byFolder.set(folderKey, group);
    }
    return group;
  };
  return (thread) => {
    const id = registered.get(`${thread.environmentId}:${thread.id}`);
    return (
      (id ? groups.get(id) : undefined) ??
      folderProject(thread.environmentId, thread.projectId) ??
      null
    );
  };
}
