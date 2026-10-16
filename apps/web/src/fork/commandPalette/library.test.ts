import type {
  LibraryProject,
  LibraryThreadIndex,
  LibraryThreadSummary,
} from "@t3tools/contracts/fork";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  filterCommandPaletteGroups,
  type CommandPaletteActionItem,
  type CommandPaletteSubmenuItem,
} from "~/components/CommandPalette.logic";
import { onLibraryAction, takeLibraryBriefEdit } from "../project-library/actions";
import { libraryPaletteSource, type LibraryPaletteContext } from "./library";

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
const summary = (patch: Partial<LibraryThreadSummary>): LibraryThreadSummary => ({
  id: "summary",
  projectId: "project",
  environmentId: EnvironmentId.make("dorothy"),
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

// Iris was edited last, but Loom had a conversation after that, so Loom leads.
const projects = [
  project({ id: "iris", title: "Iris", updatedAt: "2026-10-06T00:00:00.000Z" }),
  project({ id: "loom", title: "Loom", updatedAt: "2026-10-02T00:00:00.000Z" }),
  project({ id: "old", title: "Old notes", archived: true, updatedAt: "2026-10-09T00:00:00.000Z" }),
];
const threadIndex: LibraryThreadIndex = {
  threads: [summary({ projectId: "loom", updatedAt: "2026-10-08T00:00:00.000Z" })],
  nextOffset: null,
};
const openProject = vi.fn(async (_projectId: string) => {});
const library = (patch: Partial<LibraryPaletteContext> = {}): LibraryPaletteContext => ({
  projects,
  threadIndex,
  canStart: true,
  canEditBrief: true,
  threadProjectId: null,
  openProject,
  ...patch,
});
const items = (patch?: Partial<LibraryPaletteContext> | null) =>
  libraryPaletteSource.items({
    activeThreadRef: null,
    loomFeatures: [],
    library: patch === null ? null : library(patch),
  });
const submenu = (list: ReturnType<typeof items>, value: string) =>
  list.find(
    (item): item is CommandPaletteSubmenuItem => item.kind === "submenu" && item.value === value,
  );
const titles = (menu: CommandPaletteSubmenuItem | undefined) =>
  menu?.groups.flatMap((group) => group.items.map((item) => item.title));
const run = (item: CommandPaletteActionItem | CommandPaletteSubmenuItem | undefined) => {
  if (item?.kind !== "action") throw new Error("expected an action");
  return item.run();
};

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  openProject.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Library palette source", () => {
  it("lists live projects by most recent activity", () => {
    const list = items();
    for (const value of [
      "action:loom:library:go-to-project",
      "action:loom:library:new-conversation",
      "action:loom:library:project-brief",
    ])
      expect(titles(submenu(list, value))).toEqual(["Loom", "Iris"]);
  });

  it("opens the chosen project, its brief and its new conversation", async () => {
    const list = items();
    const first = (value: string) => submenu(list, value)?.groups[0]?.items[0];
    await run(first("action:loom:library:go-to-project"));
    expect(openProject).toHaveBeenLastCalledWith("loom");

    const requested: Array<[string, string | undefined]> = [];
    const stop = onLibraryAction((action, projectId) => requested.push([action, projectId]));
    await run(first("action:loom:library:new-conversation"));
    stop();
    expect(requested).toEqual([["new-conversation", "loom"]]);

    openProject.mockClear();
    await run(first("action:loom:library:project-brief"));
    expect(openProject).toHaveBeenLastCalledWith("loom");
    expect(takeLibraryBriefEdit("iris")).toBe(false);
    expect(takeLibraryBriefEdit("loom")).toBe(true);
    expect(takeLibraryBriefEdit("loom")).toBe(false);
  });

  it("shows nothing without a Library", () => {
    expect(items(null)).toEqual([]);
    expect(
      libraryPaletteSource.searchItems?.({
        activeThreadRef: null,
        loomFeatures: [],
        library: null,
      }),
    ).toEqual([]);
  });

  it("hides the project pickers when there is nothing to pick", () => {
    expect(items({ projects: [projects[2]!] })).toEqual([]);
  });

  it("hides actions the Library does not permit", () => {
    const values = items({ canStart: false, canEditBrief: false }).map((item) => item.value);
    expect(values).toEqual(["action:loom:library:go-to-project"]);
  });

  it("offers this thread's project only for a bound thread", async () => {
    expect(items().some((item) => item.value === "action:loom:library:thread-project")).toBe(false);
    const bound = items({ threadProjectId: "old" });
    const item = bound.find((entry) => entry.value === "action:loom:library:thread-project");
    await run(item);
    // An archived project still opens; it is where the thread lives.
    expect(openProject).toHaveBeenLastCalledWith("old");
  });

  it("finds a project from part of its name and opens it", async () => {
    const searchItems =
      libraryPaletteSource.searchItems?.({
        activeThreadRef: null,
        loomFeatures: [],
        library: library(),
      }) ?? [];
    const group = filterCommandPaletteGroups({
      activeGroups: [{ value: "actions", label: "Actions", items: items() }],
      query: "lo",
      isInSubmenu: false,
      projectSearchItems: searchItems,
      threadSearchItems: [],
    }).find((entry) => entry.value === "projects-search");
    expect(group?.items.map((item) => item.title)).toEqual(["Loom"]);
    await run(group?.items[0]);
    expect(openProject).toHaveBeenLastCalledWith("loom");
  });
});
