// fork: source-control-cockpit
import { describe, expect, it } from "vite-plus/test";
import type { VcsStatusResult } from "@t3tools/contracts";
import {
  buildGitRecoveryPrompt,
  buildMenuItems,
  gitWaitingLabel,
  landedBranch,
  requiresDefaultBranchConfirmation,
  resolveQuickAction,
} from "./gitActions.ts";

const status = (changes: Partial<VcsStatusResult> = {}): VcsStatusResult => ({
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
  ...changes,
});

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
