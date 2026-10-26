import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, it, expect } from "vite-plus/test";
import {
  libraryProjectScopeKey,
  parseLibraryProjectScope,
  libraryThreadMatchesScope,
  libraryHoldsLocalRefs,
  libraryProjectForLocalRefs,
  libraryProjectFilterItems,
  libraryOutsideArchivedProjects,
} from "./library-navigation.ts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
const row = (
  projectId: string,
  localProjectId: string,
  resourceIds: string[] = [],
): LibraryThreadSummary => ({
  id: `host:${localProjectId}`,
  projectId,
  localProjectId: ProjectId.make(localProjectId),
  environmentId: EnvironmentId.make("host"),
  threadId: ThreadId.make(`thread-${localProjectId}`),
  resourceIds,
  workingCopyId: null,
  title: "Saved work",
  status: "idle",
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
  syncedAt: "2026-10-15T12:00:00.000Z",
  sequence: 1,
});

describe("one project filter for durable and existing work", () => {
  it("round trips component IDs without inventing extra selectors", () => {
    const key = libraryProjectScopeKey("Aspect:Avy", "iOS:one");
    expect(parseLibraryProjectScope(key)).toEqual({
      projectId: "Aspect:Avy",
      resourceId: "iOS:one",
    });
    expect(parseLibraryProjectScope("physical:project")).toBeNull();
    expect(parseLibraryProjectScope("library:%bad")).toBeNull();
  });
  it("project scope includes all components while component scope stays explicit", () => {
    const parent = parseLibraryProjectScope(libraryProjectScopeKey("AspectAvy"));
    const ios = parseLibraryProjectScope(libraryProjectScopeKey("AspectAvy", "ios"));
    expect(libraryThreadMatchesScope(row("AspectAvy", "root"), parent)).toBe(true);
    expect(libraryThreadMatchesScope(row("AspectAvy", "ios", ["ios"]), ios)).toBe(true);
    expect(libraryThreadMatchesScope(row("AspectAvy", "root", ["ios", "web"]), ios)).toBe(false);
    expect(libraryThreadMatchesScope(row("other", "ios", ["ios"]), ios)).toBe(false);
  });
  it("only coalesces source refs with one explicit project identity", () => {
    const rows = [row("AspectAvy", "web"), row("AspectAvy", "ios")];
    expect(
      libraryProjectForLocalRefs(rows, [
        { environmentId: "host", projectId: "web" },
        { environmentId: "host", projectId: "ios" },
      ]),
    ).toBe("AspectAvy");
    expect(
      libraryProjectForLocalRefs(rows, [{ environmentId: "other-host", projectId: "web" }]),
    ).toBeNull();
    expect(
      libraryProjectForLocalRefs(
        [...rows, row("other", "web")],
        [{ environmentId: "host", projectId: "web" }],
      ),
    ).toBeNull();
  });
  it("still treats a folder as held when two projects share it or one computer lacks a copy", () => {
    const web = { environmentId: "host", projectId: "web" };
    const shared = [row("AspectAvy", "web"), row("other", "web")];
    expect(libraryProjectForLocalRefs(shared, [web])).toBeNull();
    expect(libraryHoldsLocalRefs(shared, [web])).toBe(true);
    const elsewhere = { environmentId: "other-host", projectId: "web" };
    expect(libraryHoldsLocalRefs([row("AspectAvy", "web")], [web, elsewhere])).toBe(true);
    expect(libraryHoldsLocalRefs([row("AspectAvy", "web")], [elsewhere])).toBe(false);
  });
  it("maps registered folders without depending on a recent thread index", () => {
    const copy: LibraryWorkingCopy = {
      id: "copy",
      projectId: "AspectAvy",
      projectRevision: 1,
      environmentId: EnvironmentId.make("host"),
      rootPath: "/aspectavy",
      rootLocalProjectId: ProjectId.make("root"),
      repositories: [
        {
          resourceId: "ios",
          path: "/aspectavy/ios",
          localProjectId: ProjectId.make("ios"),
          head: null,
          branch: null,
        },
      ],
      ownership: "borrowed",
      state: "ready",
      createdAt: "2026-10-15T12:00:00.000Z",
      updatedAt: "2026-10-15T12:00:00.000Z",
    };
    expect(
      libraryProjectForLocalRefs([], [{ environmentId: "host", projectId: "root" }], [copy]),
    ).toBe("AspectAvy");
    expect(
      libraryProjectForLocalRefs([], [{ environmentId: "host", projectId: "ios" }], [copy]),
    ).toBe("AspectAvy");
    expect(
      libraryProjectForLocalRefs([], [{ environmentId: "other", projectId: "ios" }], [copy]),
    ).toBeNull();
    expect(
      libraryProjectForLocalRefs(
        [],
        [{ environmentId: "host", projectId: "ios" }],
        [{ ...copy, registered: false }],
      ),
    ).toBeNull();
  });
});

describe("archived projects stay out of the project filter", () => {
  const folder = (id: string) => ({
    id,
    title: id,
    remoteUrl: null,
    relativePath: id,
    defaultBranch: null,
  });
  const project = (id: string, archived: boolean, folders: string[]): LibraryProject => ({
    id,
    title: id,
    brief: "",
    revision: 1,
    archived,
    createdAt: "2026-10-15T12:00:00.000Z",
    updatedAt: "2026-10-15T12:00:00.000Z",
    resources: [
      ...folders.map(folder),
      { ...folder("docs"), kind: "link" as const, url: "https://example.com" },
    ],
  });
  const catalog = [
    project("loom", false, ["loom"]),
    project("aspectavy", false, ["ios", "web"]),
    project("old", true, ["old"]),
  ];

  it("lists live projects once and their folders only when there are several", () => {
    expect(libraryProjectFilterItems(catalog)).toEqual([
      { value: libraryProjectScopeKey("loom"), label: "loom" },
      { value: libraryProjectScopeKey("aspectavy"), label: "aspectavy" },
      { value: libraryProjectScopeKey("aspectavy", "ios"), label: "aspectavy / ios" },
      { value: libraryProjectScopeKey("aspectavy", "web"), label: "aspectavy / web" },
    ]);
  });

  it("keeps a selected scope listed so it can be cleared", () => {
    const archived = libraryProjectScopeKey("old", "old");
    expect(libraryProjectFilterItems(catalog, archived)).toContainEqual({
      value: archived,
      label: "old / old (archived)",
    });
    expect(libraryProjectFilterItems(catalog, archived)).toHaveLength(5);
    const single = libraryProjectScopeKey("loom", "loom");
    expect(libraryProjectFilterItems(catalog, single)).toContainEqual({
      value: single,
      label: "loom / loom",
    });
  });

  it("drops conversations and copies of archived projects", () => {
    const threads = [row("loom", "a"), row("old", "b")];
    expect(libraryOutsideArchivedProjects(threads, catalog)).toEqual([threads[0]]);
  });

  it("does not hold a folder for a deleted conversation", () => {
    const ref = { environmentId: "host", projectId: "web" };
    expect(libraryHoldsLocalRefs([{ ...row("AspectAvy", "web"), deleted: true }], [ref])).toBe(
      false,
    );
  });
});
