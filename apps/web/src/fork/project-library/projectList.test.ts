import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { filterProjectEntries, projectEntries, sortProjectEntries } from "./projectList";

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

  it("leaves the count unknown while the index is partial, and falls back to the last edit", () => {
    const [entry] = projectEntries([iris], [], { nextOffset: 100, threads: [] });
    expect(entry).toMatchObject({ conversations: null, activeAt: iris.updatedAt });
  });
});

describe("filterProjectEntries", () => {
  const entries = projectEntries([loom, iris, old], copies, undefined);
  const label = (id: EnvironmentId) => (id === nora ? "Nora" : "Dorothy");
  const titles = (filter: Partial<Parameters<typeof filterProjectEntries>[1]>) =>
    filterProjectEntries(
      entries,
      { archived: false, search: "", colors: new Set(), computer: null, ...filter },
      label,
    ).map((entry) => entry.project.title);

  it("finds a project by its folder or the computer it lives on", () => {
    expect(titles({ search: "work/loom" })).toEqual(["Loom"]);
    expect(titles({ search: "dorothy" })).toEqual(["iris"]);
  });

  it("narrows by color, computer and archive state together", () => {
    expect(titles({ colors: new Set(["plum"]) })).toEqual(["iris"]);
    expect(titles({ colors: new Set(["plum"]), archived: true })).toEqual(["Archive me"]);
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
