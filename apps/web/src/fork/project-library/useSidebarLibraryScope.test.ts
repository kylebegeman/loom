import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";

vi.mock("./state", () => ({}));
vi.mock("~/state/query", () => ({}));
import {
  libraryScopeLocalProjectKeys,
  librarySidebarGroupProjects,
} from "./useSidebarLibraryScope";

const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("host"),
  rootPath: "/project",
  rootLocalProjectId: ProjectId.make("root"),
  repositories: [
    {
      resourceId: "web",
      path: "/project/web",
      localProjectId: ProjectId.make("web"),
      head: null,
      branch: null,
    },
    {
      resourceId: "mobile",
      path: "/project/mobile",
      localProjectId: ProjectId.make("mobile"),
      head: null,
      branch: null,
    },
  ],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const saved = (resourceIds: readonly string[], localProjectId: string): LibraryThreadSummary =>
  ({
    projectId: "project",
    environmentId: "host",
    localProjectId,
    resourceIds,
  }) as LibraryThreadSummary;

describe("project sidebar identities", () => {
  it("keeps old local conversations visible immediately after a folder is attached", () => {
    expect([
      ...libraryScopeLocalProjectKeys({ projectId: "project", resourceId: null }, [], [copy])!,
    ]).toEqual(["host:root", "host:web", "host:mobile"]);
  });
  it("keeps component scope restricted to saved conversations with exactly that scope", () => {
    const threads = [
      saved([], "root"),
      saved(["web"], "web"),
      saved(["mobile"], "mobile"),
      saved(["web", "mobile"], "both"),
    ];
    expect([
      ...libraryScopeLocalProjectKeys({ projectId: "project", resourceId: "web" }, threads, [
        copy,
      ])!,
    ]).toEqual(["host:web"]);
  });
  it("ignores removed, unregistered and unrelated folders and unrelated saved summaries", () => {
    expect([
      ...libraryScopeLocalProjectKeys(
        { projectId: "project", resourceId: null },
        [{ ...saved([], "foreign"), projectId: "other" }],
        [
          { ...copy, state: "released" },
          { ...copy, registered: false },
          { ...copy, projectId: "other" },
        ],
      )!,
    ]).toEqual([]);
    expect(libraryScopeLocalProjectKeys(null, [], [copy])).toBeNull();
  });
});

const libraryProject = (id: string, archived = false): LibraryProject => ({
  id,
  title: id,
  brief: "",
  revision: 1,
  resources: [],
  archived,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
});

describe("sidebar folder groups", () => {
  const rootRef = [{ environmentId: "host", projectId: "root" }];
  it("shows a folder held only by an archived project as a plain local folder", () => {
    const projects = [libraryProject("project", true)];
    expect(librarySidebarGroupProjects(projects, [], [copy])(rootRef)).toBeNull();
    expect(librarySidebarGroupProjects(projects, [saved([], "root")], [])(rootRef)).toBeNull();
  });
  it("files a folder under its live project even when an archived project also held it", () => {
    const projects = [libraryProject("project"), libraryProject("old", true)];
    const groups = librarySidebarGroupProjects(
      projects,
      [{ ...saved([], "root"), projectId: "old" }],
      [copy, { ...copy, id: "old-files", projectId: "old" }],
    );
    expect(groups(rootRef)).toBe("project");
  });
  it("ignores a holder the catalog does not list", () => {
    expect(librarySidebarGroupProjects([], [], [copy])(rootRef)).toBeNull();
  });
});
