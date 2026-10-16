import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProject,
  LibraryRepositoryHealth,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchComputer } from "@t3tools/shared/fork/library-launch";
import {
  libraryLaunchChoice,
  libraryLaunchRanking,
  libraryLaunchWarning,
} from "./library-launch-choice.ts";

const MINI = EnvironmentId.make("mini");
const BOOK = EnvironmentId.make("book");
const CHECKED = "2026-10-16T10:00:00.000Z";
const project: LibraryProject = {
  id: "loom",
  title: "Loom",
  brief: "",
  revision: 1,
  archived: false,
  resources: [
    { id: "app", title: "App", remoteUrl: null, relativePath: "app", defaultBranch: null },
    { id: "docs", title: "Docs", remoteUrl: null, relativePath: "docs", defaultBranch: null },
  ],
  createdAt: CHECKED,
  updatedAt: CHECKED,
};
const computers: LibraryLaunchComputer[] = [
  {
    environmentId: MINI,
    label: "Mac Mini",
    online: true,
    supportsExecution: true,
    workingThreads: 0,
  },
  {
    environmentId: BOOK,
    label: "MacBook",
    online: true,
    supportsExecution: true,
    workingThreads: 0,
  },
];
const copy = (
  id: string,
  environmentId: EnvironmentId,
  resourceIds: readonly string[] = ["app", "docs"],
): LibraryWorkingCopy => ({
  id,
  projectId: project.id,
  projectRevision: 1,
  environmentId,
  rootPath: `/work/${id}`,
  repositories: resourceIds.map((resourceId) => ({
    resourceId,
    path: `/work/${id}/${resourceId}`,
    localProjectId: ProjectId.make(`${id}-${resourceId}`),
    branch: null,
    head: null,
  })),
  ownership: "managed",
  state: "ready",
  createdAt: CHECKED,
  updatedAt: CHECKED,
});
const repository = (
  resourceId: string,
  overrides: Partial<LibraryRepositoryHealth> = {},
): LibraryRepositoryHealth => ({
  resourceId,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  uncommittedFiles: 0,
  unpushedCommits: 0,
  checkedAt: CHECKED,
  ...overrides,
});
const health = (
  copyId: string,
  environmentId: EnvironmentId,
  repositories: readonly LibraryRepositoryHealth[],
): LibraryCopyHealth => ({ copyId, environmentId, repositories, checkedAt: CHECKED });
const live = (...entries: LibraryCopyHealth[]) =>
  new Map(entries.map((entry) => [entry.copyId, entry]));

describe("libraryLaunchRanking", () => {
  it("only counts copies that hold the selected component", () => {
    const ranking = libraryLaunchRanking({
      project,
      copies: [copy("mini-copy", MINI, ["docs"]), copy("book-copy", BOOK)],
      computers,
      threads: [],
      resourceId: "app",
    });
    expect(
      ranking.candidates.map((candidate) => [candidate.environmentId, candidate.kind]),
    ).toEqual([
      [BOOK, "copy"],
      [MINI, "get-copy"],
    ]);
  });

  it("reads last use from this project's conversations only", () => {
    const thread = (projectId: string, environmentId: EnvironmentId): LibraryThreadSummary => ({
      id: `${projectId}-${environmentId}`,
      projectId,
      environmentId,
      threadId: ThreadId.make(`${projectId}-${environmentId}`),
      localProjectId: ProjectId.make("local"),
      workingCopyId: null,
      resourceIds: [],
      title: "",
      status: "idle",
      archived: false,
      createdAt: CHECKED,
      updatedAt: CHECKED,
      syncedAt: CHECKED,
      sequence: 0,
    });
    const ranking = libraryLaunchRanking({
      project,
      copies: [copy("mini-copy", MINI), copy("book-copy", BOOK)],
      computers,
      threads: [thread("other", BOOK), thread(project.id, MINI)],
      resourceId: null,
    });
    expect(ranking.preselected?.environmentId).toBe(MINI);
    expect(ranking.preselected?.reasons).toContain("used last");
  });
});

describe("libraryLaunchChoice", () => {
  const ranking = libraryLaunchRanking({
    project,
    copies: [copy("mini-a", MINI), copy("mini-b", MINI), copy("book-copy", BOOK)],
    computers,
    threads: [],
    resourceId: null,
    liveHealth: live(
      health("mini-a", MINI, [repository("app"), repository("docs")]),
      health("mini-b", MINI, [repository("app", { behind: 1 }), repository("docs")]),
      health("book-copy", BOOK, [repository("app", { behind: 2 }), repository("docs")]),
    ),
  });

  it("follows the preselection until the user picks a computer", () => {
    expect(libraryLaunchChoice({ ranking, hostId: null, copyId: null })).toMatchObject({
      hostId: MINI,
      candidate: { kind: "copy", copyId: "mini-a" },
    });
  });

  it("uses the best copy on a computer the user picked", () => {
    expect(libraryLaunchChoice({ ranking, hostId: BOOK, copyId: null })).toMatchObject({
      hostId: BOOK,
      candidate: { copyId: "book-copy" },
    });
  });

  it("keeps a copy picked by hand, and ignores one from another computer", () => {
    expect(
      libraryLaunchChoice({ ranking, hostId: MINI, copyId: "mini-b" }).candidate,
    ).toMatchObject({ copyId: "mini-b" });
    expect(
      libraryLaunchChoice({ ranking, hostId: MINI, copyId: "book-copy" }).candidate,
    ).toMatchObject({ copyId: "mini-a" });
  });

  it("chooses nothing when no computer can be preselected", () => {
    const offline = libraryLaunchRanking({
      project,
      copies: [],
      computers: computers.map((computer) => ({ ...computer, online: false })),
      threads: [],
      resourceId: null,
    });
    expect(libraryLaunchChoice({ ranking: offline, hostId: null, copyId: null })).toEqual({
      hostId: null,
      candidate: null,
    });
  });
});

describe("libraryLaunchWarning", () => {
  const warningFor = (
    repositories: readonly LibraryRepositoryHealth[],
    resourceId: string | null = null,
  ) => {
    const entry = copy("mini-copy", MINI);
    const ranking = libraryLaunchRanking({
      project,
      copies: [entry],
      computers: computers.slice(0, 1),
      threads: [],
      resourceId,
      liveHealth: live(health(entry.id, MINI, repositories)),
    });
    return libraryLaunchWarning(ranking.preselected, entry, resourceId);
  };

  it("says nothing for an up-to-date copy or one never checked", () => {
    expect(warningFor([repository("app"), repository("docs")])).toBeNull();
    const entry = copy("mini-copy", MINI);
    const unchecked = libraryLaunchRanking({
      project,
      copies: [entry],
      computers: computers.slice(0, 1),
      threads: [],
      resourceId: null,
    });
    expect(libraryLaunchWarning(unchecked.preselected, entry, null)).toBeNull();
  });

  it("offers a pull for a clean copy that is behind", () => {
    expect(warningFor([repository("app", { behind: 3 }), repository("docs")])).toEqual({
      message: "This copy is 3 commits behind.",
      pullPaths: ["/work/mini-copy/app"],
    });
  });

  it("warns about uncommitted files without offering a pull", () => {
    expect(warningFor([repository("app", { uncommittedFiles: 1 }), repository("docs")])).toEqual({
      message: "This copy has 1 uncommitted file.",
      pullPaths: null,
    });
  });

  it("does not offer a pull when a behind repository has local changes", () => {
    expect(
      warningFor([repository("app", { behind: 1, uncommittedFiles: 2 }), repository("docs")]),
    ).toEqual({
      message: "This copy is 1 commit behind and has 2 uncommitted files.",
      pullPaths: null,
    });
  });

  it("does not offer a pull when a behind repository has diverged", () => {
    expect(warningFor([repository("app", { behind: 1, ahead: 1 })])?.pullPaths).toBeNull();
  });

  it("pulls only the selected component", () => {
    expect(
      warningFor([repository("app", { behind: 1 }), repository("docs", { behind: 4 })], "app"),
    ).toEqual({ message: "This copy is 1 commit behind.", pullPaths: ["/work/mini-copy/app"] });
  });

  it("says when a folder in the copy is missing", () => {
    expect(warningFor([repository("app", { error: "missing" })])).toBeNull();
    const entry = copy("mini-copy", MINI);
    const ranking = libraryLaunchRanking({
      project,
      copies: [entry],
      computers: computers.slice(0, 1),
      threads: [],
      resourceId: null,
      liveHealth: live(health(entry.id, MINI, [repository("app", { error: "missing" })])),
    });
    // Never preselected, but the copy can still be chosen by hand.
    const chosen = libraryLaunchChoice({ ranking, hostId: MINI, copyId: entry.id }).candidate;
    expect(libraryLaunchWarning(chosen, entry, null)).toEqual({
      message: "A folder in this copy is missing or is no longer a Git repository.",
      pullPaths: null,
    });
  });

  it("says nothing for a computer without a copy", () => {
    const ranking = libraryLaunchRanking({
      project,
      copies: [],
      computers,
      threads: [],
      resourceId: null,
    });
    expect(libraryLaunchWarning(ranking.preselected, null, null)).toBeNull();
  });
});
