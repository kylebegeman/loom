import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type {
  LibraryCopyHealth,
  LibraryProfileReadiness,
  LibraryProject,
  LibraryRepositoryHealth,
  LibraryThreadSummary,
  LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import type { LibraryLaunchComputer } from "@t3tools/shared/fork/library-launch";
import type { ThreadRuntimeSummary } from "../state/models.ts";
import {
  libraryCopyFolderConversations,
  libraryLaunchCanUseWorktree,
  libraryLaunchChoice,
  libraryLaunchRanking,
  libraryLaunchWarning,
  libraryLaunchWorkspace,
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
    ).toBeNull();
    expect(
      libraryLaunchChoice({ ranking, hostId: MINI, copyId: "removed-copy" }).candidate,
    ).toBeNull();
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

describe("libraryLaunchRanking with the project's setup", () => {
  const xcodeMissing: LibraryProfileReadiness = {
    projectId: project.id,
    environmentId: MINI,
    checks: [{ id: "xcode", label: "Xcode", status: "missing" }],
    secrets: [],
    checkedAt: CHECKED,
  };
  const miniWorkers = [
    {
      environmentId: BOOK,
      readiness: {
        workerId: "worker-1",
        name: "Build Mini",
        checkedAt: CHECKED,
        status: "ready" as const,
        architecture: "arm64",
        cpuCount: 10,
        slots: 2,
        active: 0,
        nativeServerRunning: true,
        outputBundles: true,
        missingTools: [],
        reasons: [],
      },
    },
  ];

  it("holds the preselection while a required-tool check is still loading", () => {
    const input = {
      project,
      copies: [copy("mini-copy", MINI)],
      computers,
      threads: [],
      resourceId: null,
    };
    expect(libraryLaunchRanking(input).preselected?.environmentId).toBe(MINI);
    expect(libraryLaunchRanking({ ...input, readinessPending: true }).preselected).toBeNull();
    expect(
      libraryLaunchRanking({ ...input, readiness: new Map([[MINI, xcodeMissing]]) }).preselected
        ?.environmentId,
    ).toBe(BOOK);
  });

  it("offers Mini only when the project's profile allows it, and never launches on it", () => {
    const input = { copies: [], computers, threads: [], resourceId: null, miniWorkers };
    expect(
      libraryLaunchRanking({ ...input, project }).candidates.some(
        (candidate) => candidate.kind === "mini",
      ),
    ).toBe(false);
    const allowed = libraryLaunchRanking({
      ...input,
      project: { ...project, profile: { allowMini: true } },
    });
    expect(allowed.candidates.at(-1)?.kind).toBe("mini");
    expect(
      libraryLaunchChoice({ ranking: allowed, hostId: BOOK, copyId: null }).candidate?.kind,
    ).toBe("get-copy");
  });
});

describe("libraryLaunchWarning", () => {
  const warningFor = (
    repositories: readonly LibraryRepositoryHealth[],
    resourceId: string | null = null,
    sharedFolder?: { conversations: number; workspace: "folder" | "worktree" | null },
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
    return libraryLaunchWarning(ranking.preselected, entry, resourceId, sharedFolder);
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

  it("says nothing about uncommitted files alone", () => {
    expect(warningFor([repository("app", { uncommittedFiles: 1 }), repository("docs")])).toBeNull();
  });

  it("warns when other conversations work in the same folder, pointing to a worktree", () => {
    const changed = [repository("app", { uncommittedFiles: 1 }), repository("docs")];
    expect(warningFor(changed, null, { conversations: 1, workspace: "folder" })).toEqual({
      message:
        "Another conversation is working in this folder. Choose New worktree to keep the changes apart.",
      pullPaths: null,
    });
    expect(warningFor(changed, null, { conversations: 2, workspace: null })).toEqual({
      message: "2 other conversations are working in this folder and changing the same files.",
      pullPaths: null,
    });
    expect(warningFor(changed, null, { conversations: 0, workspace: "folder" })).toBeNull();
    expect(warningFor(changed, null, { conversations: 1, workspace: "worktree" })).toBeNull();
  });

  it("never offers a pull under another conversation's work", () => {
    const behind = [repository("app", { behind: 3 }), repository("docs")];
    expect(warningFor(behind, null, { conversations: 1, workspace: "folder" })).toEqual({
      message:
        "This copy is 3 commits behind. Another conversation is working in this folder. Choose New worktree to keep the changes apart.",
      pullPaths: null,
    });
    expect(warningFor(behind, null, { conversations: 1, workspace: "worktree" })).toEqual({
      message: "This copy is 3 commits behind.",
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

describe("libraryLaunchCanUseWorktree", () => {
  const root = {
    id: "site",
    title: "Site",
    remoteUrl: null,
    relativePath: ".",
    defaultBranch: null,
  };
  const link = {
    id: "spec",
    title: "Spec",
    kind: "link" as const,
    url: "https://example.com/spec",
    remoteUrl: null,
    relativePath: "",
    defaultBranch: null,
  };

  it("allows one chosen repository, or a project that is one repository at its root", () => {
    expect(libraryLaunchCanUseWorktree(project, "app")).toBe(true);
    expect(libraryLaunchCanUseWorktree({ resources: [root, link] }, null)).toBe(true);
  });

  it("refuses a whole project of several repositories or one in a subfolder", () => {
    expect(libraryLaunchCanUseWorktree(project, null)).toBe(false);
    expect(libraryLaunchCanUseWorktree({ resources: [project.resources[0]!] }, null)).toBe(false);
  });
});

describe("libraryLaunchWorkspace", () => {
  it("defaults to a new worktree only while others work in the folder", () => {
    expect(libraryLaunchWorkspace({ available: true, chosen: null, conversations: 0 })).toBe(
      "folder",
    );
    expect(libraryLaunchWorkspace({ available: true, chosen: null, conversations: 1 })).toBe(
      "worktree",
    );
  });

  it("keeps the user's choice, and has none when worktrees are unavailable", () => {
    expect(libraryLaunchWorkspace({ available: true, chosen: "folder", conversations: 2 })).toBe(
      "folder",
    );
    expect(libraryLaunchWorkspace({ available: false, chosen: "worktree", conversations: 2 })).toBe(
      null,
    );
  });
});

describe("libraryCopyFolderConversations", () => {
  const entry = copy("mini-copy", MINI);
  const shell = (
    worktreePath: string | null,
    status: ThreadRuntimeSummary["status"] = "running",
  ) => ({
    environmentId: MINI,
    worktreePath,
    archivedAt: null as string | null,
    runtime: {
      status,
      activeRunId: null,
      providerInstanceId: ProviderInstanceId.make("codex"),
      providerName: null,
      lastError: null,
      updatedAt: CHECKED,
    } satisfies ThreadRuntimeSummary,
  });

  it("counts working conversations in the copy folder and its component folders", () => {
    expect(
      libraryCopyFolderConversations(
        [shell("/work/mini-copy"), shell("/work/mini-copy/app/"), shell("/work/mini-copy-2")],
        entry,
      ),
    ).toBe(2);
  });

  it("leaves out worktrees, idle and archived conversations, and other computers", () => {
    expect(
      libraryCopyFolderConversations(
        [
          shell("/home/.t3/worktrees/loom/t3-1"),
          shell("/work/mini-copy", "idle"),
          { ...shell("/work/mini-copy"), archivedAt: CHECKED },
          { ...shell("/work/mini-copy"), environmentId: BOOK },
          shell(null),
        ],
        entry,
      ),
    ).toBe(0);
    expect(libraryCopyFolderConversations([shell("/work/mini-copy")], null)).toBe(0);
  });
});
