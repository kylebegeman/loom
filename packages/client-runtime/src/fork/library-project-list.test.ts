import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import {
  filterProjectEntries,
  libraryLocalProjectIcon,
  isRestingEntry,
  localProjectsByRef,
  projectEntries,
  projectSections,
  RESTING_AFTER_MS,
  sortProjectEntries,
  type LocalProjectIcon,
} from "./library-project-list.ts";

const dorothy = EnvironmentId.make("dorothy");
const nora = EnvironmentId.make("nora");
const project = (patch: Partial<LibraryProject>): LibraryProject => ({
  id: "project",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...patch,
});
const copy = (patch: Partial<LibraryWorkingCopy>): LibraryWorkingCopy => ({
  id: "copy",
  projectId: "project",
  projectRevision: 1,
  environmentId: dorothy,
  rootPath: "/Users/kyle/Developer/project",
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...patch,
});
const thread = (patch: Partial<LibraryThreadSummary>): LibraryThreadSummary => ({
  id: "summary",
  projectId: "project",
  environmentId: dorothy,
  threadId: ThreadId.make("thread"),
  localProjectId: ProjectId.make("local"),
  workingCopyId: null,
  resourceIds: [],
  title: "Thread",
  status: "idle",
  archived: false,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  syncedAt: "2026-10-01T00:00:00.000Z",
  sequence: 0,
  ...patch,
});

const loom = project({ id: "loom", title: "Loom", color: "teal" });
const iris = project({
  id: "iris",
  title: "iris",
  brief: "Design system",
  color: "plum",
  createdAt: "2026-10-05T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
});
const old = project({ id: "old", title: "Archive me", archived: true, color: "plum" });
const copies = [
  copy({ id: "c1", projectId: "loom", environmentId: nora, rootPath: "/Users/kyle/work/loom" }),
  copy({ id: "c2", projectId: "iris" }),
];

describe("projectEntries", () => {
  it("counts live conversations and treats the newest one as the project's activity", () => {
    const [entry] = projectEntries([loom], [], {
      nextOffset: null,
      threads: [
        thread({ id: "a", projectId: "loom", updatedAt: "2026-10-12T00:00:00.000Z" }),
        thread({ id: "b", projectId: "loom", updatedAt: "2026-10-09T00:00:00.000Z" }),
        thread({
          id: "c",
          projectId: "loom",
          updatedAt: "2026-10-14T00:00:00.000Z",
          deleted: true,
        }),
        thread({ id: "d", projectId: "loom", archived: true }),
      ],
    });
    expect(entry).toMatchObject({ conversations: 2, activeAt: "2026-10-12T00:00:00.000Z" });
  });

  it("counts open conversations that are waiting, failed or working per project", () => {
    const [entry, other] = projectEntries([loom, iris], [], {
      nextOffset: null,
      threads: [
        thread({ id: "a", projectId: "loom", status: "waiting" }),
        thread({ id: "b", projectId: "loom", status: "running" }),
        thread({ id: "c", projectId: "loom", status: "failed", settled: true }),
        thread({ id: "d", projectId: "loom", status: "waiting", archived: true }),
        thread({ id: "e", projectId: "iris", status: "ready" }),
      ],
    });
    expect(entry?.attention).toEqual({ waiting: 1, failed: 0, working: 1 });
    expect(other?.attention).toEqual({ waiting: 0, failed: 0, working: 0 });
  });

  it("does not classify a project as resting from an incomplete legacy index", () => {
    const [entry] = projectEntries([iris], [], { nextOffset: 100, threads: [] });
    expect(entry).toMatchObject({ conversations: null, activeAt: iris.updatedAt });
    expect(isRestingEntry(entry!, Date.parse("2026-10-23T00:00:00.000Z"))).toBe(false);
  });

  it("uses whole-library activity when the recent page contains only another project's work", () => {
    const [entry, quiet] = projectEntries([iris, loom], [], {
      nextOffset: 100,
      threads: [thread({ projectId: "busy", updatedAt: "2026-10-22T00:00:00.000Z" })],
      projectActivity: [
        { projectId: "iris", conversations: 23, latestAt: "2026-10-20T15:29:46.828Z" },
      ],
    });
    expect(entry).toMatchObject({ conversations: 23, activeAt: "2026-10-20T15:29:46.828Z" });
    expect(isRestingEntry(entry!, Date.parse("2026-10-23T00:00:00.000Z"))).toBe(false);
    expect(quiet).toMatchObject({ conversations: 0, activeAt: loom.updatedAt });
    expect(isRestingEntry(quiet!, Date.parse("2026-10-23T00:00:00.000Z"))).toBe(true);
  });

  it("keeps a newer project edit active even when its last conversation is older", () => {
    const [entry] = projectEntries([iris], [], {
      nextOffset: 100,
      threads: [],
      projectActivity: [{ projectId: "iris", conversations: 2, latestAt: loom.updatedAt }],
    });
    expect(entry).toMatchObject({ conversations: 2, activeAt: iris.updatedAt });
  });
});

describe("libraryLocalProjectIcon", () => {
  const local = (
    patch: Partial<LocalProjectIcon> & Pick<LocalProjectIcon, "id">,
  ): LocalProjectIcon => ({
    environmentId: dorothy,
    workspaceRoot: "/Users/kyle/Developer/project",
    title: "Project",
    faviconPath: null,
    projectIcon: null,
    ...patch,
  });
  const root = local({ id: ProjectId.make("root") });
  const repo = local({ id: ProjectId.make("repo") });
  const elsewhere = local({ id: ProjectId.make("root"), environmentId: nora });
  const repository = {
    resourceId: "r",
    path: "app",
    localProjectId: ProjectId.make("repo"),
    head: null,
    branch: null,
  };

  it("uses the folder a copy points at on that copy's computer", () => {
    const shared = copy({ rootLocalProjectId: ProjectId.make("root"), repositories: [repository] });
    expect(libraryLocalProjectIcon([shared], localProjectsByRef([elsewhere, repo, root]))).toBe(
      root,
    );
    expect(libraryLocalProjectIcon([copy({})], localProjectsByRef([root]))).toBeNull();
  });

  it("prefers a folder someone chose an icon for", () => {
    const chosen = local({
      id: ProjectId.make("repo"),
      projectIcon: { kind: "emoji", emoji: "🧵" },
    });
    const shared = copy({ rootLocalProjectId: ProjectId.make("root"), repositories: [repository] });
    expect(libraryLocalProjectIcon([shared], localProjectsByRef([root, chosen]))).toBe(chosen);
  });
});

describe("filterProjectEntries", () => {
  const entries = projectEntries([loom, iris, old], copies, undefined);
  const label = (id: EnvironmentId) => (id === nora ? "Nora" : "Dorothy");
  const titles = (filter: Partial<Parameters<typeof filterProjectEntries>[1]>) =>
    filterProjectEntries(
      entries,
      { search: "", colors: new Set(), computer: null, ...filter },
      label,
    ).map((entry) => entry.project.title);

  it("finds a project by its folder or the computer it lives on", () => {
    expect(titles({ search: "work/loom" })).toEqual(["Loom"]);
    expect(titles({ search: "dorothy" })).toEqual(["iris"]);
  });

  it("narrows by color and computer together, leaving archive state to the sections", () => {
    expect(titles({ colors: new Set(["plum"]) })).toEqual(["iris", "Archive me"]);
    expect(titles({ colors: new Set(["plum"]), computer: dorothy })).toEqual(["iris"]);
    expect(titles({ computer: nora })).toEqual(["Loom"]);
  });
});

describe("sortProjectEntries", () => {
  const entries = projectEntries([loom, iris], [], undefined);
  it("orders by name without regard to case, and by activity or creation newest first", () => {
    expect(sortProjectEntries(entries, "name").map((e) => e.project.title)).toEqual([
      "iris",
      "Loom",
    ]);
    expect(sortProjectEntries(entries, "activity").map((e) => e.project.id)).toEqual([
      "iris",
      "loom",
    ]);
    expect(sortProjectEntries(entries, "created").map((e) => e.project.id)).toEqual([
      "iris",
      "loom",
    ]);
  });
});

describe("projectSections", () => {
  const now = Date.parse("2026-10-19T00:00:00.000Z");
  const entries = projectEntries([loom, iris], [], { threads: [], nextOffset: null });
  const kinds = (group: Parameters<typeof projectSections>[1], at = now) =>
    projectSections(entries, group, at).map((section) => [
      section.kind === "color" ? section.color : section.kind,
      section.entries.map((entry) => entry.project.id),
    ]);

  it("lets a project rest after two quiet weeks and keeps the order it was given", () => {
    expect(kinds("activity")).toEqual([
      ["active", ["iris"]],
      ["resting", ["loom"]],
    ]);
    expect(kinds("activity", Date.parse(loom.updatedAt) + RESTING_AFTER_MS - 1)).toEqual([
      ["active", ["loom", "iris"]],
    ]);
  });

  it("groups by color in palette order and leaves out empty groups", () => {
    expect(kinds("color")).toEqual([
      ["plum", ["iris"]],
      ["teal", ["loom"]],
    ]);
    expect(kinds("none")).toEqual([["all", ["loom", "iris"]]]);
  });
});
