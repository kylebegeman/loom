import { SourceControlProviderKind, type VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "../sourceControlClients.ts";
import {
  buildGitRecoveryPrompt, // fork: source-control-cockpit
  buildMenuItems,
  getGitActionDisabledReason,
  gitWaitingLabel,
  landedBranch,
  requiresDefaultBranchConfirmation,
  resolveDefaultBranchActionDialogCopy,
  resolveQuickAction,
} from "./gitActions.ts";

function status(overrides: Partial<VcsStatusResult> = {}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "feature/test",
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

const gitLab = {
  sourceControlProvider: {
    kind: SourceControlProviderKind.make("gitlab"),
    name: "GitLab",
    baseUrl: "https://gitlab.com",
  },
};

const openPr = {
  number: 7,
  title: "Feature",
  url: "https://example.com/pr/7",
  baseRef: "main",
  headRef: "feature/test",
  state: "open" as const,
};

describe("git action copy", () => {
  it("says PR for a GitHub ref", () => {
    expect(resolveQuickAction(status({ aheadCount: 1 }), false).label).toBe("Push & create PR");
    expect(resolveQuickAction(status({ pr: openPr }), false).label).toBe("View PR");
    const [, , prItem] = buildMenuItems(status(), false);
    expect(prItem?.label).toBe("Create PR");
    expect(
      getGitActionDisabledReason({
        item: prItem!,
        gitStatus: status(),
        isBusy: false,
        hasOriginRemote: true,
      }),
    ).toBe("No local commits to include in a PR.");
  });

  it("says MR for a GitLab ref", () => {
    expect(resolveQuickAction(status({ ...gitLab, aheadCount: 1 }), false).label).toBe(
      "Push & create MR",
    );
    expect(
      resolveQuickAction(status({ ...gitLab, hasWorkingTreeChanges: true }), false).label,
    ).toBe("Commit, push & MR");
    expect(resolveQuickAction(status({ ...gitLab, pr: openPr }), false).label).toBe("View MR");
    const [, , prItem] = buildMenuItems(status(gitLab), false);
    expect(prItem?.label).toBe("Create MR");
    expect(
      getGitActionDisabledReason({
        item: prItem!,
        gitStatus: status(gitLab),
        isBusy: false,
        hasOriginRemote: true,
      }),
    ).toBe("No local commits to include in an MR.");
  });

  it("names the host's change request in the default-branch dialog", () => {
    const input = { action: "commit_push_pr", branchName: "main", includesCommit: true } as const;
    expect(
      resolveDefaultBranchActionDialogCopy({
        ...input,
        terminology: sourceControlClients.get("github").changeRequest,
      }).title,
    ).toBe("Commit, push & create PR from default branch?");
    expect(
      resolveDefaultBranchActionDialogCopy({
        ...input,
        terminology: sourceControlClients.get("gitlab").changeRequest,
      }).continueLabel,
    ).toBe("Commit, push & create MR");
  });
});

// fork: source-control-cockpit
describe("Git recovery", () => {
  it("offers recovery ahead of detached HEAD and commit, and upstream help for divergence", () => {
    const conflicted = status({
      operation: "rebase",
      unmergedCount: 2,
      refName: null,
      hasWorkingTreeChanges: true,
    });
    expect(resolveQuickAction(conflicted, false).kind).toBe("ask_agent");
    expect(buildMenuItems(conflicted, false).every((item) => item.disabled)).toBe(true);
    expect(resolveQuickAction(status({ aheadCount: 2, behindCount: 1 }), false).label).toBe(
      "Ask the agent to sync with upstream",
    );
    expect(resolveQuickAction(conflicted, true).disabled).toBe(true);
  });
  it("quotes conflicted paths and tells the agent when the list was capped", () => {
    const prompt = buildGitRecoveryPrompt(
      status({ operation: "merge", unmergedCount: 2, unmergedPaths: ["a\nfile.ts"] }),
    );
    expect(prompt).toContain('- "a\\nfile.ts"');
    expect(prompt).toContain("complete list");
    expect(prompt).toContain("Do not push");
  });
  it("does not infer a landed branch from missing or stale remote status", () => {
    const landed = status({ headSha: "abc", landedHeadSha: "abc", landedOnDefault: "main" });
    expect(landedBranch(landed, true)).toBe("main");
    expect(landedBranch(landed, false)).toBeNull();
    for (const changes of [
      { headSha: "new" },
      { refName: null },
      { hasWorkingTreeChanges: true },
      { operation: "merge" as const },
      { isDefaultRef: true },
    ]) {
      expect(landedBranch({ ...landed, ...changes }, true)).toBeNull();
    }
    expect(landedBranch(status({ aheadOfDefaultCount: 0 }), true)).toBeNull();
  });
  it("asks by default and skips only with this project's explicit preference", () => {
    for (const action of ["push", "commit_push", "create_pr", "commit_push_pr"] as const) {
      expect(requiresDefaultBranchConfirmation(action, true)).toBe(true);
      expect(requiresDefaultBranchConfirmation(action, true, true)).toBe(false);
      expect(requiresDefaultBranchConfirmation(action, false)).toBe(false);
    }
  });
  it("labels a silent push after twenty seconds and clears it for output or a running hook", () => {
    const pushing = { phase: "push", hookName: null, phaseStartedAtMs: 0, lastProgressAtMs: 1_000 };
    expect(gitWaitingLabel(pushing, 20_999, "Dorothy")).toBeNull();
    expect(gitWaitingLabel(pushing, 21_000, "Dorothy")).toContain("SSH key approval on Dorothy");
    expect(gitWaitingLabel({ ...pushing, lastProgressAtMs: 20_000 }, 21_000, "Dorothy")).toBeNull();
    expect(gitWaitingLabel({ ...pushing, hookName: "pre-push" }, 80_000, "Dorothy")).toBeNull();
    expect(gitWaitingLabel({ ...pushing, phase: "commit" }, 80_000, "Dorothy")).toBeNull();
  });
});
