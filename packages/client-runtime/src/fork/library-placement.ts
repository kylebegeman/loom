import type { ServerConfig } from "@t3tools/contracts";
import type { LibraryPlacement } from "@t3tools/contracts/fork";

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
