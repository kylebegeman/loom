import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import {
  AuthFilesystemReadScope,
  CheckpointRef,
  EnvironmentId,
  MessageId,
  ThreadId,
  RunId,
  type AuthSessionState,
  type ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  sessionError: null as string | null,
  sessionAtom: {},
  gitStatusAtom: {},
  gitStatus: { isRepo: true, checkpointCapable: true },
  gitStatusPending: false,
  gitSectionsAtom: {},
  lastGitSections: [] as ReadonlyArray<unknown>,
  turnDiffsAtom: {},
  lastTurnDiffs: {} as Readonly<Record<number, string>>,
  checkpoints: [] as ReadonlyArray<ThreadCheckpointSummary>,
}));

vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === state.gitSectionsAtom
      ? state.lastGitSections
      : atom === state.turnDiffsAtom
        ? state.lastTurnDiffs
        : undefined,
}));
vi.mock("@t3tools/client-runtime/state/thread-checkpoints", () => ({
  deriveThreadCheckpointSummaries: () => state.checkpoints,
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => state.sessionAtom },
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
  useSelectedThreadWorktree: () => ({ selectedThreadCwd: "/repo" }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({
    data:
      atom === state.sessionAtom
        ? state.session
        : atom === state.gitStatusAtom
          ? state.gitStatus
          : null,
    error: atom === state.sessionAtom ? state.sessionError : null,
    isPending:
      atom === state.sessionAtom
        ? state.session === null
        : atom === state.gitStatusAtom && state.gitStatusPending,
    refresh: vi.fn(),
  }),
}));
vi.mock("../../state/queries", () => ({
  useCheckpointDiff: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));
vi.mock("../../state/review", () => ({
  reviewEnvironment: { diffPreview: vi.fn() },
  lastReviewGitSectionsAtom: () => state.gitSectionsAtom,
}));
vi.mock("../../state/reviewTurnDiffs", () => ({
  lastReviewTurnDiffsAtom: () => state.turnDiffsAtom,
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { status: () => state.gitStatusAtom },
}));
vi.mock("./reviewState", () => ({
  setReviewSelectedSectionId: vi.fn(),
}));

import type { ReviewCacheForThread } from "./reviewState";
import { useReviewSections } from "./useReviewSections";
import { reviewEnvironment } from "../../state/review";

const checkpointDiff = "diff --git a/checkpoint.ts b/checkpoint.ts";
const localDiff = "diff --git a/local.ts b/local.ts";

function localSection(kind: "working-tree" | "branch-range"): ReviewDiffPreviewSource {
  return {
    id: kind,
    kind,
    title: "Dirty worktree",
    baseRef: "HEAD",
    headRef: null,
    diff: localDiff,
    diffHash: "cached-local",
    truncated: false,
  } as ReviewDiffPreviewSource;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
  state.sessionError = null;
  state.gitStatus = { isRepo: true, checkpointCapable: true };
  state.gitStatusPending = false;
  state.lastGitSections = [localSection("working-tree")];
  state.lastTurnDiffs = { 1: checkpointDiff };
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
});

function makeReviewCache(
  kind: "working-tree" | "branch-range" = "working-tree",
): ReviewCacheForThread {
  state.lastGitSections = [localSection(kind)];
  return {
    threadKey: "environment:thread",
    selectedSectionId: `git:${kind}`,
    expandedFileIdsBySection: {},
    revealedLargeFileIdsBySection: {},
    viewedFileIdsBySection: {},
  };
}

function makeInput(reviewCache = makeReviewCache()) {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    reviewCache,
  };
}

it("hides cached local diffs after file access is lost while retaining checkpoint diffs", () => {
  const input = makeInput();
  expect(useReviewSections(input).selectedSection?.diff).toBe(localDiff);

  state.session = { authenticated: true, scopes: [] };
  const denied = useReviewSections(input);
  expect(denied.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(denied.selectedSection?.diff).toBe(checkpointDiff);
});

it.each(["working-tree", "branch-range"] as const)(
  "preserves a cached %s selection while an expired grant reloads",
  (kind) => {
    const input = makeInput(makeReviewCache(kind));
    expect(useReviewSections(input).selectedSection?.diff).toBe(localDiff);

    state.session = null;
    const pending = useReviewSections(input);
    expect(pending.selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: null, isLoading: true }),
    );
    expect(pending.reviewSections.find((section) => section.id === "turn:1")?.diff).toBe(
      checkpointDiff,
    );

    state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
    expect(useReviewSections(input).selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: localDiff, isLoading: false }),
    );
  },
);

it("falls back to a checkpoint when a pending grant resolves without file access", () => {
  const input = makeInput();
  state.session = null;
  expect(useReviewSections(input).selectedSection?.id).toBe("git:working-tree");

  state.session = { authenticated: true, scopes: [] };
  const denied = useReviewSections(input);
  expect(denied.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(denied.selectedSection?.diff).toBe(checkpointDiff);
});

it("reports a failed access check when no checkpoint can replace the local review", () => {
  state.checkpoints = [];
  const input = makeInput();
  expect(useReviewSections(input).selectedSection?.diff).toBe(localDiff);

  state.sessionError = "The session request timed out.";
  const unavailable = useReviewSections(input);
  expect(unavailable.selectedSection).toBeNull();
  expect(unavailable.reviewSections).toEqual([]);
  expect(unavailable.error).toBe(state.sessionError);
});

it("reports denied file access when no checkpoint can replace the local review", () => {
  state.checkpoints = [];
  const input = makeInput();
  expect(useReviewSections(input).selectedSection?.diff).toBe(localDiff);

  state.session = { authenticated: true, scopes: [] };
  const denied = useReviewSections(input);
  expect(denied.selectedSection).toBeNull();
  expect(denied.reviewSections).toEqual([]);
  expect(denied.error).toBe("This connection cannot read local diffs.");
});

it("keeps a cached checkpoint available when the filesystem access check fails", () => {
  state.sessionError = "The session request timed out.";
  const checkpoint = useReviewSections(makeInput());
  expect(checkpoint.selectedSection?.diff).toBe(checkpointDiff);
  expect(checkpoint.error).toBeNull();
});

it("shows checkpoint changes for a multi-repository parent without asking Git to diff the parent folder", () => {
  state.gitStatus = { isRepo: false, checkpointCapable: true };
  const result = useReviewSections(makeInput());
  expect(reviewEnvironment.diffPreview).not.toHaveBeenCalled();
  expect(result.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(result.selectedSection?.diff).toBe(checkpointDiff);
  expect(result.error).toBeNull();
});
