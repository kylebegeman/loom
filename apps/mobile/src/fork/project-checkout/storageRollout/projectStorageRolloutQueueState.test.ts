import {
  projectStorageRolloutKey,
  type ProjectStorageRolloutRow,
  type ProjectStorageRolloutSnapshot,
  type ProjectStorageRolloutTarget,
} from "@t3tools/client-runtime/fork";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { projectStorageRolloutQueueState } from "./projectStorageRolloutQueueState";

const target: ProjectStorageRolloutTarget = {
  environmentId: EnvironmentId.make("mac"),
  projectId: ProjectId.make("atlas"),
  workspaceRoot: "/projects/atlas",
  projectName: "Atlas",
  environmentLabel: "Mac",
  connected: true,
  supported: true,
  canRead: true,
  canAdopt: true,
  canSetRetention: true,
};
const preview: ProjectCheckoutPreview = {
  projectId: target.projectId,
  workspaceRoot: target.workspaceRoot,
  state: "external",
  ownershipSource: null,
  retention: "keep",
  head: null,
  branch: "main",
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: [],
  reviewToken: "a".repeat(64),
};
function row(overrides: Partial<ProjectStorageRolloutRow> = {}): ProjectStorageRolloutRow {
  return {
    key: projectStorageRolloutKey(target),
    target,
    selected: true,
    status: "reviewed",
    preview,
    choice: "keep",
    error: null,
    result: null,
    ...overrides,
  };
}
function snapshot(rows: ReadonlyArray<ProjectStorageRolloutRow>): ProjectStorageRolloutSnapshot {
  return { phase: "idle", rows, confirmation: null, cancelRequested: false };
}

describe("native storage rollout queue", () => {
  it("requires an explicit writable choice for every unfinished selected folder", () => {
    expect(projectStorageRolloutQueueState(snapshot([row()])).canConfirm).toBe(true);
    for (const incomplete of [
      row({ choice: null }),
      row({ status: "error", error: "Review expired", preview: null, choice: null }),
      row({ target: { ...target, canAdopt: false } }),
      row({ target: { ...target, connected: false } }),
      row({ choice: "inherit" }),
    ]) {
      expect(projectStorageRolloutQueueState(snapshot([incomplete])).canConfirm).toBe(false);
    }
  });

  it("keeps saved results visible and retries only unfinished reviewable selections", () => {
    const saved = row({ selected: false, status: "saved", result: preview });
    const failed = row({ key: "other", status: "error", preview: null, choice: null });
    const hidden = row({ key: "unselected", selected: false, status: "idle" });
    const state = projectStorageRolloutQueueState(snapshot([saved, failed, hidden]));
    expect(state.rows).toEqual([saved, failed]);
    expect(state.savedCount).toBe(1);
    expect(state.unfinished).toEqual([failed]);
    expect(state.reviewable).toEqual([failed]);
    expect(state.canConfirm).toBe(false);
  });

  it("permits a valid review with safety notices but never confirms an unavailable target", () => {
    const withNotice = row({
      preview: { ...preview, blockers: ["Release also checks active work and published commits."] },
    });
    expect(projectStorageRolloutQueueState(snapshot([withNotice])).canConfirm).toBe(true);
    const unavailable = row({
      status: "idle",
      preview: null,
      choice: null,
      target: { ...target, supported: false },
    });
    expect(projectStorageRolloutQueueState(snapshot([unavailable])).reviewable).toEqual([]);
  });

  it("disables confirmation while a request is running", () => {
    for (const phase of ["reviewing", "saving"] as const) {
      const state = projectStorageRolloutQueueState({ ...snapshot([row()]), phase });
      expect(state.busy).toBe(true);
      expect(state.canConfirm).toBe(false);
    }
  });
});
