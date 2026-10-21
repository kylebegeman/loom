import { describe, expect, it } from "vite-plus/test";
import type { LibraryFolderInspection, LibraryProject } from "@t3tools/contracts/fork";
import { folderProjectMatches } from "./folderProjectMatches";

const project = (
  id: string,
  remote = "https://github.com/owner/app.git",
  relativePath = ".",
): LibraryProject => ({
  id,
  title: "App",
  brief: "",
  revision: 1,
  archived: false,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  resources: [
    {
      id: "repo",
      kind: "repository",
      title: "App",
      remoteUrl: remote,
      relativePath,
      defaultBranch: "main",
    },
  ],
});
const inspection: LibraryFolderInspection = {
  rootPath: "/work/app",
  exists: true,
  repositories: [
    {
      path: "/work/app",
      relativePath: ".",
      remoteUrl: "git@github.com:owner/app.git",
      branch: "main",
      head: "abc123",
    },
  ],
};

describe("folderProjectMatches", () => {
  it("recognizes the same origin across SSH and HTTPS while preserving fork identity", () => {
    expect(
      folderProjectMatches(
        [project("same"), project("fork", "https://github.com/another/app.git")],
        inspection,
      ).map((p) => p.id),
    ).toEqual(["same"]);
  });
  it("requires the complete matching layout, not just a name or one shared repository", () => {
    expect(
      folderProjectMatches(
        [project("different-layout", undefined, "app"), { ...project("empty"), resources: [] }],
        inspection,
      ),
    ).toEqual([]);
    const extra = {
      ...inspection,
      repositories: [
        ...inspection.repositories,
        { ...inspection.repositories[0]!, path: "/work/app/other", relativePath: "other" },
      ],
    };
    expect(folderProjectMatches([project("partial")], extra)).toEqual([]);
  });
  it("keeps ambiguous matches for an explicit choice", () => {
    expect(
      folderProjectMatches([project("one"), project("two")], inspection).map((p) => p.id),
    ).toEqual(["one", "two"]);
  });
  it("never matches folder-only projects without repository evidence", () => {
    expect(
      folderProjectMatches([{ ...project("empty"), resources: [] }], {
        ...inspection,
        repositories: [],
      }),
    ).toEqual([]);
  });
});
