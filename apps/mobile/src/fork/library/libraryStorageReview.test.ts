import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { libraryFolderProjectId, libraryFolderStorageChange } from "./libraryStorageReview";

const projectId = ProjectId.make("root");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "shared-project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("computer"),
  rootPath: "/Projects/Example",
  rootLocalProjectId: projectId,
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const preview: ProjectCheckoutPreview = {
  projectId,
  workspaceRoot: copy.rootPath,
  state: "external",
  ownershipSource: null,
  retention: "keep",
  head: null,
  branch: null,
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: [],
  reviewToken: "fresh-review",
};

describe("existing folder storage review", () => {
  it("uses the explicit root project, or an exact root repository, never a component", () => {
    const component = {
      resourceId: "app",
      localProjectId: ProjectId.make("component"),
      path: `${copy.rootPath}/app`,
      head: null,
      branch: null,
    };
    expect(libraryFolderProjectId({ ...copy, repositories: [component] })).toBe(projectId);
    expect(
      libraryFolderProjectId({ ...copy, rootLocalProjectId: null, repositories: [component] }),
    ).toBeUndefined();
    expect(
      libraryFolderProjectId({
        ...copy,
        rootLocalProjectId: null,
        repositories: [{ ...component, path: copy.rootPath }],
      }),
    ).toBe(component.localProjectId);
  });
  it("requires explicit consent to the fresh review before allowing automatic cleanup", () => {
    expect(() => libraryFolderStorageChange(copy, projectId, preview, false, null)).toThrow(
      "Review",
    );
    expect(() => libraryFolderStorageChange(copy, projectId, preview, false, "old-review")).toThrow(
      "Review",
    );
    expect(() =>
      libraryFolderStorageChange(copy, projectId, preview, true, preview.reviewToken),
    ).toThrow("Review");
    expect(
      libraryFolderStorageChange(copy, projectId, preview, false, preview.reviewToken),
    ).toEqual({
      kind: "adopt",
      input: { projectId, reviewToken: preview.reviewToken, retention: "release-on-settle" },
    });
  });
  it("rejects another root, another project, missing review tokens, and blocked previews", () => {
    for (const changed of [
      { ...preview, workspaceRoot: `${copy.rootPath}/app` },
      { ...preview, projectId: ProjectId.make("other") },
      { ...preview, reviewToken: null },
      { ...preview, state: "blocked" as const },
    ])
      expect(() =>
        libraryFolderStorageChange(copy, projectId, changed, false, changed.reviewToken),
      ).toThrow();
  });
  it("changes adopted retention directly and restores released folders with keep", () => {
    const adopted = { ...preview, state: "managed" as const, ownershipSource: "adopted" as const };
    expect(libraryFolderStorageChange(copy, projectId, adopted, false, null)).toMatchObject({
      kind: "retention",
      input: { retention: "release-on-settle" },
    });
    expect(
      libraryFolderStorageChange(copy, projectId, { ...adopted, state: "released" }, true, null),
    ).toMatchObject({
      kind: "retention",
      input: { retention: "keep" },
    });
  });
});
