import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  libraryStartIntent,
  libraryStartFolderProjects,
  libraryStartRepositoryProjects,
  rankLibraryStartProjects,
} from "./library-start-intent.ts";
import { libraryProjectAttention } from "./library-attention.ts";

const now = "2026-10-23T12:00:00.000Z";
const project = (id: string): LibraryProject => ({
  id,
  title: id,
  brief: "",
  revision: 1,
  archived: false,
  createdAt: now,
  updatedAt: now,
  resources: [],
});
const thread = (
  id: string,
  status: LibraryThreadSummary["status"] = "ready",
): LibraryThreadSummary => ({
  id,
  threadId: ThreadId.make(id),
  environmentId: EnvironmentId.make("computer"),
  localProjectId: ProjectId.make("local"),
  projectId: id,
  workingCopyId: null,
  resourceIds: [],
  title: id,
  status,
  archived: false,
  sequence: 1,
  createdAt: now,
  updatedAt: now,
  syncedAt: now,
});
const copy = (id: string): LibraryWorkingCopy => ({
  id,
  projectId: "project",
  projectRevision: 1,
  environmentId: EnvironmentId.make("computer"),
  rootPath: `/work/${id}`,
  ownership: "managed",
  state: "ready",
  repositories: [],
  createdAt: now,
  updatedAt: now,
});

describe("Start intent", () => {
  it.each([
    "/Users/kyle/Aspect Avy",
    "~/Developer/Embrace",
    "C:\\Projects\\App",
    "\\\\server\\share\\App",
  ])("recognizes folder %s without interpreting it as a repository", (path) => {
    expect(libraryStartIntent(path)).toMatchObject({ kind: "folder", path });
  });
  it("accepts repository URLs and SSH aliases, leaving names and reference pages searchable", () => {
    expect(libraryStartIntent("github.com/team/app")).toMatchObject({
      kind: "repository",
      title: "app",
    });
    expect(libraryStartIntent("git@github.com:team/app.git")).toMatchObject({
      kind: "repository",
      title: "app",
    });
    expect(libraryStartIntent("https://github.com/team/app/issues/3").kind).toBe("search");
    expect(libraryStartIntent("AspectAvy")).toEqual({ kind: "search", text: "AspectAvy" });
  });
  it("offers all existing repository associations across transport variants without choosing an ambiguous project", () => {
    const associated = {
      ...project("AspectAvy"),
      resources: [
        {
          id: "app",
          title: "App",
          relativePath: "app",
          remoteUrl: "git@github.com:team/app.git",
          defaultBranch: null,
        },
      ],
    };
    expect(
      libraryStartRepositoryProjects(
        [
          associated,
          { ...associated, id: "another" },
          { ...associated, archived: true, id: "archived" },
          project("app"),
        ],
        "https://github.com/team/app",
      ).map((entry) => entry.id),
    ).toEqual(["AspectAvy", "another"]);
  });
  it("ranks recent active conversations first, ignoring deleted history and archived projects", () => {
    expect(
      rankLibraryStartProjects(
        [project("A"), project("B"), { ...project("C"), archived: true }],
        [thread("B"), { ...thread("A"), deleted: true, updatedAt: "2026-10-24T00:00:00.000Z" }],
      ).map((entry) => entry.id),
    ).toEqual(["B", "A"]);
  });
});

describe("project attention", () => {
  it("ranks decisions and failures before file issues, running work and a recent conversation", () => {
    const dirty = {
      ...copy("dirty"),
      health: {
        copyId: "dirty",
        environmentId: EnvironmentId.make("computer"),
        checkedAt: now,
        repositories: [
          {
            resourceId: "app",
            uncommittedFiles: 2,
            unpushedCommits: 1,
            fetchedAt: now,
            checkedAt: now,
          },
        ],
      },
    };
    const result = libraryProjectAttention(
      [
        thread("running", "running"),
        thread("ready"),
        thread("waiting", "waiting"),
        thread("failed", "failed"),
        { ...thread("settled", "failed"), settled: true },
      ],
      [copy("unknown"), dirty, { ...copy("removed"), state: "released" }],
    );
    expect(result.map((entry) => entry.id)).toEqual([
      "waiting",
      "failed",
      "dirty",
      "running",
      "unknown",
      "ready",
    ]);
    expect(result.find((entry) => entry.id === "dirty")?.detail).toBe(
      "2 changed files; 1 local commits",
    );
    expect(result.find((entry) => entry.id === "unknown")?.detail).toContain("not been checked");
    expect(result.every((entry) => entry.checkedAt === now)).toBe(true);
  });
});

describe("existing Start folder associations", () => {
  it("matches non-Git folders only on their recorded computer, keeping all genuine choices", () => {
    const projects = [
      project("first"),
      project("second"),
      { ...project("archived"), archived: true },
    ];
    const copies = projects.map((entry) => ({
      ...copy(entry.id),
      projectId: entry.id,
      rootPath: "/work/app/",
    }));
    expect(
      libraryStartFolderProjects(projects, copies, "computer", "/work/app").map(
        (entry) => entry.id,
      ),
    ).toEqual(["first", "second"]);
    expect(libraryStartFolderProjects(projects, copies, "other", "/work/app")).toEqual([]);
    expect(
      libraryStartFolderProjects(
        projects,
        copies.map((entry) => ({ ...entry, registered: false })),
        "computer",
        "/work/app",
      ),
    ).toEqual([]);
    expect(
      libraryStartFolderProjects(
        projects,
        copies.map((entry) => ({ ...entry, state: "released" })),
        "computer",
        "/work/app",
      ),
    ).toEqual([]);
    expect(libraryStartFolderProjects(projects, copies, "computer", "/work/application")).toEqual(
      [],
    );
  });
});
