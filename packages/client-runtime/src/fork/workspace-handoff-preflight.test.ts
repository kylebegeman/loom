import type { VcsStatusResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  workspaceHandoffCanReconnect,
  workspaceHandoffCheckoutProblem,
} from "./workspace-handoff-preflight.ts";

const published: VcsStatusResult = {
  isRepo: true,
  hasPrimaryRemote: true,
  isDefaultRef: false,
  refName: "feature/move",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

const changed = (paths: ReadonlyArray<string>): Partial<VcsStatusResult> => ({
  hasWorkingTreeChanges: true,
  workingTree: {
    files: paths.map((path) => ({ path, insertions: 1, deletions: 0 })),
    insertions: paths.length,
    deletions: 0,
  },
});

const problem = (patch: Partial<VcsStatusResult>) =>
  workspaceHandoffCheckoutProblem({ ...published, ...patch });

describe("workspaceHandoffCheckoutProblem", () => {
  it("lets a published, clean branch move, even when its remote is ahead", () => {
    expect(problem({})).toBeNull();
    expect(problem({ behindCount: 3 })).toBeNull();
  });

  it("offers Commit & push for local changes, naming the default branch it pushes", () => {
    expect(problem(changed(["a.ts", "b.ts"]))).toEqual({
      reason: "2 changed files aren't committed. Commit and push them before moving work.",
      fix: { action: "commit_push", label: "Commit & push", pendingLabel: "Committing and pushing…" },
    });
    expect(problem({ ...changed(["a.ts"]), isDefaultRef: true, refName: "main" })).toEqual({
      reason: "1 changed file isn't committed. Commit and push it before moving work.",
      fix: { action: "commit_push", label: "Commit & push to main", pendingLabel: "Committing and pushing…" },
    });
  });

  it("offers Push for unpushed commits and for a branch its remote has never seen", () => {
    expect(problem({ aheadCount: 1 })).toEqual({
      reason: "1 commit isn't pushed yet. Push before moving work.",
      fix: { action: "push", label: "Push", pendingLabel: "Pushing…" },
    });
    expect(problem({ hasUpstream: false })).toEqual({
      reason: "This branch isn't on its remote yet. Push it before moving work.",
      fix: { action: "push", label: "Push", pendingLabel: "Pushing…" },
    });
  });

  it("explains what it can't fix in place", () => {
    expect(problem({ aheadCount: 2, behindCount: 1 })?.fix).toBeNull();
    expect(problem({ refName: null })).toEqual({
      reason: "Check out a branch before moving work.",
      fix: null,
    });
    expect(problem({ hasUpstream: false, hasPrimaryRemote: false })).toEqual({
      reason: "This repository has no remote. Publish it before moving work.",
      fix: null,
    });
    expect(
      problem({ ...changed(["a.ts"]), hasUpstream: false, hasPrimaryRemote: false })?.fix,
    ).toBeNull();
  });
});

describe("workspaceHandoffCanReconnect", () => {
  const computer = (enabled: boolean, phase: "reconnecting" | "error" | "offline" | "connected") => ({
    entry: { enabled },
    connection: { phase },
  });

  it("offers a retry only to an enabled computer that is trying to connect", () => {
    expect(workspaceHandoffCanReconnect(computer(true, "reconnecting"))).toBe(true);
    expect(workspaceHandoffCanReconnect(computer(true, "error"))).toBe(true);
    expect(workspaceHandoffCanReconnect(computer(false, "error"))).toBe(false);
    expect(workspaceHandoffCanReconnect(computer(true, "offline"))).toBe(false);
    expect(workspaceHandoffCanReconnect(computer(true, "connected"))).toBe(false);
  });
});
