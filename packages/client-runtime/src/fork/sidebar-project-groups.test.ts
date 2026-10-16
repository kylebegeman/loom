import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";
import { createLibrarySidebarProjectKey } from "./library-sidebar-projects.ts";
import {
  groupSidebarThreadsByProject,
  sidebarProjectsByLocalProject,
  type SidebarThreadProject,
  type SidebarThreadsByProject,
} from "./sidebar-project-groups.ts";

interface Thread {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly rank?: number;
}

const thread = (environmentId: string, projectId: string, id: string, rank = 1): Thread => ({
  environmentId,
  projectId,
  id,
  rank,
});

const project = (id: string, title: string): LibraryProject => ({
  id,
  title,
  brief: "",
  revision: 1,
  archived: false,
  resources: [],
  createdAt: "2026-10-15T12:00:00Z",
  updatedAt: "2026-10-15T12:00:00Z",
});

const copy = (
  projectId: string,
  environmentId: string,
  rootLocalProjectId: string,
  patch: Partial<LibraryWorkingCopy> = {},
): LibraryWorkingCopy => ({
  id: `${projectId}:${environmentId}`,
  projectId,
  projectRevision: 1,
  environmentId: EnvironmentId.make(environmentId),
  rootPath: `/work/${projectId}`,
  rootLocalProjectId: ProjectId.make(rootLocalProjectId),
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  ...patch,
});

const registered = (
  projectId: string,
  environmentId: string,
  threadId: string,
  localProjectId: string,
): LibraryThreadSummary => ({
  id: `${environmentId}:${threadId}`,
  projectId,
  localProjectId: ProjectId.make(localProjectId),
  environmentId: EnvironmentId.make(environmentId),
  threadId: ThreadId.make(threadId),
  resourceIds: [],
  workingCopyId: null,
  title: "Saved work",
  status: "idle",
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  syncedAt: "2026-10-15T12:00:00.000Z",
  sequence: 1,
});

// Upstream's logical grouping: one repository on two computers is one group.
const localGroups = sidebarProjectsByLocalProject([
  {
    projectKey: "github.com/acme/web",
    displayName: "web",
    memberProjectRefs: [
      { environmentId: "laptop", projectId: "web-laptop" },
      { environmentId: "studio", projectId: "web-studio" },
    ],
  },
  {
    projectKey: "laptop:/scratch/notes",
    displayName: "notes",
    memberProjectRefs: [{ environmentId: "laptop", projectId: "notes" }],
  },
]);

const ids = (threads: ReadonlyArray<Thread>) => threads.map((entry) => entry.id);
const summary = <T extends SidebarThreadProject>(grouped: SidebarThreadsByProject<T, Thread>) => ({
  groups: grouped.groups.map((group) => [group.project.key, ids(group.threads)]),
  unclaimed: ids(grouped.unclaimed),
});

describe("groupSidebarThreadsByProject", () => {
  const library = {
    projects: [project("site", "Marketing site"), project("app", "App")],
    threads: [] as LibraryThreadSummary[],
    copies: [
      copy("site", "laptop", "web-laptop"),
      copy("site", "studio", "web-studio"),
      // A released copy no longer claims its folder.
      copy("app", "laptop", "old", { state: "released" }),
    ],
  };

  it.each([
    {
      name: "a Library project holds its copies on every computer under one group",
      library,
      threads: [
        thread("laptop", "web-laptop", "a"),
        thread("studio", "web-studio", "b"),
        thread("laptop", "notes", "c"),
      ],
      expected: {
        groups: [["library:site", ["a", "b"]]],
        unclaimed: ["c"],
      },
    },
    {
      name: "a thread registered in a project joins it even when two projects share its folder",
      library: {
        ...library,
        threads: [registered("app", "laptop", "registered", "web-laptop")],
      },
      threads: [
        thread("laptop", "web-laptop", "registered"),
        thread("laptop", "web-laptop", "other"),
      ],
      expected: {
        groups: [["library:app", ["registered"]]],
        unclaimed: ["other"],
      },
    },
    {
      name: "a registration claims its folder for the project's other threads",
      library: { ...library, threads: [registered("app", "laptop", "registered", "notes")] },
      threads: [thread("laptop", "notes", "other"), thread("studio", "web-studio", "b")],
      expected: {
        groups: [
          ["library:app", ["other"]],
          ["library:site", ["b"]],
        ],
        unclaimed: [],
      },
    },
    {
      name: "folders outside every project only appear under Not in a project",
      library,
      threads: [
        thread("laptop", "old", "released-copy"),
        thread("laptop", "unknown", "unknown-folder"),
        thread("desk", "web-laptop", "same-id-other-computer"),
      ],
      expected: {
        groups: [],
        unclaimed: ["released-copy", "unknown-folder", "same-id-other-computer"],
      },
    },
    {
      name: "a folder two projects claim is not guessed into either",
      library: { ...library, copies: [...library.copies, copy("app", "laptop", "web-laptop")] },
      threads: [thread("laptop", "web-laptop", "shared"), thread("studio", "web-studio", "b")],
      expected: {
        groups: [["library:site", ["b"]]],
        unclaimed: ["shared"],
      },
    },
    {
      name: "without a Library, upstream's logical grouping applies",
      library: null,
      threads: [
        thread("laptop", "web-laptop", "a"),
        thread("laptop", "notes", "b"),
        thread("studio", "web-studio", "c"),
        thread("studio", "removed", "d"),
      ],
      expected: {
        groups: [
          ["laptop:/scratch/notes", ["b"]],
          ["github.com/acme/web", ["a", "c"]],
        ],
        unclaimed: ["d"],
      },
    },
  ])("$name", ({ library: source, threads, expected }) => {
    const keyOf = createLibrarySidebarProjectKey({ library: source, local: localGroups });
    expect(summary(groupSidebarThreadsByProject(threads, keyOf))).toEqual(expected);
  });

  it("orders groups by title and threads by rank, keeping input order within a rank", () => {
    const keyOf = (entry: Thread) => ({ key: entry.projectId, title: entry.projectId });
    const grouped = groupSidebarThreadsByProject(
      [
        thread("e", "beta", "b-settled", 3),
        thread("e", "Alpha 10", "a10", 1),
        thread("e", "beta", "b-ready", 1),
        thread("e", "alpha 2", "a2", 1),
        thread("e", "beta", "b-working", 0),
        thread("e", "beta", "b-ready-later", 1),
      ],
      keyOf,
      { rankOf: (entry) => entry.rank ?? 1 },
    );
    expect(summary(grouped)).toEqual({
      groups: [
        // Natural, case-insensitive order: "alpha 2" before "Alpha 10".
        ["alpha 2", ["a2"]],
        ["Alpha 10", ["a10"]],
        ["beta", ["b-working", "b-ready", "b-ready-later", "b-settled"]],
      ],
      unclaimed: [],
    });
  });

  it("groups 600 threads across 40 projects well within a frame", () => {
    const threads = Array.from({ length: 600 }, (_, index) =>
      thread(index % 2 ? "laptop" : "studio", `folder-${index % 50}`, `thread-${index}`, index % 4),
    );
    const projects = Array.from({ length: 40 }, (_, index) => project(`p${index}`, `P ${index}`));
    const copies = Array.from({ length: 40 }, (_, index) => [
      copy(`p${index}`, "laptop", `folder-${index}`),
      copy(`p${index}`, "studio", `folder-${index}`),
    ]).flat();
    const index = Array.from({ length: 200 }, (_, entry) =>
      registered(`p${entry % 40}`, "laptop", `thread-${entry * 3}`, `folder-${entry % 50}`),
    );
    const run = () =>
      groupSidebarThreadsByProject(
        threads,
        createLibrarySidebarProjectKey({
          library: { projects, threads: index, copies },
          local: localGroups,
        }),
        { rankOf: (entry) => entry.rank ?? 1 },
      );
    run();
    const runs = 20;
    const started = performance.now();
    for (let attempt = 0; attempt < runs; attempt++) run();
    const perRun = (performance.now() - started) / runs;
    const grouped = run();
    expect(grouped.groups).toHaveLength(40);
    expect(grouped.groups.reduce((total, group) => total + group.threads.length, 0)).toBe(
      600 - grouped.unclaimed.length,
    );
    // Measured at about 0.4 ms on an M-series laptop; the ceiling is one 60 Hz frame for slow CI.
    expect(perRun).toBeLessThan(16);
  });
});
