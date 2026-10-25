import {
  libraryFolderOwner,
  libraryFolderOwnerIssue,
  libraryFolderTakeover,
  libraryFolderTitle,
} from "@t3tools/client-runtime/fork";
import type { LibraryFolderRegistration, LibraryProject } from "@t3tools/contracts/fork";

// Stands in for the project Create would make, which has no id until it exists.
const NEW_PROJECT = "new";

/**
 * What New project can do with an inspected folder, decided before anything is created so a
 * folder its computer would refuse never leaves an empty project behind. `project` is an existing
 * project to add the folder to instead of creating one.
 */
export function libraryExistingFolderTarget(input: {
  /** Every project holding the folder on its computer, newest first. */
  readonly registrations: readonly LibraryFolderRegistration[];
  /** Every Library project, archived ones included. Null until they load. */
  readonly projects: readonly LibraryProject[] | null;
  readonly loading: boolean;
  /** A project created for this folder earlier, which a retry adds the folder to. */
  readonly created: LibraryProject | null;
}) {
  const owner = libraryFolderOwner(input.registrations, input.projects);
  if (owner?.kind === "unchecked" && input.loading)
    return {
      canCreate: false,
      project: null,
      copyId: null,
      error: null,
      detail: "Checking which project owns this folder…",
    };
  const createIssue = libraryFolderOwnerIssue(owner, NEW_PROJECT);
  if (owner?.kind === "current")
    return {
      canCreate: false,
      project: owner.project,
      // Files Loom created start as that saved copy; adding them as a plain folder would overlap it.
      copyId: owner.managed ? owner.workingCopyId : null,
      error: null,
      detail: createIssue,
    };
  if (createIssue !== null)
    return { canCreate: false, project: null, copyId: null, error: createIssue, detail: null };
  const takeover = libraryFolderTakeover(owner);
  const listed = input.projects?.find((project) => project.id === input.created?.id);
  // Until the Library answers, trust the project this device created; after, only a current one.
  const created =
    input.projects === null ? input.created : listed && !listed.archived ? listed : null;
  if (created !== null)
    return {
      canCreate: false,
      project: created,
      copyId: null,
      error: null,
      detail: [
        `You already created ${created.title} for this folder. Add the folder to it instead of creating another project.`,
        takeover,
      ]
        .filter(Boolean)
        .join(" "),
    };
  return { canCreate: true, project: null, copyId: null, error: null, detail: takeover };
}

/** What tapping a folder row does, named on the row before the folder is inspected. */
export type LibraryFolderAction =
  | { readonly kind: "add"; readonly project: LibraryProject }
  | { readonly kind: "create"; readonly title: string };

/**
 * The action a folder row names from what the Library already records: the project its files are
 * registered to, else one this device created for it, else a new project. Null while that is
 * unknown or several projects hold the folder, so the row only picks it and the form asks.
 */
export function libraryFolderRowAction(input: {
  /** Projects with files registered at this folder. Null until the Library answers. */
  readonly registered: readonly LibraryProject[] | null;
  readonly created: LibraryProject | null;
  readonly rootPath: string;
  /** A name typed before choosing the folder, which a new project keeps. */
  readonly title: string | null;
}): LibraryFolderAction | null {
  if (input.registered === null || input.registered.length > 1) return null;
  const project = input.registered[0] ?? input.created;
  if (project) return { kind: "add", project };
  // Named as web names it, so a folder proposes the same project on every surface.
  return { kind: "create", title: input.title ?? libraryFolderTitle(input.rootPath) };
}

/**
 * What a tapped folder row does once its computer has answered. The tap finishes only the action
 * the row named. Anything else, such as another owner, a refusal, or a project already using these
 * repositories, stops on the form so one tap never does something the row did not say.
 */
export function libraryFolderActionOutcome(
  input: Parameters<typeof libraryExistingFolderTarget>[0] & {
    readonly action: LibraryFolderAction | null;
    /** Library projects that already hold this folder's files or repositories. */
    readonly matches: readonly LibraryProject[];
  },
):
  | { readonly kind: "wait" | "review" | "create" }
  | { readonly kind: "add"; readonly project: LibraryProject; readonly copyId: string | null } {
  const owner = libraryFolderOwner(input.registrations, input.projects);
  if (owner?.kind === "unchecked" && input.loading) return { kind: "wait" };
  const action = input.action;
  if (action?.kind === "add") {
    // The form shows the same refusal, since a project that does not hold the folder gets the one
    // a new project would.
    if (libraryFolderOwnerIssue(owner, action.project.id) !== null) return { kind: "review" };
    const holder = owner?.holders.find(
      (entry) => entry.kind === "current" && entry.project.id === action.project.id,
    );
    return {
      kind: "add",
      project: action.project,
      copyId: holder?.managed ? holder.workingCopyId : null,
    };
  }
  if (action?.kind === "create" && input.matches.length === 0)
    return libraryExistingFolderTarget(input).canCreate ? { kind: "create" } : { kind: "review" };
  return { kind: "review" };
}

// New project creates the project, then the start screen adds the folder, so when adding fails
// the form is already gone. Remembering the project for the app session lets the next attempt
// add the folder to it rather than create a duplicate.
const createdForFolder = new Map<string, LibraryProject>();
const folderKey = (
  authorityId: string,
  folder: { readonly environmentId: string; readonly rootPath: string },
) => JSON.stringify([authorityId, folder.environmentId, folder.rootPath]);

export function rememberLibraryFolderProject(
  authorityId: string,
  folder: { readonly environmentId: string; readonly rootPath: string },
  project: LibraryProject,
) {
  createdForFolder.set(folderKey(authorityId, folder), project);
}

export function rememberedLibraryFolderProject(
  authorityId: string | null,
  folder: { readonly environmentId: string; readonly rootPath: string },
) {
  return authorityId === null
    ? null
    : (createdForFolder.get(folderKey(authorityId, folder)) ?? null);
}
