import { describe, expect, it, vi } from "vite-plus/test";
import { ProjectId } from "@t3tools/contracts";
import type { LibraryProject, LibraryThreadSummary } from "@t3tools/contracts/fork";

vi.mock("./state", () => ({}));
vi.mock("~/state/query", () => ({}));
import { librarySavedThreadsToList } from "./LibrarySavedThreads";

const project = (id: string, title: string, archived = false): LibraryProject => ({
  id,
  title,
  brief: "",
  revision: 1,
  resources: [],
  archived,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
});
const saved = (id: string, patch: Partial<LibraryThreadSummary> = {}) =>
  ({
    id,
    threadId: id,
    title: id,
    projectId: "live",
    environmentId: "host",
    localProjectId: "folder",
    archived: false,
    ...patch,
  }) as LibraryThreadSummary;
const projects = [project("live", "Website"), project("old", "Old app", true)];
const ids = (threads: readonly LibraryThreadSummary[]) => threads.map((thread) => thread.id);

describe("saved conversations", () => {
  it("leaves out conversations of archived projects", () => {
    expect(
      ids(librarySavedThreadsToList([saved("a"), saved("b", { projectId: "old" })], projects)),
    ).toEqual(["a"]);
  });
  it("leaves out archived, deleted and locally open conversations", () => {
    const threads = [
      saved("a"),
      saved("b", { archived: true }),
      saved("c", { deleted: true }),
      saved("d"),
    ];
    expect(
      ids(librarySavedThreadsToList(threads, projects, { local: new Set(["host:d"]) })),
    ).toEqual(["a"]);
  });
  it("narrows to the scoped folders and matches a search on the project title", () => {
    const threads = [saved("a"), saved("b", { localProjectId: ProjectId.make("elsewhere") })];
    expect(
      ids(librarySavedThreadsToList(threads, projects, { projectKeys: new Set(["host:folder"]) })),
    ).toEqual(["a"]);
    expect(ids(librarySavedThreadsToList(threads, projects, { search: " website " }))).toEqual([
      "a",
      "b",
    ]);
    expect(ids(librarySavedThreadsToList(threads, projects, { search: "old" }))).toEqual([]);
  });
});
