import type { VcsStatusResult } from "@t3tools/contracts";

import type { EnvironmentConnectionPhase } from "../connection/presentation.ts";

/** The one source control action that clears a checkout problem from the Move work screen. */
export interface WorkspaceHandoffCheckoutFix {
  readonly action: "commit_push" | "push";
  readonly label: string;
  readonly pendingLabel: string;
}

export interface WorkspaceHandoffCheckoutProblem {
  readonly reason: string;
  readonly fix: WorkspaceHandoffCheckoutFix | null;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const fix = (action: WorkspaceHandoffCheckoutFix["action"], onto: string) =>
  action === "push"
    ? { action, label: `Push${onto}`, pendingLabel: "Pushing…" }
    : { action, label: `Commit & push${onto}`, pendingLabel: "Committing and pushing…" };

/**
 * Says before the click what the source computer's offer refuses, in its order: local changes,
 * then commits its remote doesn't have. It reads the git status the composer already
 * subscribes to, so the server stays the authority for what that status can't show, such as a
 * branch that tracks another local branch or a remote that moved since the last refresh.
 */
export function workspaceHandoffCheckoutProblem(
  status: VcsStatusResult,
): WorkspaceHandoffCheckoutProblem | null {
  if (!status.isRepo) {
    return { reason: "Move work needs a git repository, and this folder isn't one.", fix: null };
  }
  if (status.refName === null) {
    return { reason: "Check out a branch before moving work.", fix: null };
  }
  // The composer confirms pushes to the default branch, so the button names it instead.
  const onto = status.isDefaultRef ? ` to ${status.refName}` : "";
  if (status.hasWorkingTreeChanges) {
    if (!status.hasUpstream && !status.hasPrimaryRemote) {
      return {
        reason: "Commit your changes and publish this repository before moving work.",
        fix: null,
      };
    }
    const files = status.workingTree.files.length;
    return {
      reason:
        files === 0
          ? "This checkout has changes that aren't committed. Commit and push them before moving work."
          : `${count(files, "changed file isn't", "changed files aren't")} committed. Commit and push ${files === 1 ? "it" : "them"} before moving work.`,
      fix: fix("commit_push", onto),
    };
  }
  if (!status.hasUpstream) {
    // A push sets the upstream even with nothing ahead, which is all the offer needs.
    return status.hasPrimaryRemote
      ? {
          reason: "This branch isn't on its remote yet. Push it before moving work.",
          fix: fix("push", onto),
        }
      : { reason: "This repository has no remote. Publish it before moving work.", fix: null };
  }
  if (status.aheadCount > 0 && status.behindCount > 0) {
    return {
      reason:
        "This branch and its remote both have new commits. Merge or rebase, then push before moving work.",
      fix: null,
    };
  }
  if (status.aheadCount > 0) {
    return {
      reason: `${count(status.aheadCount, "commit isn't", "commits aren't")} pushed yet. Push before moving work.`,
      fix: fix("push", onto),
    };
  }
  return null;
}

/**
 * Whether Move work offers to reconnect a computer it needs in place. Retrying helps a saved
 * computer that is trying to connect, not one turned off in settings, a device that is offline,
 * or a Loom too old to talk to.
 */
export function workspaceHandoffCanReconnect(computer: {
  readonly entry: { readonly enabled: boolean };
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
}): boolean {
  const { phase } = computer.connection;
  return (
    computer.entry.enabled && phase !== "connected" && phase !== "offline" && phase !== "unsupported"
  );
}
