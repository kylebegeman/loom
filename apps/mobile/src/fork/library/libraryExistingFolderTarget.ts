import {
  libraryFolderOwner,
  libraryFolderOwnerIssue,
  libraryFolderTakeover,
} from "@t3tools/client-runtime/fork";
import type { LibraryFolderInspection, LibraryProject } from "@t3tools/contracts/fork";

// Stands in for the project Create would make, which has no id until it exists.
const NEW_PROJECT = "new";

/**
 * What New project can do with an inspected folder, decided before anything is created so a
 * folder its computer would refuse never leaves an empty project behind. `project` is an existing
 * project to add the folder to instead of creating one.
 */
export function libraryExistingFolderTarget(input: {
  readonly registration: LibraryFolderInspection["registration"];
  /** Every Library project, archived ones included. Null until they load. */
  readonly projects: readonly LibraryProject[] | null;
  readonly loading: boolean;
  /** A project created for this folder earlier, which a retry adds the folder to. */
  readonly created: LibraryProject | null;
}) {
  const owner = libraryFolderOwner(input.registration, input.projects);
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
      copyId: owner.managed ? (input.registration?.workingCopyId ?? null) : null,
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
