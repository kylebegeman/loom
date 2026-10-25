import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  resume: vi.fn<() => Promise<AtomCommandResult<void, Error>>>(),
  onResumeQueue: null as (() => Promise<void>) | null,
}));

vi.mock("../../lib/uuid", () => ({ uuidv4: () => "uuid" }));
vi.mock("../../state/threads", () => ({
  threadEnvironment: {
    resumeThreadQueue: { label: "resume queue", run: state.resume },
    interruptTurn: {},
    loadEarlierHistory: {},
    mergeBack: {},
    startTurn: {},
  },
}));
vi.mock("../../state/use-thread-selection", () => ({
  useThreadSelection: () => ({
    selectedThread: { environmentId: "computer", id: "thread", title: "Conversation" },
    selectedThreadCreation: null,
    selectedThreadDetailRef: { environmentId: "computer", threadId: "thread" },
    selectedThreadProject: null,
    selectedEnvironmentConnection: null,
  }),
}));
vi.mock("../../state/use-thread-detail", () => ({
  useSelectedThreadDetailState: () => ({
    data: Option.none(),
    error: Option.none(),
    status: "ready",
    history: { hasMoreHistory: false, error: null },
  }),
}));
vi.mock("../../state/use-thread-composer-state", () => ({
  useThreadComposerState: () => ({
    queueHeld: true,
    selectedThreadFeed: [],
    selectedThreadActivityRun: null,
    activeWorkStartedAt: null,
    selectedThreadQueueCount: 0,
  }),
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteConnectionStatus: () => ({ connectionState: "connected" }),
  useRemoteConnections: () => ({}),
  useRemoteEnvironmentRuntime: () => ({ connectionState: "connected" }),
}));
vi.mock("../../state/workspace", () => ({ useConnectionsReady: () => true }));
vi.mock("../../state/shell", () => ({ useEnvironmentShellReadiness: () => ({}) }));
vi.mock("../../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("../../state/use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => ({ selectedThreadCwd: null }),
}));
vi.mock("../../state/use-selected-thread-git-state", () => ({
  useSelectedThreadGitState: () => ({}),
}));
vi.mock("../../state/use-selected-thread-git-actions", () => ({
  useSelectedThreadGitActions: () => ({}),
}));
vi.mock("../../state/use-selected-thread-requests", () => ({
  useSelectedThreadRequests: () => ({}),
}));
vi.mock("../../state/use-vcs-action-state", () => ({
  useGitActionProgress: () => ({}),
  dismissGitActionResult: () => {},
}));
vi.mock("../../state/use-terminal-session", () => ({
  useKnownTerminalSessions: () => ({ sessions: [] }),
}));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { cancelWorktreeSetup: {} } }));
vi.mock("../../state/pending-thread-creation", () => ({
  clearPendingThreadCreationOutcome: () => {},
}));
vi.mock("../../state/recover-failed-thread-draft", () => ({
  recoverFailedThreadDraft: () => {},
}));
vi.mock("../../fork/library/libraryState", () => ({
  library: {},
  useLibraryAuthority: () => ({}),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: ({ children }: { children: ReactNode }) => children,
  ScrollView: () => null,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({}),
  useFocusEffect: () => {},
  StackActions: {},
}));
vi.mock("../../components/ui/Dialog", () => ({}));
vi.mock("../../fork/library/useEmptyConversationLeave", () => ({
  useEmptyConversationLeave: () => undefined, // fork: library
}));
vi.mock("../../components/ui/AppBar", () => ({ AppBar: () => null }));
vi.mock("../../components/ui/EmptyState", () => ({ EmptyState: () => null }));
vi.mock("../../components/LoadingScreen", () => ({ LoadingScreen: () => null }));
vi.mock("../../native/native-glass", () => ({ NATIVE_LIQUID_GLASS_SUPPORTED: false }));
vi.mock("../../native/useOpenPullRequest", () => ({ useOpenPullRequest: () => {} }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeVariables: {} }),
}));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({
    fileInspector: { supported: false },
    layout: { usesSplitView: false },
    panes: { auxiliaryPaneVisible: false },
  }),
  useAdaptiveWorkspacePaneRole: () => {},
  useRegisterWorkspaceInspector: () => {},
}));
vi.mock("../workspace/useAndroidWorkspaceNavigation", () => ({
  useAndroidWorkspaceBack: () => {},
  useWorkspaceBackNavigation: () => {},
}));
vi.mock("../prompt-links/useThreadPromptLink", () => ({ useThreadPromptLink: () => {} }));
vi.mock("../files/thread-file-navigator-pane", () => ({ ThreadFileNavigatorPane: () => null }));
vi.mock("../terminal/terminalLaunchContext", () => ({
  resolvePreferredThreadWorktreePath: () => null,
  stagePendingTerminalLaunch: () => {},
}));
vi.mock("../terminal/terminalDebugLog", () => ({ terminalDebugLog: () => {} }));
vi.mock("./GitActionProgressOverlay", () => ({ GitActionProgressOverlay: () => null }));
vi.mock("./git/GitOverviewSheet", () => ({ GitOverviewSheet: () => null }));
vi.mock("./thread-inspector-content-stack", () => ({ ThreadInspectorContentStack: () => null }));
vi.mock("./ThreadHeader", () => ({ ThreadHeader: () => null }));
vi.mock("./useThreadConversationDetails", () => ({ useThreadConversationDetails: () => {} }));
vi.mock("./use-worktree-setup", () => ({
  useWorktreeSetup: () => ({ snapshot: null, visible: null }),
}));
vi.mock("./ThreadDetailScreen", () => ({
  ThreadDetailScreen: ({ onResumeQueue }: { onResumeQueue: (() => Promise<void>) | null }) => {
    state.onResumeQueue = onResumeQueue;
    return null;
  },
}));

import { ThreadRouteScreen } from "./ThreadRouteScreen";

afterEach(() => {
  vi.restoreAllMocks();
  state.resume.mockReset();
  state.onResumeQueue = null;
});

it("rejects a failed resume command at the recovery callback boundary and permits retry", async () => {
  const failure = new Error("The computer disconnected.");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  state.resume
    .mockResolvedValueOnce(AsyncResult.failure(Cause.fail(failure)))
    .mockResolvedValueOnce(AsyncResult.success(undefined));
  renderToString(
    <ThreadRouteScreen
      route={{
        params: { environmentId: "computer", threadId: "thread" },
      }}
    />,
  );
  const resumeQueue = state.onResumeQueue;
  if (resumeQueue === null) throw new Error("The held queue did not expose recovery.");

  await expect(resumeQueue()).rejects.toBe(failure);
  await expect(resumeQueue()).resolves.toBeUndefined();
  expect(state.resume).toHaveBeenCalledTimes(2);
  expect(state.resume).toHaveBeenLastCalledWith(expect.anything(), {
    environmentId: EnvironmentId.make("computer"),
    input: { threadId: ThreadId.make("thread") },
  });
});
