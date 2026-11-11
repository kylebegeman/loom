import type { AppBarMenuItem, AppBarProps } from "../../components/ui/AppBar.types";
import type { VcsStatusResult } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  renderedBars: [] as AppBarProps[],
  navigatedRoutes: [] as string[],
  // fork: source-control-cockpit
  skipDefaultBranchConfirmation: false,
  runActions: [] as string[],
  recoveryRequests: [] as VcsStatusResult[],
  platform: "ios",
  splitView: false,
  sidebarVisible: false,
}));

vi.mock("@react-navigation/native", async () => {
  const { createContext } = await import("react");
  const navigation = {
    canGoBack: () => true,
    dispatch: () => {},
    goBack: () => {},
    navigate: (route: string) => {
      harness.navigatedRoutes.push(route);
    },
    addListener: () => () => {},
    setOptions: () => {},
  };
  return {
    NavigationContext: createContext<typeof navigation | undefined>(navigation),
    NavigationRouteContext: createContext<{ readonly key: string } | undefined>(undefined),
    StackActions: { replace: () => ({}) },
    useNavigation: () => navigation,
  };
});
// fork: source-control-cockpit -- the native-header harness owns selection and composer boundaries.
vi.mock("../../state/use-thread-selection", () => ({
  useThreadSelection: () => ({
    selectedThreadProject: { id: "project-1" },
    selectedEnvironmentRuntime: {
      serverConfig: {
        settings: {
          projectSettingsOverrides: {
            "project-1": { skipDefaultBranchConfirmation: harness.skipDefaultBranchConfirmation },
          },
        },
      },
    },
  }),
}));
vi.mock("../../fork/source-control-cockpit/GitRecovery", () => ({
  useGitRecoveryPrompt: () => (status: VcsStatusResult) => harness.recoveryRequests.push(status),
}));

vi.mock("../../native/useOpenPullRequest", () => ({ useOpenPullRequest: () => () => {} }));

vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../components/ui/AppBar", () => ({
  AppBar: (props: AppBarProps) => {
    harness.renderedBars.push(props);
    return null;
  },
}));
vi.mock("react-native", () => ({
  Alert: { alert: () => {} },
  Linking: {},
  Platform: {
    get OS() {
      return harness.platform;
    },
  },
}));
vi.mock("../../native/native-layout-metrics", () => ({ useDeviceType: () => "phone" }));
vi.mock("../layout/AdaptiveWorkspaceLayout", () => ({
  useAdaptiveWorkspaceLayout: () => ({
    layout: { usesSplitView: harness.splitView },
    togglePrimarySidebar: () => {},
    toggleAuxiliaryPane: () => {},
    startNewTask: () => {},
  }),
  useWorkspacePaneState: () => ({
    panes: { primarySidebarVisible: harness.sidebarVisible, auxiliaryPaneVisible: false },
  }),
}));
vi.mock("../layout/workspace/useAndroidWorkspaceNavigation", () => ({
  useWorkspaceBackNavigation: () => () => {},
}));
vi.mock("../layout/native-mail-search-toolbar", () => ({
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED: true,
  createNativeMailSearchToolbarItem: () => ({}),
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeVariables: {} }),
}));

import { ThreadHeader } from "./ThreadHeader";

const projectScripts: never[] = [];

function status(
  files: ReadonlyArray<string>,
  overrides: Partial<VcsStatusResult> = {},
): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: true,
    refName: "master",
    hasWorkingTreeChanges: files.length > 0,
    workingTree: {
      files: files.map((path) => ({ path, insertions: 0, deletions: 0 })),
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  } as unknown as VcsStatusResult;
}

function Header(props: {
  readonly gitStatus: VcsStatusResult | null;
  readonly title?: string;
  readonly onOpenDetails?: () => void;
  readonly canOpenTerminal?: boolean;
}) {
  return (
    <ThreadHeader
      title={props.title ?? "Thread"}
      subtitle=""
      onOpenDetails={props.onOpenDetails}
      gitControls={{
        environmentId: "environment-1",
        threadId: "thread-1",
        currentBranch: "master",
        gitStatus: props.gitStatus,
        gitOperationLabel: null,
        onPull: async () => {},
        // fork: source-control-cockpit
        onRunAction: async (input) => {
          harness.runActions.push(input.action);
          return null;
        },
        canOpenTerminal: props.canOpenTerminal ?? true,
        canOperateTerminal: true,
        canOpenFiles: true,
        projectScripts,
        terminalSessions: [],
        onOpenTerminal: () => {},
        onOpenNewTerminal: () => {},
        onRunProjectScript: async () => {},
      }}
      hasThreadCwd
      inspectorMode={null}
      onOpenFilesInspector={() => {}}
    />
  );
}

function renderedToolMenuItems(title: string): Extract<AppBarMenuItem, { onPress: unknown }>[] {
  const tools = harness.renderedBars.at(-1)?.menus?.find((menu) => menu.title === "Thread tools");
  const submenu = tools?.items.find((item) => item.title === title && "items" in item);
  return (submenu && "items" in submenu ? submenu.items : []).flatMap((item) =>
    "onPress" in item ? [item] : [],
  );
}

function renderedGitMenuItems() {
  return renderedToolMenuItems("Source control");
}

let root: Root | null = null;

function render(element: React.ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root ??= createRoot(document.createElement("div"));
  act(() => root!.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  harness.renderedBars = [];
  harness.navigatedRoutes = [];
  // fork: source-control-cockpit
  harness.skipDefaultBranchConfirmation = false;
  harness.runActions = [];
  harness.recoveryRequests = [];
  harness.platform = "ios";
  harness.splitView = false;
  harness.sidebarVisible = false;
});

describe("ThreadHeader", () => {
  it("keeps terminal actions unavailable under Tools without terminal access", () => {
    render(<Header gitStatus={null} canOpenTerminal={false} />);
    expect(renderedToolMenuItems("Terminal")).toEqual([]);
    expect(renderedGitMenuItems().length).toBeGreaterThan(0);
  });

  it.each(["android", "ios"])("keeps direct menus on %s beside a visible sidebar", (platform) => {
    harness.platform = platform;
    harness.splitView = true;
    harness.sidebarVisible = true;
    render(<Header gitStatus={null} />);
    expect(harness.renderedBars.at(-1)?.menus?.map((menu) => menu.title)).toEqual([
      "Git controls",
      "Terminal",
    ]);
    expect(harness.renderedBars.at(-1)?.onCompose).toBeUndefined();

    harness.sidebarVisible = false;
    render(<Header gitStatus={null} />);
    expect(harness.renderedBars.at(-1)?.onCompose).toBeTypeOf("function");
  });

  // fork: source-control-cockpit
  it("runs a default-branch push directly after the project remembers consent", async () => {
    harness.skipDefaultBranchConfirmation = true;
    render(<Header gitStatus={status([], { aheadCount: 1, hasPrimaryRemote: true })} />);
    await act(async () => renderedGitMenuItems()[1]?.onPress?.());
    expect(harness.navigatedRoutes).toEqual([]);
    expect(harness.runActions).toEqual(["commit_push"]);
  });

  it("offers recovery while a rebase has detached HEAD", async () => {
    const conflicts = status(["conflict.ts"], {
      refName: null,
      operation: "rebase",
      unmergedCount: 1,
      unmergedPaths: ["conflict.ts"],
    });
    render(<Header gitStatus={conflicts} />);
    const recovery = renderedGitMenuItems().find(
      (item) => item.title === "Rebase in progress, 1 conflict",
    );
    expect(recovery?.disabled).toBe(false);
    await act(async () => recovery?.onPress?.());
    expect(harness.recoveryRequests).toEqual([conflicts]);
    expect(harness.runActions).toEqual([]);
  });

  it("keeps conversation details reachable without files or Git status", () => {
    const open = vi.fn();
    render(<Header gitStatus={null} onOpenDetails={open} />);
    const details = harness.renderedBars
      .at(-1)
      ?.actions?.find((item) => item.accessibilityLabel === "Conversation details");
    expect(details?.accessibilityLabel).toBe("Conversation details");
    act(() => (details?.onPress as (() => void) | undefined)?.());
    expect(open).toHaveBeenCalledOnce();
    const next = vi.fn();
    render(<Header gitStatus={null} onOpenDetails={next} />);
    act(() =>
      harness.renderedBars
        .at(-1)
        ?.actions?.find((item) => item.accessibilityLabel === "Conversation details")
        ?.onPress(),
    );
    expect(next).toHaveBeenCalledOnce();
  });
  it("opens checkpoint review for a multi-repository parent while keeping Git actions unavailable", () => {
    render(<Header gitStatus={status([], { isRepo: false, checkpointCapable: true })} />);
    const review = renderedGitMenuItems().find((item) => item.title === "Review changes");
    expect(review?.disabled).toBe(false);
    expect(renderedGitMenuItems().find((item) => item.title === "Git unavailable")?.disabled).toBe(
      true,
    );
    act(() => review?.onPress?.());
    expect(harness.navigatedRoutes).toEqual(["ThreadReview"]);
    render(<Header gitStatus={status([], { isRepo: false, checkpointCapable: false })} />);
    expect(renderedGitMenuItems().find((item) => item.title === "Review changes")?.disabled).toBe(
      true,
    );
  });

  // fork: source-control-cockpit -- without remembered consent, a default-branch push still asks.
  it("re-applies menu actions when the default ref changes behind the same label", async () => {
    const pushable = (isDefaultRef: boolean) =>
      status([], {
        isDefaultRef,
        aheadCount: 1,
        hasPrimaryRemote: true,
        pr: { state: "open", url: "https://example.com/pr/1" },
      } as Partial<VcsStatusResult>);
    render(<Header gitStatus={pushable(false)} />);
    expect(renderedGitMenuItems()[1]?.title).toBe("Push");

    render(<Header gitStatus={pushable(true)} />);
    expect(renderedGitMenuItems()[1]?.title).toBe("Push");
    await act(async () => renderedGitMenuItems()[1]?.onPress?.());
    expect(harness.navigatedRoutes).toEqual(["GitConfirm"]);
  });
});
