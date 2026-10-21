import type { LibraryFolderInspection, LibraryProject } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { libraryFolderResources, libraryProjectsForFolder } from "./libraryFolder";

const inspection: LibraryFolderInspection = {
  rootPath: "/Projects/Example",
  exists: true,
  repositories: [
    {
      path: "/Projects/Example/web",
      relativePath: "web",
      remoteUrl: "git@github.com:team/web.git",
      branch: "feature/current-work",
      head: "abc",
    },
  ],
};

describe("existing mobile project folders", () => {
  it("infers repository names and paths without turning a feature branch into a project default", () => {
    expect(libraryFolderResources(inspection)).toMatchObject({
      title: "Example",
      rootPath: "/Projects/Example",
      resources: [{ title: "web", relativePath: "web", defaultBranch: null }],
    });
  });

  it.each(["/Projects/web", "C:\\Projects\\web"])(
    "keeps the repository at its existing path under %s",
    (rootPath) => {
      const inferred = libraryFolderResources({
        rootPath,
        exists: true,
        repositories: [{ ...inspection.repositories[0]!, path: rootPath, relativePath: "." }],
      });
      expect(inferred.rootPath).toBe(rootPath);
      expect(inferred.resources[0]?.relativePath).toBe(".");
    },
  );

  it("suggests an existing project across equivalent SSH and HTTPS remotes", () => {
    const project: LibraryProject = {
      id: "existing",
      title: "Existing project",
      brief: "",
      revision: 1,
      archived: false,
      createdAt: "2026-10-21T00:00:00Z",
      updatedAt: "2026-10-21T00:00:00Z",
      resources: [
        {
          id: "web",
          title: "Web",
          kind: "repository",
          relativePath: "web",
          remoteUrl: "https://github.com/team/web",
          defaultBranch: null,
        },
      ],
    };
    expect(libraryProjectsForFolder(inspection, [project])).toEqual([project]);
    expect(
      libraryProjectsForFolder(
        { ...inspection, repositories: [{ ...inspection.repositories[0]!, remoteUrl: null }] },
        [project],
      ),
    ).toEqual([]);
  });

  it("rejects a disappeared folder and too many repositories instead of dropping files", () => {
    expect(() => libraryFolderResources({ ...inspection, exists: false })).toThrow(
      "no longer exists",
    );
    expect(() =>
      libraryFolderResources({
        ...inspection,
        repositories: Array.from({ length: 65 }, () => inspection.repositories[0]!),
      }),
    ).toThrow("64 repositories");
  });
});
