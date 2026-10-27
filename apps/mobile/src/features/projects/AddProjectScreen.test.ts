// fork: project-home - Verify preparation retains its request after response loss and preserves normal cloning.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeModule from "node:module";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { workspaceDetailRouter } from "../workspace/workspace-detail-selection";
import type { NavigationState } from "@react-navigation/native";
// fork: project-home
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  EnvironmentId,
  ProjectId,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option"; // fork: fleet-connections
import { AsyncResult } from "effect/reactivity";
import { act, createElement, isValidElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  scopes: new Set<string>(),
  otherScopes: new Set<string>(), // fork: fleet-connections
  baseDirectory: "",
  projects: [] as string[],
  // fork: fleet-connections
  createRequests: [] as { environmentId: string; workspaceRoot: string }[],
  newProjectName: "",
  newProjectRequests: [] as { environmentId: string; name: string }[],
  publishRequests: [] as { environmentId: string; cwd: string }[],
  newProjectPublishes: false,
  offerPublishTarget: false,
  revokePublishAfterCreate: false,
  checkDirectories: false,
  // fork: project-home
  connected: true,
  disconnectAfterReceiptSave: false,
  revokeAfterReceiptSave: false,
  failReceiptSave: false,
  cloneSnapshots: [] as ProjectCloneSnapshot[],
  navigationRequests: [] as { route: string; params: unknown }[],
  preparationReceipts: {} as Record<
    string,
    import("../../fork/project-home/projectPreparationReceipt").ProjectPreparationReceipt | null
  >,
  trackedCloneRequests: [] as {
    environmentId: string;
    // fork: project-home
    input: {
      projectId: string;
      title: string;
      createdAt: string;
      remoteUrl: string;
      destinationPath: string;
    };
  }[],
  existingProjects: [] as EnvironmentProject[], // fork: project-home
  createResult: null as Promise<unknown> | null,
  cloneResult: null as Promise<unknown> | null,
  createNewResult: null as Promise<unknown> | null,
  startCloneResult: null as Promise<unknown> | null,
  connectionStates: {} as Record<string, EnvironmentConnectionPhase>,
  newProjectsRoot: null as string | null,
  supportsCloneTracking: false,
  waitForProject: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
  navigationState: undefined as NavigationState | undefined,
  environments: [{ environmentId: "environment", environmentLabel: "Environment" }],
}));

function loadRouters() {
  const requireNavigation = NodeModule.createRequire(
    NodeModule.createRequire(import.meta.url).resolve("@react-navigation/native/package.json"),
  );
  return requireNavigation("@react-navigation/routers") as {
    StackRouter: typeof import("@react-navigation/native").StackRouter;
    StackActions: typeof import("@react-navigation/native").StackActions;
    CommonActions: typeof import("@react-navigation/native").CommonActions;
  };
}

vi.mock("../workspace/useSelectWorkspaceDetail", async () => {
  const { selectWorkspaceDetail } = await import("../workspace/workspace-detail-selection");
  return {
    useSelectWorkspaceDetail: () => (detail: Parameters<typeof selectWorkspaceDetail>[0]) =>
      state.dispatch(selectWorkspaceDetail(detail)),
  };
});
vi.mock("../../native/StackHeader", () => ({
  nativeHeaderScrollEdgeEffects: () => undefined,
}));
vi.mock("../../components/ui/NavigationRow", () => ({ NavigationRow: "NavigationRow" }));
vi.mock("../../components/ui/Button", () => ({ Button: "Button" }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: "ScrollView" }));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: "SettingsScreen" }));
vi.mock("../../components/ui/ThemedSwitch", () => ({ ThemedSwitch: "Switch" }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: state.alert },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    // fork: project-home
    navigate: (route: string, params: unknown) => state.navigationRequests.push({ route, params }),
    dispatch: state.dispatch,
    getState: () =>
      state.navigationState ?? {
        index: 4,
        routes: [
          { key: "home", name: "Home" },
          { key: "draft", name: "Thread", params: { draft: {} } },
          { key: "picker", name: "NewTaskProject" },
          { key: "add", name: "AddProject" },
          { key: "local", name: "AddProjectLocal" },
        ],
      },
  }),
  CommonActions: { reset: (input: unknown) => input },
  StackActions: {
    push: (name: string, params: unknown) => ({ type: "PUSH", payload: { name, params } }),
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../../components/ui/AppText", () => ({ AppText: "Text", AppTextInput: "TextInput" }));
vi.mock("../../components/EnvironmentMachineSymbol", () => ({
  EnvironmentMachineSymbol: "EnvironmentMachineSymbol",
}));
vi.mock("../../components/ui/ErrorBanner", () => ({ ErrorBanner: "ErrorBanner" }));
vi.mock("./SourceControlIcon", () => ({ SourceControlIcon: "SourceControlIcon" }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "project" }));
vi.mock("../../state/session", () => ({
  // fork: fleet-connections
  useEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "other-environment" ? state.otherScopes : state.scopes).has(scope),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "other-environment" ? state.otherScopes : state.scopes).has(scope),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => state.existingProjects,
  waitForProject: state.waitForProject,
  useServerConfigs: () =>
    new Map([
      [
        "environment",
        {
          environment: {
            platform: { os: "linux" },
            capabilities: { projectCloneTracking: state.supportsCloneTracking },
          },
          newProjectsRoot: state.newProjectsRoot,
          settings: { addProjectBaseDirectory: state.baseDirectory },
        },
      ],
      // fork: fleet-connections
      [
        "other-environment",
        {
          environment: {
            platform: { os: "linux" },
            capabilities: { projectCloneTracking: state.supportsCloneTracking },
          },
          settings: { addProjectBaseDirectory: state.baseDirectory },
          newProjectsRoot: state.newProjectsRoot,
        },
      ],
    ]),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteEnvironmentRuntime: () => ({ connectionState: "connected" }),
  useRemoteConnectionStatus: () => ({
    connectedEnvironments: state.environments.map((environment) => ({
      environmentId: environment.environmentId,
      connectionState: state.connectionStates[environment.environmentId] ?? "connected",
    })),
  }),
  useSavedRemoteConnections: () => ({
    savedConnectionsById: Object.fromEntries(
      state.environments.map((environment) => [environment.environmentId, environment]),
    ),
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => () => {} }));
// fork: project-home
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) =>
    atom === "project-clones"
      ? { data: state.cloneSnapshots, isSuccess: true }
      : {
          // fork: fleet-connections
          data: state.offerPublishTarget
            ? {
                versionControlSystems: [],
                sourceControlProviders: [
                  {
                    kind: "github",
                    label: "GitHub",
                    status: "available",
                    installHint: "",
                    version: Option.none(),
                    detail: Option.none(),
                    auth: {
                      status: "authenticated",
                      account: Option.none(),
                      host: Option.none(),
                      detail: Option.none(),
                    },
                  },
                ],
              }
            : null,
        },
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: true, presentation: null }),
  // fork: project-home
  environmentPresentations: { presentationAtom: () => "presentation" },
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    get: () => ({
      entry: { enabled: true },
      connection: { phase: state.connected ? "connected" : "offline" },
    }),
  },
}));
vi.mock("../../state/filesystem", () => ({ filesystemEnvironment: {} }));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: {
    projectClones: () => "project-clones", // fork: project-home
    discovery: (input: unknown) => input,
    // fork: project-home
    startProjectClone: async (request: {
      environmentId: string;
      input: {
        projectId: string;
        title: string;
        createdAt: string;
        remoteUrl: string;
        destinationPath: string;
      };
    }) => {
      if (state.startCloneResult) return state.startCloneResult;
      state.trackedCloneRequests.push(request);
      state.existingProjects.push({
        environmentId: EnvironmentId.make(request.environmentId),
        id: ProjectId.make(request.input.projectId),
        title: request.input.title,
        workspaceRoot: request.input.destinationPath,
        repositoryIdentity: null,
        defaultModelSelection: null,
        scripts: [],
        createdAt: request.input.createdAt,
        updatedAt: request.input.createdAt,
      });
      return AsyncResult.failure(
        Cause.fail(new Error("Connection lost after the project was saved")),
      );
    },
    // fork: fleet-connections
    publishRepository: async (request: { environmentId: string; input: { cwd: string } }) => {
      state.publishRequests.push({ environmentId: request.environmentId, cwd: request.input.cwd });
      return AsyncResult.success(undefined);
    },
    cloneRepository: async ({ input }: { input: { destinationPath: string } }) => {
      if (state.cloneResult) return state.cloneResult;
      NodeFS.mkdirSync(input.destinationPath);
      return AsyncResult.success({ cwd: input.destinationPath });
    },
  },
}));
// fork: project-home
vi.mock("../../fork/project-home/useProjectPreparationReceipt", () => ({
  useProjectPreparationReceipt: (key: string | null) => ({
    loaded: true,
    invalid: false,
    receipt: key ? (state.preparationReceipts[key] ?? null) : null,
    save: async (
      receipt: import("../../fork/project-home/projectPreparationReceipt").ProjectPreparationReceipt,
    ) => {
      if (state.failReceiptSave) throw new Error("Preferences could not be saved");
      const { recordPreparationReceipt } =
        await import("../../fork/project-home/projectPreparationReceipt");
      state.preparationReceipts = recordPreparationReceipt(state.preparationReceipts, receipt);
      if (state.disconnectAfterReceiptSave) state.connected = false;
      if (state.revokeAfterReceiptSave) state.scopes.delete(AuthOrchestrationOperateScope);
    },
  }),
}));
vi.mock("../../state/projects", () => ({
  projectEnvironment: {
    // fork: fleet-connections
    createNew: (request: { environmentId: string; input: { name: string } }) => {
      state.newProjectRequests.push({
        environmentId: request.environmentId,
        name: request.input.name,
      });
      if (state.revokePublishAfterCreate) state.scopes.delete(AuthSourceControlWriteScope);
      return (
        state.createNewResult ??
        Promise.resolve(
          AsyncResult.success({
            projectId: "project",
            workspaceRoot: `${state.baseDirectory}/project`,
          }),
        )
      );
    },
    create: ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { workspaceRoot: string; createWorkspaceRootIfMissing: boolean };
    }) => {
      state.createRequests.push({ environmentId, workspaceRoot: input.workspaceRoot });
      const scopes = environmentId === "other-environment" ? state.otherScopes : state.scopes;
      if (!scopes.has(AuthOrchestrationOperateScope)) {
        return Promise.resolve(
          AsyncResult.failure(Cause.fail(new Error("Project creation denied"))),
        );
      }
      // fork: fleet-connections
      if (state.checkDirectories && !NodeFS.existsSync(input.workspaceRoot)) {
        if (!input.createWorkspaceRootIfMissing) {
          return Promise.resolve(
            AsyncResult.failure(Cause.fail(new Error("Folder does not exist"))),
          );
        }
        NodeFS.mkdirSync(input.workspaceRoot, { recursive: true });
      }
      state.projects.push(input.workspaceRoot);
      return state.createResult ?? Promise.resolve(AsyncResult.success(undefined));
    },
  },
}));

vi.mock("../../state/use-composer-drafts", () => ({
  waitForComposerDraftsLoaded: async () => {},
  createNewTaskDraft: () => "prompt-draft",
  setComposerDraftText: () => {},
}));

import {
  AddProjectNewScreen,
  AddProjectDestinationScreen,
  AddProjectLocalFolderScreen,
  AddProjectSourceScreen,
} from "./AddProjectScreen";
import { AddProjectSourceRoute } from "./AddProjectSourceRoute";

function findAction(
  node: ReactNode,
  label: string,
  includeDisabled = false,
): (() => unknown) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const action = findAction(child, label, includeDisabled);
      if (action) return action;
    }
    return null;
  }
  if (
    !isValidElement<{
      label?: string;
      title?: string;
      onPress?: () => unknown;
      disabled?: boolean;
      children?: ReactNode;
    }>(node)
  ) {
    return null;
  }
  if ((node.props.label ?? node.props.title) === label) {
    return node.props.disabled && !includeDisabled ? null : (node.props.onPress ?? null);
  }
  return findAction(node.props.children, label, includeDisabled);
}

const mountedRoots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
});
function renderScreen(render: () => ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement("div"));
  mountedRoots.push(root);
  let screen: ReactNode;
  function Observer() {
    screen = render();
    return null;
  }
  act(() => root.render(createElement(Observer)));
  return screen;
}

function cloneAction() {
  const action = findAction(
    renderScreen(() =>
      AddProjectDestinationScreen({
        environmentId: "environment",
        remoteUrl: "https://example.com/repo.git",
        repositoryName: "repo",
      }),
    ),
    "Clone project",
    true,
  );
  if (!action) throw new Error("Clone action missing");
  return action;
}

// fork: fleet-connections -- upstream pruned this helper; the existing-folder tests below still use it
function localProjectAction(environmentId = "environment") {
  const action = findAction(
    renderScreen(() => AddProjectLocalFolderScreen({ environmentId })),
    "Open folder",
    true,
  );
  if (!action) throw new Error("Open folder action missing");
  return action;
}

// fork: project-home
function destinationScreen(params: Parameters<typeof AddProjectDestinationScreen>[0]) {
  return renderScreen(() => AddProjectDestinationScreen(params));
}

function resetForkNavigation() {
  state.navigationState = undefined;
  state.navigationRequests = [];
  state.dispatch.mockReset();
  state.waitForProject.mockReset();
  state.waitForProject.mockImplementation(async () => ({ title: state.newProjectName }));
}

describe("reviewed project preparation", () => {
  beforeEach(() => {
    state.supportsCloneTracking = true;
    state.connected = true;
    state.disconnectAfterReceiptSave = false;
    state.revokeAfterReceiptSave = false;
    state.failReceiptSave = false;
    state.cloneSnapshots = [];
    resetForkNavigation();
    state.scopes = new Set([AuthSourceControlWriteScope, AuthOrchestrationOperateScope]);
    state.existingProjects = [];
    state.trackedCloneRequests = [];
    state.preparationReceipts = {};
    state.baseDirectory = "/prepared/projects";
    state.newProjectsRoot = state.baseDirectory;
  });
  afterEach(() => {
    state.supportsCloneTracking = false;
    state.connected = true;
    state.cloneSnapshots = [];
    state.existingProjects = [];
    state.newProjectsRoot = null;
  });
  const params = {
    environmentId: "environment",
    remoteUrl: "https://example.com/team/repo.git",
    repositoryName: "repo",
    repositoryTitle: "My project",
    preparationSourceEnvironmentId: "source",
    preparationSourceProjectId: "source-project",
    preparationProjectId: "stable-project",
    preparationCreatedAt: "2026-10-13T12:00:00.000Z",
    preparationRepositoryKey: "example.com/team/repo",
  };
  it("submits the reviewed preparation folder instead of the ordinary clone base directory", async () => {
    const reviewedPath = "/owned-ssd/projects/repo";
    const start = findAction(
      destinationScreen({ ...params, preparationDestinationPath: reviewedPath }),
      "Clone project",
      true,
    );
    if (!start) throw new Error("Missing preparation clone action");
    await start();
    expect(state.trackedCloneRequests[0]?.input.destinationPath).toBe(reviewedPath);
    const receipt = Object.values(state.preparationReceipts)[0];
    expect(receipt?.destinationPath).toBe(reviewedPath);
    // A restarted device may need to replay the saved ID before its project cache catches up.
    state.existingProjects = [];
    const reopen = findAction(
      destinationScreen({
        ...params,
        preparationProjectId: "regenerated-project",
        preparationDestinationPath: "/different/proposal",
      }),
      "Clone project",
      true,
    );
    if (!reopen) throw new Error("Missing saved preparation action");
    await reopen();
    expect(state.trackedCloneRequests[1]?.input).toEqual(state.trackedCloneRequests[0]?.input);
    expect(Object.values(state.preparationReceipts)[0]).toEqual(receipt);
  });
  it("retains the exact request identity when the start response is lost and avoids creating another checkout", async () => {
    const first = findAction(destinationScreen(params), "Clone project", true);
    if (!first) throw new Error("Missing preparation clone action");
    await first();
    expect(state.trackedCloneRequests).toHaveLength(1);
    expect(state.trackedCloneRequests[0]?.input).toMatchObject({
      projectId: "stable-project",
      title: "My project",
      createdAt: params.preparationCreatedAt,
    });
    const retry = findAction(destinationScreen(params), "Clone project", true);
    if (!retry) throw new Error("Missing retained preparation action");
    await retry();
    expect(state.trackedCloneRequests).toHaveLength(1);
    expect(state.existingProjects).toHaveLength(1);
    const receipt = Object.values(state.preparationReceipts)[0];
    expect(receipt).toMatchObject({
      projectId: "stable-project",
      destinationPath: "/prepared/projects/repo",
      remoteUrl: params.remoteUrl,
    });
    const reopened = findAction(
      destinationScreen({
        ...params,
        preparationProjectId: "new-after-restart",
        remoteUrl: "https://example.com/other.git",
      }),
      "Clone project",
      true,
    );
    if (!reopened) throw new Error("Missing reopened preparation action");
    await reopened();
    expect(state.trackedCloneRequests).toHaveLength(1);
    expect(Object.values(state.preparationReceipts)[0]).toEqual(receipt);
  });
  it.each(["origin", "project-path", "clone-path"] as const)(
    "routes a known %s mismatch to manual review instead of clone Retry",
    async (mismatch) => {
      const start = findAction(destinationScreen(params), "Clone project", true);
      if (!start) throw new Error("Missing preparation action");
      await start();
      const project = state.existingProjects[0];
      if (!project) throw new Error("Missing saved project");
      state.existingProjects = [
        {
          ...project,
          workspaceRoot: mismatch === "project-path" ? "/another/path" : project.workspaceRoot,
          repositoryIdentity:
            mismatch === "origin"
              ? {
                  rootPath: project.workspaceRoot,
                  canonicalKey: "example.com/team/other",
                  locator: {
                    source: "git-remote",
                    remoteName: "origin",
                    remoteUrl: "https://example.com/team/other.git",
                  },
                }
              : null,
        },
      ];
      state.cloneSnapshots = [
        {
          projectId: project.id,
          remoteUrl: params.remoteUrl,
          destinationPath: mismatch === "clone-path" ? "/another/path" : project.workspaceRoot,
          repository: null,
          phase: "failed",
          stage: "receiving",
          percent: 50,
          detail: null,
          error: "Interrupted",
          startedAt: params.preparationCreatedAt,
          endedAt: null,
          sequence: 1,
        },
      ];
      const screen = destinationScreen(params);
      expect(findAction(screen, "Open clone progress", true)).toBeNull();
      const inspect = findAction(screen, "Review saved project", true);
      if (!inspect) throw new Error("Missing manual recovery review");
      await inspect();
      expect(state.dispatch).not.toHaveBeenCalled();
      expect(state.navigationRequests).toEqual([
        {
          route: "ProjectHome",
          params: { environmentId: project.environmentId, projectId: project.id },
        },
      ]);
      expect(state.trackedCloneRequests).toHaveLength(1);
    },
  );
  it.each(["disconnect", "grant-revoked", "save-failed"] as const)(
    "starts no clone when receipt persistence ends with %s",
    async (condition) => {
      state.disconnectAfterReceiptSave = condition === "disconnect";
      state.revokeAfterReceiptSave = condition === "grant-revoked";
      state.failReceiptSave = condition === "save-failed";
      const start = findAction(destinationScreen(params), "Clone project", true);
      if (!start) throw new Error("Missing preparation action");
      await start();
      expect(state.trackedCloneRequests).toEqual([]);
      expect(state.existingProjects).toEqual([]);
    },
  );
  it("does not treat a partial preparation source as an ordinary clone", async () => {
    const start = findAction(
      destinationScreen({
        environmentId: params.environmentId,
        remoteUrl: params.remoteUrl,
        repositoryName: params.repositoryName,
        preparationSourceEnvironmentId: params.preparationSourceEnvironmentId,
      }),
      "Clone project",
      true,
    );
    if (!start) throw new Error("Missing clone action");
    await start();
    expect(state.trackedCloneRequests).toEqual([]);
  });
  it("rechecks both destination grants after the reviewed form is opened", async () => {
    const action = findAction(destinationScreen(params), "Clone project", true);
    if (!action) throw new Error("Missing preparation action");
    state.scopes.delete(AuthOrchestrationOperateScope);
    await action();
    expect(state.trackedCloneRequests).toEqual([]);
  });
});

describe("clone project permissions", () => {
  beforeEach(async () => {
    state.baseDirectory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-clone-permissions-"),
    );
    state.scopes = new Set([AuthSourceControlWriteScope]);
    state.projects = [];
    state.createResult = null;
  });

  afterEach(async () => {
    await NodeFSP.rm(state.baseDirectory, { recursive: true, force: true });
  });

  it("does not leave a clone on disk when project creation is denied", async () => {
    await cloneAction()();

    expect(NodeFS.existsSync(NodePath.join(state.baseDirectory, "repo"))).toBe(false);
    expect(state.projects).toEqual([]);
  });

  it.each([AuthSourceControlWriteScope, AuthOrchestrationOperateScope])(
    "rechecks %s before a retained clone action creates a directory",
    async (scope) => {
      state.scopes.add(AuthOrchestrationOperateScope);
      const submit = cloneAction();
      state.scopes.delete(scope);
      await submit();

      expect(NodeFS.existsSync(NodePath.join(state.baseDirectory, "repo"))).toBe(false);
      expect(state.projects).toEqual([]);
    },
  );
});

function mountProjectFlow(
  withDraft: boolean,
  withChooser = true,
  withPullRequest = false,
  screenName = "AddProjectLocal",
) {
  const { StackRouter, StackActions, CommonActions } = loadRouters();
  const base = StackRouter({});
  const router = { ...base, ...workspaceDetailRouter(base) };
  const options = {
    routeNames: [
      "Home",
      "Thread",
      "PullRequest",
      "PullRequestFile",
      "NewTaskProject",
      "AddProject",
      "AddProjectLocal",
      "AddProjectNew",
      "AddProjectDestination",
    ],
    routeParamList: {},
    routeGetIdList: {},
  };
  let current = router.getInitialState(options);
  const home = current.routes[0]!;
  const apply = (action: Parameters<typeof router.getStateForAction>[1]) => {
    const next = router.getStateForAction(current, action, options);
    if (!next || next.stale !== false) throw new Error("Navigation action rejected");
    current = next;
    state.navigationState = current;
  };
  if (withPullRequest) {
    apply(StackActions.push("PullRequest", { number: 123 }));
    apply(StackActions.push("PullRequestFile", { path: "file.ts" }));
  }
  const underlyingRoutes = current.routes;
  if (withDraft) {
    apply(StackActions.push("Thread", { draft: { projectId: "previous-project" } }));
  }
  const draftKey = withDraft ? current.routes[current.index]!.key : null;
  for (const name of [...(withChooser ? ["NewTaskProject"] : []), "AddProject", screenName]) {
    apply(StackActions.push(name));
  }
  state.navigationState = current;
  state.dispatch.mockImplementation((action) =>
    apply(
      action.type === "PUSH" || action.type === "SELECT_WORKSPACE_DETAIL"
        ? action
        : CommonActions.reset(action),
    ),
  );
  return {
    home,
    draftKey,
    underlyingRoutes,
    flowRoutes: current.routes.slice(underlyingRoutes.length),
    getState: () => current,
    back: () => apply(StackActions.pop()),
    setParams: (params: object) => apply(CommonActions.setParams(params)),
    push: (name: string) => apply(StackActions.push(name)),
  };
}

describe("add project source environment", () => {
  it("blocks local add on a requested unavailable host until reconnect or manual choice", async () => {
    state.scopes = new Set([AuthOrchestrationOperateScope]);
    state.dispatch.mockReset();
    state.environments = [
      { environmentId: "environment", environmentLabel: "Environment" },
      { environmentId: "another-environment", environmentLabel: "Another environment" },
    ];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement("div"));
    let screen: ReactNode;
    function SourceObserver() {
      screen = AddProjectSourceScreen({ environmentId: "environment" });
      return null;
    }
    try {
      for (const phase of ["available", "offline", "error"] as const) {
        state.connectionStates = { environment: phase };
        await act(() => root.render(createElement(SourceObserver)));
        expect(findAction(screen, "Existing folder")).toBeNull(); // fork: project-home
        expect(state.dispatch).not.toHaveBeenCalled();
      }
      state.connectionStates = {};
      await act(() => root.render(createElement(SourceObserver)));
      const reconnectedLocal = findAction(screen, "Existing folder"); // fork: project-home
      if (!reconnectedLocal) throw new Error("Reconnected local folder action missing");
      reconnectedLocal();
      expect(state.dispatch).toHaveBeenLastCalledWith({
        type: "PUSH",
        payload: { name: "AddProjectLocal", params: { environmentId: "environment" } },
      });
      state.connectionStates = { environment: "offline" };
      await act(() => root.render(createElement(SourceObserver)));
      expect(findAction(screen, "Existing folder")).toBeNull(); // fork: project-home
      const select = findAction(screen, "Another environment");
      if (!select) throw new Error("Connected environment selection missing");
      await act(() => select());
      const local = findAction(screen, "Existing folder"); // fork: project-home
      if (!local) throw new Error("Manually selected local folder action missing");
      local();
      expect(state.dispatch).toHaveBeenLastCalledWith({
        type: "PUSH",
        payload: { name: "AddProjectLocal", params: { environmentId: "another-environment" } },
      });
    } finally {
      await act(() => root.unmount());
      state.connectionStates = {};
      state.environments = [{ environmentId: "environment", environmentLabel: "Environment" }];
    }
  });

  it("keeps a manual host selection when the requested host finishes connecting", async () => {
    state.scopes = new Set([AuthOrchestrationOperateScope]);
    state.dispatch.mockReset();
    const navigation = mountProjectFlow(false, true, false, "AddProject");
    state.environments = [
      { environmentId: "environment", environmentLabel: "Environment" },
      { environmentId: "another-environment", environmentLabel: "Another environment" },
    ];
    state.connectionStates = { environment: "connecting" };
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement("div"));
    let screen: ReactNode;
    function SourceObserver() {
      screen = AddProjectSourceScreen({ environmentId: "environment" });
      return null;
    }
    try {
      await act(() => root.render(createElement(SourceObserver)));
      expect(findAction(screen, "Existing folder")).toBeNull(); // fork: project-home
      expect(navigation.getState().routes.at(-1)?.name).toBe("AddProject");
      const select = findAction(screen, "Another environment");
      if (!select) throw new Error("Connected environment selection missing");
      await act(() => select());
      state.connectionStates = {};
      await act(() => root.render(createElement(SourceObserver)));
      const local = findAction(screen, "Existing folder"); // fork: project-home
      if (!local) throw new Error("Local folder action missing");
      local();
      expect(navigation.getState().routes.at(-1)).toMatchObject({
        name: "AddProjectLocal",
        params: { environmentId: "another-environment" },
      });
    } finally {
      await act(() => root.unmount());
      state.connectionStates = {};
      state.environments = [{ environmentId: "environment", environmentLabel: "Environment" }];
    }
  });

  it("follows warm environment requests while preserving manual selection between requests", async () => {
    state.scopes = new Set([AuthOrchestrationOperateScope]);
    state.dispatch.mockReset();
    const navigation = mountProjectFlow(false, true, false, "AddProject");
    state.environments = [
      { environmentId: "environment", environmentLabel: "Environment" },
      { environmentId: "another-environment", environmentLabel: "Another environment" },
    ];
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement("div"));
    let actions: { local: () => unknown; selectEnvironment: () => unknown } | undefined;
    function SourceRouteObserver(props: { environmentId?: string | string[] }) {
      const route = AddProjectSourceRoute({ route: { params: props } });
      const screen = AddProjectSourceScreen(route.props);
      const local = findAction(screen, "Existing folder"); // fork: project-home
      const selectEnvironment = findAction(screen, "Environment");
      if (!local || !selectEnvironment) throw new Error("Source actions missing");
      actions = { local, selectEnvironment };
      return null;
    }
    const openLocalFolder = (environmentId: string) => {
      state.dispatch.mockClear();
      actions!.local();
      expect(navigation.getState().routes.at(-1)).toMatchObject({
        name: "AddProjectLocal",
        params: { environmentId },
      });
      navigation.back();
    };
    try {
      await act(() =>
        root.render(createElement(SourceRouteObserver, { environmentId: "environment" })),
      );
      openLocalFolder("environment");
      await act(() =>
        root.render(createElement(SourceRouteObserver, { environmentId: "another-environment" })),
      );
      openLocalFolder("another-environment");
      await act(() => actions!.selectEnvironment());
      await act(() =>
        root.render(createElement(SourceRouteObserver, { environmentId: ["another-environment"] })),
      );
      openLocalFolder("environment");
      await act(() =>
        root.render(createElement(SourceRouteObserver, { environmentId: "environment" })),
      );
      await act(() =>
        root.render(createElement(SourceRouteObserver, { environmentId: "another-environment" })),
      );
      openLocalFolder("another-environment");
    } finally {
      await act(() => root.unmount());
      state.environments = [{ environmentId: "environment", environmentLabel: "Environment" }];
    }
  });
});

describe("local project navigation", () => {
  function setup() {
    state.navigationState = undefined;
    state.scopes = new Set([AuthOrchestrationOperateScope]);
    state.baseDirectory = "/tmp/t3-mobile-audit-fixture";
    state.projects = [];
    state.dispatch.mockReset();
    state.alert.mockReset();
    state.waitForProject.mockReset();
    const created = Promise.withResolvers<ReturnType<typeof AsyncResult.success<void>>>();
    const projected = Promise.withResolvers<unknown>();
    state.createResult = created.promise;
    state.waitForProject.mockReturnValue(projected.promise);
    const submit = findAction(
      renderScreen(() => AddProjectLocalFolderScreen({ environmentId: "environment" })),
      "Open folder", // fork: project-home
    );
    if (!submit) throw new Error("Add project action missing");
    return { created, projected, submit };
  }

  it("keeps navigation in place and explains a project projection timeout", async () => {
    const { created, projected, submit } = setup();
    const submission = submit();
    created.resolve(AsyncResult.success(undefined));
    projected.resolve(null);
    await submission;

    expect(state.projects).toEqual(["/tmp/t3-mobile-audit-fixture"]);
    expect(state.dispatch).not.toHaveBeenCalled();
    expect(state.alert).toHaveBeenCalledExactlyOnceWith(
      "Project added",
      "The project was created but has not reached this device yet. It will appear in the project list once the connection catches up.",
    );
  });

  it("does not replace a reopened flow when the previous submission finishes", async () => {
    const { created, projected, submit } = setup();
    const navigation = mountProjectFlow(false);
    const submission = submit();
    created.resolve(AsyncResult.success(undefined));
    await created.promise;
    navigation.back();
    navigation.push("AddProjectLocal");
    const remaining = navigation.getState();
    projected.resolve({ environmentId: "environment", id: "project" });
    await submission;

    expect(state.projects).toEqual(["/tmp/t3-mobile-audit-fixture"]);
    expect(navigation.getState()).toEqual(remaining);
    expect(state.dispatch).not.toHaveBeenCalled();
  });

  it("does not replace a warm-linked flow sharing the original route key", async () => {
    const { created, projected, submit } = setup();
    const navigation = mountProjectFlow(false);
    const submission = submit();
    created.resolve(AsyncResult.success(undefined));
    await created.promise;
    const originalKey = navigation.getState().routes.at(-1)!.key;
    navigation.setParams({ environmentId: "other-environment" });
    const remaining = navigation.getState();
    expect(remaining.routes.at(-1)!.key).toBe(originalKey);
    projected.resolve({ environmentId: "environment", id: "project" });
    await submission;

    expect(navigation.getState()).toEqual(remaining);
    expect(state.dispatch).not.toHaveBeenCalled();
  });

  it("does not redirect a reopened flow when an earlier legacy clone finishes", async () => {
    const { created, projected } = setup();
    state.scopes.add(AuthSourceControlWriteScope);
    const cloned = Promise.withResolvers<unknown>();
    state.cloneResult = cloned.promise;
    const navigation = mountProjectFlow(false, true, true, "AddProjectDestination");
    try {
      const submission = cloneAction()();
      navigation.back();
      navigation.push("AddProjectDestination");
      const remaining = navigation.getState();
      cloned.resolve(AsyncResult.success({ cwd: "/tmp/t3-mobile-audit-fixture/repo" }));
      created.resolve(AsyncResult.success(undefined));
      projected.resolve({ environmentId: "environment", id: "project" });
      await submission;

      expect(state.projects).toEqual(["/tmp/t3-mobile-audit-fixture/repo"]);
      expect(navigation.getState()).toEqual(remaining);
      expect(state.dispatch).not.toHaveBeenCalled();
    } finally {
      state.cloneResult = null;
    }
  });

  it("does not redirect a reopened flow when an earlier new project finishes", async () => {
    const { projected } = setup();
    state.newProjectsRoot = "/projects";
    const created = Promise.withResolvers<unknown>();
    const waitingForProject = Promise.withResolvers<void>();
    state.createNewResult = created.promise;
    state.waitForProject.mockImplementation(() => {
      waitingForProject.resolve();
      return projected.promise;
    });
    const navigation = mountProjectFlow(false, true, true, "AddProjectNew");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement("div"));
    let screen: ReactNode;
    function NewProjectObserver() {
      screen = AddProjectNewScreen({ environmentId: "environment" });
      return null;
    }
    function enterName(node: ReactNode): boolean {
      if (Array.isArray(node)) return node.some(enterName);
      if (
        !isValidElement<{
          placeholder?: string;
          onChangeText?: (text: string) => void;
          children?: ReactNode;
        }>(node)
      )
        return false;
      if (node.props.placeholder === "Project name") {
        node.props.onChangeText!("new-project");
        return true;
      }
      return enterName(node.props.children);
    }
    try {
      await act(() => root.render(createElement(NewProjectObserver)));
      await act(() => {
        expect(enterName(screen)).toBe(true);
      });
      const submit = findAction(screen, "Create project");
      if (!submit) throw new Error("Create project action missing");
      await act(async () => {
        submit();
        created.resolve(
          AsyncResult.success({
            projectId: "project",
            workspaceRoot: "/projects/new-project",
          }),
        );
        await waitingForProject.promise;
      });
      navigation.back();
      navigation.push("AddProjectNew");
      const remaining = navigation.getState();
      await act(async () => {
        projected.resolve({ environmentId: "environment", id: "project" });
        await projected.promise;
      });

      expect(navigation.getState()).toEqual(remaining);
      expect(state.dispatch).not.toHaveBeenCalled();
    } finally {
      await act(() => root.unmount());
      state.newProjectsRoot = null;
      state.createNewResult = null;
    }
  });

  it.each([
    { origin: "Thread", withDraft: true, withChooser: true },
    { origin: "NewTaskProject", withDraft: false, withChooser: true },
    { origin: "AddProject", withDraft: false, withChooser: false },
  ])(
    "waits for projection then selects the draft from $origin",
    async ({ withDraft, withChooser }) => {
      const { created, projected, submit } = setup();
      const navigation = mountProjectFlow(withDraft, withChooser, true);
      const before = navigation.getState();
      const submission = submit();
      created.resolve(AsyncResult.success(undefined));
      await created.promise;
      expect(state.projects).toEqual(["/tmp/t3-mobile-audit-fixture"]);
      expect(navigation.getState()).toBe(before);
      projected.resolve({ environmentId: "environment", id: "project" });
      await submission;
      expect(state.dispatch).toHaveBeenCalledTimes(1);
      expect(navigation.getState().routes.map((route) => route.name)).toEqual(["Home", "Thread"]);
      expect(navigation.getState().routes[1]?.params).toEqual({
        draft: {
          environmentId: "environment",
          projectId: "project",
          title: "t3-mobile-audit-fixture",
        },
      });
      navigation.back();
      expect(navigation.getState().routes).toEqual([navigation.home]);
    },
  );
});

// fork: fleet-connections
describe("new project permissions", () => {
  beforeEach(() => {
    state.baseDirectory = "/workspace/projects";
    state.newProjectsRoot = state.baseDirectory;
    state.environments = [
      { environmentId: "environment", environmentLabel: "Environment" },
      { environmentId: "other-environment", environmentLabel: "Other environment" },
    ];
    resetForkNavigation();
    state.newProjectName = "New project";
    state.scopes = new Set();
    state.otherScopes = new Set();
    state.newProjectRequests = [];
    state.publishRequests = [];
    state.newProjectPublishes = false;
    state.offerPublishTarget = false;
    state.revokePublishAfterCreate = false;
  });

  afterEach(() => {
    state.newProjectName = "";
    state.newProjectPublishes = false;
    state.offerPublishTarget = false;
    state.newProjectsRoot = null;
    state.environments = [{ environmentId: "environment", environmentLabel: "Environment" }];
  });

  function findTextInput(node: ReactNode, placeholder: string): ((text: string) => void) | null {
    if (Array.isArray(node)) {
      for (const child of node) {
        const input = findTextInput(child, placeholder);
        if (input) return input;
      }
      return null;
    }
    if (
      !isValidElement<{
        placeholder?: string;
        onChangeText?: (text: string) => void;
        children?: ReactNode;
      }>(node)
    ) {
      return null;
    }
    if (node.props.placeholder === placeholder) return node.props.onChangeText ?? null;
    return findTextInput(node.props.children, placeholder);
  }

  async function newProjectAction(environmentId = "environment") {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement("div"));
    mountedRoots.push(root);
    let screen: ReactNode;
    function NewProjectObserver() {
      screen = AddProjectNewScreen({ environmentId });
      return null;
    }
    await act(() => root.render(createElement(NewProjectObserver)));
    const enterName = findTextInput(screen, "Project name");
    if (!enterName) throw new Error("Project name input missing");
    await act(() => enterName(state.newProjectName));
    if (state.newProjectPublishes) {
      const publish = findAction(screen, "Create private repository on GitHub", true);
      if (!publish) throw new Error("Publish option missing");
      await act(() => publish());
    }
    const action = findAction(screen, "Create project", true);
    if (!action) throw new Error("Create project action missing");
    return action;
  }

  it.each([false, true])(
    "does not dispatch new-project creation without the current grant (revoked: %s)",
    async (revokeBeforeSubmit) => {
      if (revokeBeforeSubmit) state.scopes.add(AuthOrchestrationOperateScope);
      const submit = await newProjectAction();
      state.scopes.delete(AuthOrchestrationOperateScope);

      await submit();

      expect(state.newProjectRequests).toEqual([]);
    },
  );

  it.each([false, true])(
    "uses the selected computer's creation grant (allowed: %s)",
    async (allowSelectedEnvironment) => {
      (allowSelectedEnvironment ? state.otherScopes : state.scopes).add(
        AuthOrchestrationOperateScope,
      );

      await (
        await newProjectAction("other-environment")
      )();

      expect(state.newProjectRequests).toEqual(
        allowSelectedEnvironment
          ? [{ environmentId: "other-environment", name: "New project" }]
          : [],
      );
    },
  );
  it("uses a creation grant added while the form is open", async () => {
    const submit = await newProjectAction();
    state.scopes.add(AuthOrchestrationOperateScope);
    await submit();
    expect(state.newProjectRequests).toEqual([
      { environmentId: "environment", name: "New project" },
    ]);
  });

  it.each([false, true])(
    "requires a current publishing grant before a requested private repository is created (revoked: %s)",
    async (revokeBeforeSubmit) => {
      state.scopes.add(AuthOrchestrationOperateScope);
      state.newProjectPublishes = true;
      state.offerPublishTarget = true;
      if (revokeBeforeSubmit) state.scopes.add(AuthSourceControlWriteScope);
      const submit = await newProjectAction();
      state.scopes.delete(AuthSourceControlWriteScope);
      await submit();
      expect(state.newProjectRequests).toEqual([]);
      expect(state.publishRequests).toEqual([]);
    },
  );

  it("publishes a new project when both grants are current", async () => {
    state.scopes = new Set([AuthOrchestrationOperateScope, AuthSourceControlWriteScope]);
    state.newProjectPublishes = true;
    state.offerPublishTarget = true;
    await (
      await newProjectAction()
    )();
    expect(state.newProjectRequests).toEqual([
      { environmentId: "environment", name: "New project" },
    ]);
    expect(state.publishRequests).toEqual([
      { environmentId: "environment", cwd: "/workspace/projects/project" },
    ]);
  });

  it("keeps the created local project without dispatching publication if its grant is revoked during creation", async () => {
    state.scopes = new Set([AuthOrchestrationOperateScope, AuthSourceControlWriteScope]);
    state.newProjectPublishes = true;
    state.offerPublishTarget = true;
    state.revokePublishAfterCreate = true;
    await (
      await newProjectAction()
    )();
    expect(state.newProjectRequests).toEqual([
      { environmentId: "environment", name: "New project" },
    ]);
    expect(state.publishRequests).toEqual([]);
  });
});

// fork: fleet-connections
describe("open an existing folder", () => {
  let temporaryRoot: string;
  beforeEach(async () => {
    temporaryRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-open-existing-"));
    state.baseDirectory = NodePath.join(temporaryRoot, "existing");
    state.scopes = new Set([AuthOrchestrationOperateScope]);
    state.projects = [];
    state.createRequests = [];
    state.createResult = null;
    resetForkNavigation();
    state.checkDirectories = true;
  });
  afterEach(async () => {
    state.checkDirectories = false;
    await NodeFSP.rm(temporaryRoot, { recursive: true, force: true });
  });
  it("reports a missing folder without creating it or registering a project", async () => {
    await localProjectAction()();
    expect(NodeFS.existsSync(state.baseDirectory)).toBe(false);
    expect(state.projects).toEqual([]);
  });
  it("opens a directory that already exists", async () => {
    await NodeFSP.mkdir(state.baseDirectory);
    await localProjectAction()();
    expect(state.projects).toEqual([state.baseDirectory]);
  });
});
