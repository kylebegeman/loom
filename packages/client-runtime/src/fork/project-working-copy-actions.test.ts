import { ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { projectWorkingCopyActionBlocker } from "./project-working-copy-actions.ts";

function preview(overrides: Partial<ProjectCheckoutPreview> = {}): ProjectCheckoutPreview {
  return {
    projectId: ProjectId.make("project"),
    workspaceRoot: "/projects/demo",
    state: "managed",
    ownershipSource: "clone",
    retention: "keep",
    head: "abc",
    branch: "main",
    repositoryIdentity: null,
    localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
    blockers: [],
    reviewToken: "review-token",
    ...overrides,
  };
}

describe("manual working copy actions", () => {
  it("preserves unmanaged folders until their ownership is explicitly reviewed", () => {
    expect(
      projectWorkingCopyActionBlocker(
        preview({ state: "external", ownershipSource: null }),
        "release",
      ),
    ).toContain("allow Loom to manage this folder");
  });
  it("shows the concrete safety blocker and requires a current review token", () => {
    expect(
      projectWorkingCopyActionBlocker(
        preview({
          localFiles: { trackedChanges: 1, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
        }),
        "release",
      ),
    ).toContain("unpublished changes or local-only files");
    expect(projectWorkingCopyActionBlocker(preview({ reviewToken: null }), "release")).toContain(
      "Review it again",
    );
  });
  it("allows removal for a reviewed managed copy and restoration only after removal", () => {
    expect(projectWorkingCopyActionBlocker(preview(), "release")).toBeNull();
    expect(projectWorkingCopyActionBlocker(preview(), "restore")).toContain("already available");
    expect(projectWorkingCopyActionBlocker(preview({ state: "released" }), "restore")).toBeNull();
    expect(projectWorkingCopyActionBlocker(preview({ state: "released" }), "release")).toContain(
      "already been removed",
    );
  });
  it("lets the server review ignored dependencies and a published detached revision", () => {
    expect(
      projectWorkingCopyActionBlocker(
        preview({
          branch: null,
          blockers: ["Ignored files remain.", "Detached revision is preserved."],
          localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 5, truncated: false },
        }),
        "release",
      ),
    ).toBeNull();
  });
  it("never restores into a blocked folder", () => {
    expect(
      projectWorkingCopyActionBlocker(
        preview({ state: "blocked", blockers: ["Another folder occupies this path."] }),
        "restore",
      ),
    ).toBe("Another folder occupies this path.");
  });
});
