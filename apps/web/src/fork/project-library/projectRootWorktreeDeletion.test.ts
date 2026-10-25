import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  EnvironmentId,
  ThreadId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useThreadActions } from "~/hooks/useThreadActions";
import { vcsEnvironment } from "~/state/vcs";

// Calls the hook outside React, so only its environment boundaries are replaced.
const deletion = vi.hoisted(() => ({
  worktreePath: null as string | null,
  commands: [] as unknown[],
  confirm: vi.fn<(message: string) => Promise<boolean>>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useMemo: (create: () => unknown) => create(),
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { matches: [] }, navigate: async () => {} }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: unknown) => unknown) =>
    select({ sidebarThreadSortOrder: "createdAt", confirmThreadDelete: true }),
}));
vi.mock("~/hooks/useHandleNewThread", () => ({ useNewThreadHandler: () => vi.fn() }));
vi.mock("~/composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: unknown) => unknown) =>
    select({ clearDraftThread: vi.fn(), clearProjectDraftThreadById: vi.fn() }),
}));
vi.mock("~/terminalUiStateStore", () => ({
  useTerminalUiStateStore: (select: (store: unknown) => unknown) =>
    select({ clearTerminalUiState: vi.fn() }),
}));
vi.mock("~/uiStateStore", () => ({
  useUiStateStore: (select: (store: unknown) => unknown) => select({ markThreadVisited: vi.fn() }),
}));
vi.mock("~/lib/archivedThreadsState", () => ({ refreshArchivedThreadsForEnvironment: vi.fn() }));
vi.mock("~/lib/composerDraftUploads", () => ({ releaseComposerDraftUploads: vi.fn() }));
vi.mock("~/localApi", () => ({
  readLocalApi: () => ({ dialogs: { confirm: deletion.confirm } }),
}));
vi.mock("~/state/session", async (original) => ({
  ...(await original<typeof import("~/state/session")>()),
  readEnvironmentScope: () => true,
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => async () =>
    AsyncResult.success({
      authenticated: true,
      scopes: [AuthOrchestrationOperateScope, AuthSourceControlWriteScope],
      auth: { serverUpdateScope: "environment:maintain" },
    }),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => async () => {
    deletion.commands.push(command);
    return AsyncResult.success(undefined);
  },
}));
vi.mock("~/state/entities", async (original) => {
  const shell = () => ({
    environmentId: "delete-env",
    id: "delete-thread",
    projectId: "delete-project",
    title: "Thread",
    worktreePath: deletion.worktreePath,
    runtime: null,
    session: null,
    latestTurn: null,
  });
  return {
    ...(await original<typeof import("~/state/entities")>()),
    readThreadShell: shell,
    readThreadShells: () => [shell()],
    readEnvironmentThreadRefs: () => [{ environmentId: "delete-env", threadId: "delete-thread" }],
    readProject: () => ({ id: "delete-project", workspaceRoot: "/projects/app" }),
  };
});

describe("deleting a conversation that runs in its project's folder", () => {
  const target = {
    environmentId: EnvironmentId.make("delete-env"),
    threadId: ThreadId.make("delete-thread"),
  };
  beforeEach(() => {
    deletion.commands = [];
    deletion.confirm.mockReset().mockResolvedValue(true);
  });

  it.each(["/Projects/App", "/projects/app/", "/PROJECTS/APP//"])(
    "keeps the project folder recorded as %s",
    async (worktreePath) => {
      deletion.worktreePath = worktreePath;
      expect((await useThreadActions().deleteThread(target))._tag).toBe("Success");
      expect(deletion.confirm).not.toHaveBeenCalled();
      expect(deletion.commands).not.toContain(vcsEnvironment.removeWorktree);
    },
  );

  it("still offers to delete a separate worktree", async () => {
    deletion.worktreePath = "/worktrees/app";
    deletion.confirm.mockResolvedValue(false);
    expect((await useThreadActions().deleteThread(target))._tag).toBe("Success");
    expect(deletion.confirm).toHaveBeenCalledOnce();
    expect(deletion.commands).not.toContain(vcsEnvironment.removeWorktree);
  });
});
