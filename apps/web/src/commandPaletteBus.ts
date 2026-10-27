import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@t3tools/contracts";

import { dispatchCommandPalette, isCommandPaletteMounted } from "./commandPaletteStore";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

export interface CommandPaletteOpenDetail {
  readonly open?: "add-project" | "new-thread-in";
  readonly environmentId?: EnvironmentId; // fork: fleet-connections
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
  /** Opens the root action submenu with this value. */
  readonly submenu?: string; // fork: library-palette
}

// fork: library-palette - The mounted palette can let the Library claim a request first.
let claimRequest: ((detail: CommandPaletteOpenDetail) => boolean) | null = null;

/** Claims palette requests until the returned function releases them. */
// fork: library-palette
export function claimCommandPaletteRequests(
  claim: (detail: CommandPaletteOpenDetail) => boolean,
): () => void {
  claimRequest = claim;
  return () => {
    if (claimRequest === claim) claimRequest = null;
  };
}

export function openCommandPalette(detail: CommandPaletteOpenDetail = {}): void {
  // With no palette on screen (e.g. /pair) the request is dropped; kept in the
  // store, it would pop a stale palette once the app shell mounts.
  if (!isCommandPaletteMounted()) return;
  if (claimRequest?.(detail)) return; // fork: library-palette
  if (detail.open === "new-thread-in") {
    dispatchCommandPalette({ _tag: "OpenNewThreadIn" });
  } else if (detail.open === "add-project") {
    dispatchCommandPalette({
      _tag: "OpenAddProject",
      ...(detail.environmentId ? { environmentId: detail.environmentId } : {}), // fork: fleet-connections
    });
  } else if (detail.submenu !== undefined) {
    dispatchCommandPalette({ _tag: "OpenSubmenu", value: detail.submenu }); // fork: library-palette
  } else if (detail.query !== undefined) {
    dispatchCommandPalette({
      _tag: "OpenSearch",
      query: detail.query,
      ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
    });
  } else {
    dispatchCommandPalette({ _tag: "SetOpen", open: true });
  }
}

/** True while the palette popup is on screen, including its closing animation. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
