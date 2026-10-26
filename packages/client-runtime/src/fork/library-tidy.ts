import type { EnvironmentId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryCopyStatus,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { Atom } from "effect/reactivity";
import { libraryActiveCopies } from "./library-project.ts";
import { isRestingEntry, type ProjectEntry } from "./library-project-list.ts";

/** Why Tidy leaves a copy alone. Anything Tidy cannot vouch for counts as needing attention. */
export type LibraryTidyReason =
  | { readonly kind: "offline" }
  | { readonly kind: "no-permission" }
  | { readonly kind: "uncommitted"; readonly files: number }
  | { readonly kind: "unpushed"; readonly commits: number }
  | { readonly kind: "unavailable" }
  | { readonly kind: "no-repositories" }
  | { readonly kind: "unchecked" };

export type LibraryTidyAttention = {
  readonly copy: LibraryWorkingCopy;
  readonly reasons: readonly LibraryTidyReason[];
};

export type LibraryTidySuggestions = {
  readonly suggestArchive: boolean;
  /** Clean, fully pushed copies on connected computers, in the project's copy order. */
  readonly safe: readonly LibraryWorkingCopy[];
  readonly attention: readonly LibraryTidyAttention[];
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export function libraryTidyReasonLabel(reason: LibraryTidyReason): string {
  switch (reason.kind) {
    case "offline":
      return "Computer offline";
    case "no-permission":
      return "No permission on this computer";
    case "uncommitted":
      return plural(reason.files, "uncommitted file");
    case "unpushed":
      return plural(reason.commits, "unpushed commit");
    case "unavailable":
      return "Copy unavailable";
    case "no-repositories":
      return "No Git repositories to check";
    case "unchecked":
      return "Could not check for changes";
  }
}

/**
 * Whether a copy can be released without losing work: its computer is connected, it is ready, and
 * health read on that computer covers every repository it holds with nothing uncommitted or
 * unpushed. Missing, mismatched or unreadable health is never treated as clean.
 */
export function libraryCopyTidyReasons(
  copy: LibraryWorkingCopy,
  health: LibraryCopyHealth | undefined,
  connected: boolean,
): readonly LibraryTidyReason[] {
  if (!connected) return [{ kind: "offline" }];
  if (copy.state !== "ready") return [{ kind: "unavailable" }];
  if (copy.repositories.length === 0) return [{ kind: "no-repositories" }];
  if (!health || health.copyId !== copy.id || health.environmentId !== copy.environmentId)
    return [{ kind: "unchecked" }];
  let files = 0;
  let commits = 0;
  for (const repository of copy.repositories) {
    const read = health.repositories.find((entry) => entry.resourceId === repository.resourceId);
    if (!read || read.error !== undefined) return [{ kind: "unchecked" }];
    files += read.uncommittedFiles;
    commits += Math.max(read.unpushedCommits, read.ahead ?? 0);
  }
  const reasons: LibraryTidyReason[] = [];
  if (files > 0) reasons.push({ kind: "uncommitted", files });
  if (commits > 0) reasons.push({ kind: "unpushed", commits });
  return reasons;
}

type LibraryTidyCanRemove = (copy: LibraryWorkingCopy) => boolean;
type PermissionCommand = {
  readonly permissionAtom: (environmentId: EnvironmentId) => Atom.Atom<boolean>;
};

/**
 * Whether this client may release or unregister each copy. Removal runs on the copy's own computer,
 * not on the Library, so the grant is read there for the command the copy's ownership needs.
 */
export function libraryCopyRemovalPermission(
  commands: { readonly releaseCopy: PermissionCommand; readonly unregisterCopy: PermissionCommand },
  environmentIds: readonly EnvironmentId[],
) {
  return Atom.make((get): LibraryTidyCanRemove => {
    const granted = (command: PermissionCommand) =>
      new Set(environmentIds.filter((id) => get(command.permissionAtom(id))));
    const release = granted(commands.releaseCopy);
    const unregister = granted(commands.unregisterCopy);
    return (copy) => (copy.ownership === "borrowed" ? unregister : release).has(copy.environmentId);
  });
}

/** What Tidy offers for a project: archiving it if it is resting, and which copies to release. */
export function libraryTidySuggestions(input: {
  readonly entry: ProjectEntry;
  readonly health: readonly LibraryCopyHealth[];
  readonly connected: (environmentId: EnvironmentId) => boolean;
  readonly canRemove: LibraryTidyCanRemove;
  readonly now: number;
}): LibraryTidySuggestions {
  const safe: LibraryWorkingCopy[] = [];
  const attention: LibraryTidyAttention[] = [];
  for (const copy of libraryActiveCopies(input.entry.copies)) {
    const connected = input.connected(copy.environmentId);
    const reasons: readonly LibraryTidyReason[] =
      connected && !input.canRemove(copy)
        ? [{ kind: "no-permission" }]
        : libraryCopyTidyReasons(
            copy,
            input.health.find((health) => health.copyId === copy.id),
            connected,
          );
    if (reasons.length) attention.push({ copy, reasons });
    else safe.push(copy);
  }
  return {
    suggestArchive: !input.entry.project.archived && isRestingEntry(input.entry, input.now),
    safe,
    attention,
  };
}

export type LibraryTidyCopyResult =
  | { readonly copy: LibraryWorkingCopy; readonly outcome: "released" }
  | {
      readonly copy: LibraryWorkingCopy;
      readonly outcome: "kept";
      readonly reasons: readonly LibraryTidyReason[];
    }
  | {
      readonly copy: LibraryWorkingCopy;
      readonly outcome: "blocked";
      readonly blockers: readonly string[];
    }
  | { readonly copy: LibraryWorkingCopy; readonly outcome: "failed"; readonly message: string };

export type LibraryTidyResult = {
  readonly copies: readonly LibraryTidyCopyResult[];
  /** Null when archiving was not chosen. */
  readonly archive: { readonly ok: true } | { readonly ok: false; readonly message: string } | null;
};

/**
 * Everything that stops these files from being removed. `releaseBlockers` stop only removal, so
 * snapshots and starting on another computer keep reading `blockers` alone.
 */
export function libraryCopyRemovalBlockers(
  status: Pick<LibraryCopyStatus, "blockers" | "releaseBlockers">,
): readonly string[] {
  return [...new Set([...status.blockers, ...(status.releaseBlockers ?? [])])];
}

const failureMessage = (cause: unknown, fallback: string) =>
  cause instanceof Error && cause.message ? cause.message : fallback;

/**
 * Releases the chosen copies one at a time, then archives the project if asked. Each copy's status
 * is read again just before release, and a copy no longer clean and pushed, removable by this
 * client, or allowed by the server is kept. A failure on one copy is reported and the rest
 * continue.
 */
export async function runLibraryTidy(input: {
  readonly copies: readonly LibraryWorkingCopy[];
  readonly archive: boolean;
  readonly connected: (environmentId: EnvironmentId) => boolean;
  readonly canRemove: LibraryTidyCanRemove;
  readonly readStatus: (copy: LibraryWorkingCopy) => Promise<LibraryCopyStatus>;
  readonly remove: (status: LibraryCopyStatus, reviewToken: string) => Promise<LibraryWorkingCopy>;
  readonly register: (copy: LibraryWorkingCopy) => Promise<void>;
  readonly archiveProject: () => Promise<void>;
  readonly progress?: (results: readonly LibraryTidyCopyResult[]) => void;
}): Promise<LibraryTidyResult> {
  const results: LibraryTidyCopyResult[] = [];
  const settle = (result: LibraryTidyCopyResult) => {
    results.push(result);
    input.progress?.([...results]);
  };
  for (const copy of input.copies) {
    if (!input.connected(copy.environmentId)) {
      settle({ copy, outcome: "kept", reasons: [{ kind: "offline" }] });
      continue;
    }
    try {
      const status = await input.readStatus(copy);
      let removed = status.copy;
      // A copy already released or unregistered only needs the Library to hear about it.
      if (removed.state !== "released" && removed.registered !== false) {
        const reasons = libraryCopyTidyReasons(removed, status.health, true);
        if (reasons.length) {
          settle({ copy, outcome: "kept", reasons });
          continue;
        }
        // Checked on the fresh copy, whose ownership picks the command that needs the grant.
        if (!input.canRemove(removed)) {
          settle({ copy, outcome: "kept", reasons: [{ kind: "no-permission" }] });
          continue;
        }
        const blockers = libraryCopyRemovalBlockers(status);
        if (blockers.length || !status.reviewToken) {
          settle({ copy, outcome: "blocked", blockers });
          continue;
        }
        removed = await input.remove(status, status.reviewToken);
      }
      await input.register(removed);
      settle({ copy, outcome: "released" });
    } catch (cause) {
      settle({
        copy,
        outcome: "failed",
        message: failureMessage(cause, "Could not remove this copy."),
      });
    }
  }
  if (!input.archive) return { copies: results, archive: null };
  try {
    await input.archiveProject();
    return { copies: results, archive: { ok: true } };
  } catch (cause) {
    return {
      copies: results,
      archive: { ok: false, message: failureMessage(cause, "Could not archive the project.") },
    };
  }
}
