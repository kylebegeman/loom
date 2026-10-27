import {
  AuthOrchestrationOperateScope,
  EnvironmentId,
  ProjectId, // fork: library-projects
  ProviderInstanceId, // fork: library-projects
  ThreadId,
  type ContextMenuItem,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ThreadActionMenuId } from "../components/threadActionMenu.logic";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

const state = vi.hoisted(() => ({
  granted: new Set<string>(),
  effects: [] as string[],
  completed: deferred<void>(),
  createThread: vi.fn(), // fork: library-projects
  worktreePath: null as string | null, // fork: library-projects
  show: vi.fn<
    (
      items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>>,
      position: { x: number; y: number },
    ) => Promise<ThreadActionMenuId | null>
  >(),
}));

function recordEffect(action: string) {
  state.effects.push(action);
  state.completed.resolve();
}

// fork: workspace-handoff
vi.mock("~/fork/workspace-handoff/state", () => ({
  openWorkspaceHandoff: () => recordEffect("workspace-handoff"),
}));
// fork: bots
vi.mock("~/fork/bots/fromThread/state", () => ({
  openSaveAsBot: () => recordEffect("save-as-bot"),
  threadCanBeSavedAsBot: () => false,
}));
// fork: workspace-handoff
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => new Map() } }));
vi.mock("~/state/server", () => ({ environmentServerConfigsAtom: {} })); // fork: workspace-handoff
vi.mock("../components/CustomSnoozeDialog", () => ({ requestCustomSnooze: vi.fn() }));
vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ navigate: async () => recordEffect("project-settings") }),
}));
vi.mock("../state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.granted.has(environmentId),
}));
vi.mock("../state/entities", () => ({
  readEnvironmentSupportsAutoSettleOptOut: () => true,
  readEnvironmentSupportsPinning: () => true,
  readEnvironmentSupportsSettlement: () => true,
  readEnvironmentSupportsSnooze: () => true,
  readEnvironmentSupportsTitleRegeneration: () => true,
  readThreadShell: () => ({
    id: "thread",
    environmentId: "secondary",
    projectId: "project",
    title: "Thread",
    branch: "main",
    // fork: library-projects
    worktreePath: state.worktreePath,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "source-model",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    runtimeMode: "full-access",
    interactionMode: "plan",
    runtime: null,
    latestRun: null,
  }),
  useProjects: () => [{ id: "project", environmentId: "secondary" }],
}));
vi.mock("../state/environments", () => ({ usePrimaryEnvironmentId: () => "primary" }));
vi.mock("../state/threads", () => ({ threadEnvironment: { updateMetadata: "metadata" } }));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: () => async () => {
    recordEffect("metadata");
    return AsyncResult.success(undefined);
  },
}));
vi.mock("../localApi", () => ({
  readLocalApi: () => ({
    contextMenu: { show: state.show, close: () => {} },
    dialogs: {
      confirm: async () => {
        recordEffect("confirm");
        return false;
      },
    },
  }),
}));
vi.mock("../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: () => "project",
  derivePhysicalProjectKey: () => "project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("../sidebarProjectGrouping", () => ({
  buildPhysicalToLogicalProjectKeyMap: () => new Map(),
}));
vi.mock("../uiStateStore", () => ({
  useUiStateStore: (select: (store: unknown) => unknown) =>
    select({
      markThreadUnread: () => recordEffect("mark-unread"),
    }),
}));
vi.mock("../components/ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: () => state.completed.resolve() },
}));
vi.mock("../components/Sidebar.snooze", () => ({
  resolveSnoozePresets: () => [
    { id: "hour", label: "In 1 hour", whenLabel: "3 PM", snoozedUntil: "2099-01-01T00:00:00Z" },
  ],
  snoozeWakeDescription: () => "later",
}));
vi.mock("./useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: () => recordEffect("copy") }),
}));
vi.mock("./useHandleNewThread", () => ({
  useNewThreadHandler: () => state.createThread, // fork: library-projects
}));
vi.mock("./useSettings", () => ({
  useClientSettings: (select: (settings: unknown) => unknown) =>
    select({
      confirmThreadDelete: true,
      confirmThreadArchive: true,
      timestampFormat: "12-hour",
    }),
}));
vi.mock("./useThreadActions", () => ({
  useThreadActions: () =>
    Object.fromEntries(
      [
        "markThreadUnread",
        "settleThread",
        "unsettleThread",
        "snoozeThread",
        "unsnoozeThread",
        "pinThread",
        "confirmAndUnpinThread",
        "archiveThread",
        "deleteThread",
      ].map((action) => [
        action,
        async () => {
          recordEffect(action === "markThreadUnread" ? "mark-unread" : action);
          return AsyncResult.success(undefined);
        },
      ]),
    ),
}));

import { useThreadActionMenu } from "./useThreadActionMenu";

const target = {
  environmentId: EnvironmentId.make("secondary"),
  threadId: ThreadId.make("thread"),
};
const position = { x: 10, y: 20 };
const createMenu = () =>
  useThreadActionMenu({
    threadRef: target,
    projectCwd: "/project",
    onStartRename: () => recordEffect("rename"),
    canShareWithGuest: false,
  });

beforeEach(() => {
  state.granted = new Set(["primary"]);
  state.effects = [];
  state.completed = deferred<void>();
  // fork: library-projects
  state.worktreePath = null;
  state.createThread.mockReset().mockImplementation(async () => recordEffect("draft"));
  state.show.mockReset().mockResolvedValue(null);
});

describe("thread menu permissions", () => {
  it.each([
    "rename",
    "regenerate-title",
    "delete",
    "pin",
    "settle",
    "archive",
    "workspace-handoff", // fork: workspace-handoff
  ] as const)("%s rechecks after the native menu closes", async (action) => {
    state.granted.add("secondary");
    const choice = deferred<ThreadActionMenuId | null>();
    state.show.mockReturnValue(choice.promise);
    createMenu().openMenu(position);
    state.granted.delete("secondary");
    choice.resolve(action);
    await state.completed.promise;
    expect(state.effects).toEqual([]);
  });
});

// fork: library-projects
describe("new thread on branch", () => {
  it.each([null, "/project/checkouts/feature"])(
    "preserves the selected thread's checkout and settings for %s",
    async (worktreePath) => {
      state.worktreePath = worktreePath;
      state.show.mockResolvedValue("new-thread-on-branch");
      createMenu().openMenu(position);
      await state.completed.promise; // fork: library-projects

      expect(state.createThread).toHaveBeenCalledExactlyOnceWith(
        { environmentId: target.environmentId, projectId: ProjectId.make("project") },
        {
          branch: "main",
          worktreePath,
          envMode: worktreePath ? "worktree" : "local",
          startFromOrigin: false,
          environmentSelection: "manual",
          sourceSettings: expect.objectContaining({
            modelSelection: {
              instanceId: ProviderInstanceId.make("codex"),
              model: "source-model",
              options: [{ id: "reasoningEffort", value: "high" }],
            },
            runtimeMode: "full-access",
            interactionMode: "plan",
          }),
        },
      );
    },
  );
});
