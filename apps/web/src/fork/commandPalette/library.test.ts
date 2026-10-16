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
import {
  dropLibraryBriefEdit,
  onLibraryAction,
  takeLibraryBriefEdit,
} from "../project-library/actions";
import {
  libraryPaletteBlocker,
  libraryPaletteSource,
  libraryShortcutAction,
  type LibraryPaletteContext,
} from "./library";

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
const openLibrary = vi.fn(async () => {});
const library = (patch: Partial<LibraryPaletteContext> = {}): LibraryPaletteContext => ({
  projects,
  threadIndex,
  canStart: true,
  canEditBrief: true,
  threadProjectId: null,
  openProject,
  blocker: null,
  openLibrary,
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
  openLibrary.mockClear();
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

  it("forgets a brief request once its project's page is left", async () => {
    const brief = submenu(items(), "action:loom:library:project-brief")?.groups[0]?.items[0];
    await run(brief);
    dropLibraryBriefEdit("iris");
    dropLibraryBriefEdit("loom");
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

  it("offers setup in place of the Library entries when none is connected", async () => {
    const list = items({ blocker: { kind: "setup" } });
    expect(list.map((item) => item.value)).toEqual(["action:loom:library:setup"]);
    await run(list[0]);
    expect(openLibrary).toHaveBeenCalledOnce();
  });

  it("explains an unusable Library with one disabled entry and no search results", () => {
    const blocked = { blocker: { kind: "unavailable", reason: "Update Loom" } } as const;
    const list = items(blocked);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ disabled: true, description: "Update Loom" });
    expect(
      libraryPaletteSource.searchItems?.({
        activeThreadRef: null,
        loomFeatures: [],
        library: library(blocked),
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

describe("Library blocker", () => {
  const ready = {
    authorityId: "library",
    isReady: true,
    phase: "connected",
    connected: true,
    supported: true,
    hasProjects: true,
  };

  it("asks for setup before anything else", () => {
    expect(libraryPaletteBlocker({ ...ready, authorityId: null, connected: false })).toEqual({
      kind: "setup",
    });
  });

  it("keeps an offline Library usable while it has projects to show", () => {
    const offline = { ...ready, phase: "offline", connected: false, supported: false };
    expect(libraryPaletteBlocker(offline)).toBeNull();
    expect(libraryPaletteBlocker({ ...offline, hasProjects: false })).toMatchObject({
      reason: "Reconnect the Library server to use it",
    });
    expect(
      libraryPaletteBlocker({ ...offline, hasProjects: false, phase: "connecting" }),
    ).toMatchObject({ reason: "Connecting to the Library" });
  });

  it("names a Library server that lacks the feature", () => {
    expect(libraryPaletteBlocker({ ...ready, supported: false })).toMatchObject({
      reason: "Update Loom on the Library server to use it",
    });
    expect(libraryPaletteBlocker(ready)).toBeNull();
  });
});

describe("Library shortcuts", () => {
  const ready = { blocker: null, canStart: true, liveProjects: 2 };
  const goTo = "loom.library.goToProject";
  const start = "loom.library.newConversationIn";

  it("opens the palette's project picker when there is one", () => {
    expect(libraryShortcutAction(goTo, ready)).toBe("submenu");
    expect(libraryShortcutAction(start, ready)).toBe("submenu");
    // Still loading: the palette waits for its picker to appear.
    expect(libraryShortcutAction(start, { ...ready, liveProjects: null })).toBe("submenu");
  });

  it("does nothing for a conversation the user may not start", () => {
    expect(libraryShortcutAction(start, { ...ready, canStart: false })).toBeNull();
    expect(libraryShortcutAction(goTo, { ...ready, canStart: false })).toBe("submenu");
  });

  it("falls back to setup or the project chooser when there is nothing to pick", () => {
    const setup = { ...ready, blocker: { kind: "setup" } as const, canStart: false };
    expect(libraryShortcutAction(goTo, setup)).toBe("fallback");
    expect(libraryShortcutAction(start, setup)).toBe("fallback");
    expect(libraryShortcutAction(goTo, { ...ready, liveProjects: 0 })).toBe("fallback");
    expect(libraryShortcutAction(start, { ...ready, liveProjects: 0 })).toBe("fallback");
  });

  it("does nothing while the Library is unusable", () => {
    const blocked = { ...ready, blocker: { kind: "unavailable", reason: "Offline" } as const };
    expect(libraryShortcutAction(goTo, blocked)).toBeNull();
    expect(libraryShortcutAction(start, blocked)).toBeNull();
  });
});
