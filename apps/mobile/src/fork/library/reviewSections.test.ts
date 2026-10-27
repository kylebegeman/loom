import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import {
  AuthFilesystemReadScope,
  CheckpointRef,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  type AuthSessionState,
  type ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  gitStatus: null as { readonly isRepo: boolean } | null,
  diffSources: [] as ReadonlyArray<ReviewDiffPreviewSource>,
  lastGitSections: [] as ReadonlyArray<ReviewDiffPreviewSource>,
  checkpoints: [] as ReadonlyArray<ThreadCheckpointSummary>,
  checkpointDiff: "diff --git a/checkpoint.ts b/checkpoint.ts",
  sessionAtom: { name: "session" },
  gitStatusAtom: { name: "git-status" },
  diffPreviewAtom: { name: "diff-preview" },
  gitSectionsAtom: { name: "git-sections" },
  turnDiffsAtom: { name: "turn-diffs" },
}));

vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: (atom: unknown) =>
    atom === state.gitSectionsAtom
      ? state.lastGitSections
      : atom === state.turnDiffsAtom
        ? { 1: state.checkpointDiff }
        : [],
}));
vi.mock("@t3tools/client-runtime/state/thread-checkpoints", () => ({
  deriveThreadCheckpointSummaries: () => state.checkpoints,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data:
      atom === state.sessionAtom
        ? state.session
        : atom === state.gitStatusAtom
          ? state.gitStatus
          : atom === state.diffPreviewAtom
            ? { sources: state.diffSources }
            : null,
    error: null,
    isPending:
      (atom === state.sessionAtom && state.session === null) ||
      (atom === state.gitStatusAtom && state.gitStatus === null),
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/queries", () => ({
  useCheckpointDiff: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));
vi.mock("../../state/review", () => ({
  lastReviewGitSectionsAtom: () => state.gitSectionsAtom,
  reviewEnvironment: { diffPreview: vi.fn(() => state.diffPreviewAtom) },
}));
vi.mock("../../state/reviewTurnDiffs", () => ({
  lastReviewTurnDiffsAtom: () => state.turnDiffsAtom,
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => state.sessionAtom },
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { status: () => state.gitStatusAtom },
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: "connected", error: null } },
  }),
}));
vi.mock("../../state/use-thread-detail", () => ({
  useSelectedThreadProjection: () => ({ projection: {} }),
}));
vi.mock("../../state/use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => ({ selectedThreadCwd: "/projects/parent" }),
}));
vi.mock("../../features/review/reviewState", () => ({
  setReviewSelectedSectionId: vi.fn(),
}));

import { useReviewSections } from "../../features/review/useReviewSections";
import { reviewEnvironment } from "../../state/review";

const localDiff = "diff --git a/local.ts b/local.ts";
const workingTree: ReviewDiffPreviewSource = {
  id: "working-tree",
  kind: "working-tree",
  title: "Working tree",
  baseRef: "HEAD",
  headRef: null,
  diff: localDiff,
  diffHash: "local",
  truncated: false,
};

function setup(gitStatus: { readonly isRepo: boolean } | null) {
  vi.mocked(reviewEnvironment.diffPreview).mockClear();
  state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
  state.gitStatus = gitStatus;
  state.diffSources = [workingTree];
  state.lastGitSections = [workingTree];
  state.checkpoints = [
    {
      runId: RunId.make("turn-1"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread/1"),
      status: "ready",
      files: [],
      assistantMessageId: MessageId.make("message-1"),
      completedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
}

function reviewSections(selectedSectionId: string | null) {
  return useReviewSections({
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    reviewCache: {
      threadKey: "environment:thread",
      selectedSectionId,
      expandedFileIdsBySection: {},
      revealedLargeFileIdsBySection: {},
      viewedFileIdsBySection: {},
    },
  });
}

it("reviews a multi-repository parent by its checkpoints without asking Git for a diff", () => {
  setup({ isRepo: false });
  const result = reviewSections("git:working-tree");
  expect(reviewEnvironment.diffPreview).not.toHaveBeenCalled();
  expect(result.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(result.selectedSection?.diff).toBe(state.checkpointDiff);
  expect(result.error).toBeNull();
});

it("keeps the chosen local section loading while Git status is still checking", () => {
  setup(null);
  const result = reviewSections("git:working-tree");
  expect(reviewEnvironment.diffPreview).not.toHaveBeenCalled();
  expect(result.selectedSection).toEqual(
    expect.objectContaining({ id: "git:working-tree", diff: null, isLoading: true }),
  );
});

it("shows the local changes once Git confirms the folder is a repository", () => {
  setup({ isRepo: true });
  const result = reviewSections("git:working-tree");
  expect(reviewEnvironment.diffPreview).toHaveBeenCalled();
  expect(result.selectedSection).toEqual(
    expect.objectContaining({ id: "git:working-tree", diff: localDiff, isLoading: false }),
  );
});
