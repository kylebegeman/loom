import type { ServerConfig } from "@t3tools/contracts";
import type {
  LibraryFolderInspection,
  LibraryPlacement,
  LibraryResource,
} from "@t3tools/contracts/fork";
import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import { newProjectFolderName } from "@t3tools/shared/path";
import { getCloneDestinationPath } from "../operations/projects.ts";

/** The computer picks folders for copies and clones itself. Older ones need a path sent. */
export function serverChoosesFolders(
  config: Pick<ServerConfig, "serverChosenFolders"> | null | undefined,
): boolean {
  return config?.serverChosenFolders === true;
}

/** Placements that work in files already on the computer instead of new ones. */
export function libraryPlacementReuses(placement: Pick<LibraryPlacement, "action">): boolean {
  return placement.action === "use" || placement.action === "reuse-existing";
}

/** The one line a client shows for where a computer will put a project's files. */
export function libraryPlacementLine(
  placement: Pick<LibraryPlacement, "action" | "rootPath">,
): string {
  return libraryPlacementReuses(placement)
    ? `Uses the existing checkout at ${placement.rootPath}`
    : `Loom will put the files in ${placement.rootPath}`;
}

/** Without a preview, a new clone is the safe guess; the computer resolves it again anyway. */
export function libraryPlacementStrategy(
  placement: Pick<LibraryPlacement, "action"> | null | undefined,
): "reuse" | "clone" {
  return placement && libraryPlacementReuses(placement) ? "reuse" : "clone";
}

/**
 * Whether files the computer places will be Loom's to keep or clean up. The preview's ownership
 * wins, since a reused copy can be managed and a found checkout never is.
 */
export function libraryPlacementManaged(
  placement: Pick<LibraryPlacement, "ownership"> | null | undefined,
  strategy: "reuse" | "clone",
): boolean {
  return placement ? placement.ownership === "managed" : strategy === "clone";
}

/** The line a restore shows when the computer picks its folder. */
export const LIBRARY_RESTORE_FOLDER_LINE =
  "Loom will restore the saved files into a new folder on this computer";

/**
 * What a chosen folder can do for the selected repositories: `reuse` when it already holds them,
 * `clone` when it is missing or empty, and `occupied` when it holds something else. `empty` is
 * what a browser saw; unknown means the computer refuses a folder with other files itself.
 */
export type LibraryFolderChoice = "reuse" | "clone" | "occupied";

export const LIBRARY_FOLDER_CHOICE_TITLES = {
  reuse: "Use files in this folder",
  clone: "Download into this folder",
} as const;

export const LIBRARY_FOLDER_OCCUPIED_MESSAGE =
  "This folder holds other files. Choose an empty folder, or one that already has this project.";

export function libraryFolderChoice(
  inspection: Pick<LibraryFolderInspection, "exists" | "repositories">,
  resources: readonly Pick<LibraryResource, "remoteUrl" | "relativePath">[],
  empty?: boolean,
): LibraryFolderChoice {
  if (!inspection.exists) return "clone";
  const holds = (resource: Pick<LibraryResource, "remoteUrl" | "relativePath">) =>
    inspection.repositories.some((repository) =>
      resource.remoteUrl
        ? repository.remoteUrl !== null &&
          normalizeGitRemoteUrl(repository.remoteUrl) === normalizeGitRemoteUrl(resource.remoteUrl)
        : repository.remoteUrl === null &&
          (repository.relativePath === resource.relativePath ||
            (resources.length === 1 && repository.relativePath === ".")),
    );
  if (resources.every(holds)) return "reuse";
  return inspection.repositories.length === 0 && empty !== false ? "clone" : "occupied";
}

/** A new folder for the project inside a browsed one, named the way the computer names them. */
export function libraryNewFolderPath(
  parent: string,
  title: string,
  taken: readonly string[] = [],
): string {
  const base = newProjectFolderName(title);
  const names = new Set(taken.map((name) => name.toLowerCase()));
  let name = base;
  for (let suffix = 2; names.has(name); suffix += 1) name = `${base}-${suffix}`;
  return getCloneDestinationPath(parent, name);
}
