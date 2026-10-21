import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryThreadSummary, LibraryWorkingCopy } from "@t3tools/contracts/fork";

vi.mock("./state", () => ({}));
vi.mock("~/state/query", () => ({}));
import { libraryScopeLocalProjectKeys } from "./useSidebarLibraryScope";

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
