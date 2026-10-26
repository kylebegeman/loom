import { libraryProjectScopeKey, parseLibraryProjectScope } from "@t3tools/client-runtime/fork";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryProject,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import { describe, expect, it } from "vite-plus/test";

import { libraryProjectFilterOptions, libraryScopeProjectKeys } from "./libraryProjectFilter";

const host = EnvironmentId.make("host");
const at = "2026-10-15T12:00:00.000Z";
const project = (id: string, archived: boolean, folders: string[] = [id]): LibraryProject => ({
  id,
  title: id,
  brief: "",
  revision: 1,
  archived,
  createdAt: at,
  updatedAt: at,
  resources: folders.map((folder) => ({
    id: folder,
    title: folder,
    remoteUrl: null,
    relativePath: folder,
    defaultBranch: null,
  })),
});
const thread = (
  projectId: string,
  localProjectId: string,
  resourceIds: string[] = [],
): LibraryThreadSummary => ({
  id: `${projectId}:${localProjectId}`,
  projectId,
  localProjectId: ProjectId.make(localProjectId),
  environmentId: host,
  threadId: ThreadId.make(`thread-${projectId}-${localProjectId}`),
  resourceIds,
  workingCopyId: null,
  title: "Saved work",
  status: "idle",
  archived: false,
  createdAt: at,
  updatedAt: at,
  syncedAt: at,
  sequence: 1,
});
const copy = (projectId: string, localProjectId: string): LibraryWorkingCopy => ({
  id: `copy-${projectId}`,
  projectId,
  projectRevision: 1,
  environmentId: host,
  rootPath: `/${localProjectId}`,
  rootLocalProjectId: ProjectId.make(localProjectId),
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: at,
  updatedAt: at,
});
const folder = (id: string) => ({
  key: `folder:${id}`,
  title: id,
  projectRefs: [{ environmentId: host, projectId: ProjectId.make(id) }],
});

describe("one mobile project filter", () => {
  const catalog = [project("loom", false), project("old", true), project("older", true)];
  const scopes = [
    folder("loom-folder"),
    folder("old-folder"),
    folder("older-folder"),
    folder("free"),
  ];
  const input = {
    scopes,
    catalog,
    threads: [thread("loom", "loom-folder"), thread("old", "old-folder")],
    copies: [copy("older", "older-folder")],
  };

  it("lists live projects, then folders no live project holds", () => {
    expect(libraryProjectFilterOptions({ ...input, selectedKey: null })).toEqual([
      { key: libraryProjectScopeKey("loom"), label: "loom" },
      { key: "folder:old-folder", label: "old-folder" },
      { key: "folder:older-folder", label: "older-folder" },
      { key: "folder:free", label: "free" },
    ]);
  });

  it("keeps a selected archived project or held folder listed so it can be cleared", () => {
    const archived = libraryProjectScopeKey("old");
    expect(libraryProjectFilterOptions({ ...input, selectedKey: archived })).toContainEqual({
      key: archived,
      label: "old (archived)",
    });
    expect(
      libraryProjectFilterOptions({ ...input, selectedKey: "folder:loom-folder" }),
    ).toContainEqual({ key: "folder:loom-folder", label: "loom-folder" });
  });
});

describe("Library scope thread list", () => {
  it("lists every saved folder for a project and only single-folder threads for a folder", () => {
    const threads = [
      thread("aspect", "web", ["web"]),
      thread("aspect", "ios", ["ios"]),
      thread("aspect", "both", ["web", "ios"]),
    ];
    const whole = parseLibraryProjectScope(libraryProjectScopeKey("aspect"))!;
    expect([...libraryScopeProjectKeys(whole, threads)]).toEqual([
      "host:web",
      "host:ios",
      "host:both",
    ]);
    const web = parseLibraryProjectScope(libraryProjectScopeKey("aspect", "web"))!;
    expect([...libraryScopeProjectKeys(web, threads)]).toEqual(["host:web"]);
  });
});
