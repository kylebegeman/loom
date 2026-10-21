import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import {
  libraryLaunchCopyMatchesScope,
  libraryLaunchCopiesForScope,
  libraryFreshRootPath,
  libraryLaunchPathOverlaps,
  restoreLibraryLaunchCopy,
} from "./libraryLaunchFiles";

const host = EnvironmentId.make("computer");
const repository = (id: string, relativePath = id) => ({
  id,
  title: id,
  relativePath,
  kind: "repository" as const,
  remoteUrl: `https://github.com/team/${id}`,
  defaultBranch: null,
});
const project: LibraryProject = {
  id: "project",
  title: "Example",
  brief: "",
  revision: 2,
  archived: false,
  resources: [repository("app"), repository("docs")],
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: project.id,
  projectRevision: 1,
  environmentId: host,
  rootPath: "/Projects/example",
  ownership: "managed",
  state: "released",
  repositories: project.resources.map((resource) => ({
    resourceId: resource.id,
    path: `/Projects/example/${resource.relativePath}`,
    localProjectId: ProjectId.make(resource.id),
    head: null,
    branch: null,
  })),
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};

describe("mobile launch file safety", () => {
  it("restores compatible older revisions and requires the whole current layout for whole-project work", () => {
    expect(libraryLaunchCopyMatchesScope(project, copy, null)).toBe(true);
    expect(
      libraryLaunchCopyMatchesScope({ ...project, resources: [repository("app")] }, copy, null),
    ).toBe(false);
    expect(
      libraryLaunchCopyMatchesScope(
        { ...project, resources: [repository("app"), repository("docs", "moved")] },
        copy,
        null,
      ),
    ).toBe(false);
    expect(
      libraryLaunchCopyMatchesScope(
        { ...project, resources: [repository("app"), repository("docs", "moved")] },
        copy,
        "app",
      ),
    ).toBe(true);
    expect(libraryLaunchCopyMatchesScope(project, { ...copy, registered: false }, null)).toBe(
      false,
    );
  });
  it("offers released managed files for restoration without reviving missing or external folders", () => {
    const copies = [
      copy,
      { ...copy, id: "external", ownership: "borrowed" as const },
      { ...copy, id: "missing", state: "missing" as const },
      { ...copy, id: "unregistered", registered: false },
      { ...copy, id: "other", environmentId: EnvironmentId.make("other") },
    ];
    expect(libraryLaunchCopiesForScope(project, copies, host, null, true)).toEqual([copy]);
    expect(libraryLaunchCopiesForScope(project, copies, host, null, false)).toEqual([]);
    const moved = { ...project, resources: [repository("app"), repository("docs", "new-docs")] };
    expect(libraryLaunchCopiesForScope(moved, copies, host, null, true)).toEqual([]);
    expect(libraryLaunchCopiesForScope(moved, copies, host, "app", true)).toEqual([copy]);
  });
  it("reopens verified released files at the same root after their local registration was removed", () => {
    const released = {
      ...copy,
      registered: false,
      recovery: {
        sha256: "a".repeat(64),
        byteLength: 2048,
        archiveKey: "saved-files",
        verifiedAt: project.updatedAt,
      },
    };
    expect(libraryLaunchCopyMatchesScope(project, released, null)).toBe(true);
    expect(libraryLaunchCopiesForScope(project, [released], host, null, true)).toEqual([released]);
    expect(libraryLaunchCopiesForScope(project, [released], host, null, false)).toEqual([]);
    expect(libraryLaunchCopyMatchesScope(project, { ...released, state: "ready" }, null)).toBe(
      false,
    );
    expect(
      libraryLaunchCopyMatchesScope({ ...project, resources: [repository("app")] }, released, null),
    ).toBe(false);
    expect(
      libraryLaunchCopyMatchesScope(
        { ...project, resources: [repository("app")] },
        released,
        "app",
      ),
    ).toBe(true);
  });

  it("chooses a versioned fresh folder when the old folder is already recorded", () => {
    expect(libraryFreshRootPath(project, [copy], host, "/Projects")).toBe("/Projects/example-v2");
    expect(
      libraryFreshRootPath(
        project,
        [copy, { ...copy, rootPath: "/Projects/example-v2" }],
        host,
        "/Projects",
      ),
    ).toBe("/Projects/example-v2-2");
    expect(libraryFreshRootPath(project, [copy], host, undefined)).toBe("/Projects/example-v2");
    expect(libraryFreshRootPath(project, [copy], EnvironmentId.make("other"), "/Projects")).toBe(
      "/Projects/example",
    );
  });
  it("avoids enclosing workspaces and treats Windows roots consistently", () => {
    expect(libraryFreshRootPath(project, [copy], host, "/Projects/example/work")).toBe(
      "/Projects/example-v2",
    );
    expect(libraryLaunchPathOverlaps("C:\\Projects\\Example", "c:/projects/example/app")).toBe(
      true,
    );
    expect(libraryLaunchPathOverlaps("/Projects/example", "/Projects/example-v2")).toBe(false);
  });
  it("does not search forever for a sibling of a filesystem root", () => {
    for (const rootPath of ["/", "C:\\"])
      expect(libraryFreshRootPath(project, [{ ...copy, rootPath }], host, undefined)).toBe("");
  });
  it("reopens saved files with a stable request and rejects a changed destination", async () => {
    const restored = { ...copy, state: "ready" as const };
    const calls: unknown[] = [];
    const reopen = async (input: unknown) => {
      calls.push(input);
      return restored;
    };
    await expect(restoreLibraryLaunchCopy(copy, "request:reopen", reopen)).resolves.toBe(restored);
    expect(calls).toEqual([
      { environmentId: host, input: { requestId: "request:reopen", workingCopyId: copy.id } },
    ]);
    for (const wrong of [
      { ...restored, rootPath: "/other" },
      { ...restored, environmentId: EnvironmentId.make("other") },
      { ...restored, id: "other" },
      { ...restored, state: "released" as const },
      { ...restored, projectId: "other" },
    ]) {
      await expect(
        restoreLibraryLaunchCopy(copy, "request:reopen", async () => wrong),
      ).rejects.toThrow("saved project files");
    }
  });
});
