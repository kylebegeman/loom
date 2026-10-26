// fork: project-home - Verify preparation retains its request after response loss and preserves normal cloning.
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  AuthOrchestrationOperateScope,
  AuthSourceControlWriteScope,
  EnvironmentId,
  ProjectId,
  type ProjectCloneSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  scopes: new Set<string>(),
  otherScopes: new Set<string>(),
  baseDirectory: "",
  projects: [] as string[],
  createRequests: [] as { environmentId: string; workspaceRoot: string }[],
  newProjectName: "",
  newProjectRequests: [] as { environmentId: string; name: string }[],
  publishRequests: [] as { environmentId: string; cwd: string }[],
  newProjectPublishes: false,
  booleanStateCount: 0,
  offerPublishTarget: false,
  revokePublishAfterCreate: false,
  checkDirectories: false,
  trackedClones: false,
  connected: true,
  disconnectAfterReceiptSave: false,
  revokeAfterReceiptSave: false,
  failReceiptSave: false,
  cloneSnapshots: [] as ProjectCloneSnapshot[],
  navigationRequests: [] as { route: string; params: unknown }[],
  draftRequests: [] as unknown[],
  knownProjects: [] as EnvironmentProject[],
  preparationReceipts: {} as Record<
    string,
    import("../../fork/project-home/projectPreparationReceipt").ProjectPreparationReceipt | null
  >,
  trackedCloneRequests: [] as {
    environmentId: string;
    input: {
      projectId: string;
      title: string;
      createdAt: string;
      remoteUrl: string;
      destinationPath: string;
    };
  }[],
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const value = typeof initial === "function" ? initial() : initial;
    const publishes =
      typeof initial === "boolean" && state.booleanStateCount++ === 0 && state.newProjectPublishes;
    return [publishes ? true : value === "" ? state.newProjectName : value, () => {}];
  },
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
}));
vi.mock("../../components/ui/NavigationRow", () => ({ NavigationRow: "NavigationRow" }));
vi.mock("../../components/ui/Button", () => ({ Button: "Button" }));
vi.mock("../../components/ui/ScreenScrollView", () => ({ ScreenScrollView: "ScrollView" }));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: "SettingsScreen" }));
vi.mock("../../components/ui/ThemedSwitch", () => ({ ThemedSwitch: "Switch" }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: () => {} },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    dispatch: (input: unknown) => state.draftRequests.push(input),
    navigate: (route: string, params: unknown) => state.navigationRequests.push({ route, params }),
  }),
  CommonActions: { reset: (input: unknown) => input },
  StackActions: {},
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
  useEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.otherScopes).has(scope),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.otherScopes).has(scope),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => state.knownProjects,
  waitForProject: async () => ({ title: state.newProjectName }),
  useServerConfigs: () =>
    new Map([
      [
        "environment",
        {
          environment: {
            platform: { os: "linux" },
            capabilities: { projectCloneTracking: state.trackedClones },
          },
          settings: { addProjectBaseDirectory: state.baseDirectory },
          newProjectsRoot: state.baseDirectory,
        },
      ],
      [
        "other-environment",
        {
          environment: {
            platform: { os: "linux" },
            capabilities: { projectCloneTracking: state.trackedClones },
          },
          settings: { addProjectBaseDirectory: state.baseDirectory },
          newProjectsRoot: state.baseDirectory,
        },
      ],
    ]),
}));
vi.mock("../../state/use-remote-environment-registry", () => ({
  useRemoteEnvironmentRuntime: () => ({ connectionState: "connected" }),
  useRemoteConnectionStatus: () => ({
    connectedEnvironments: [
      { environmentId: "environment", connectionState: "connected" },
      { environmentId: "other-environment", connectionState: "connected" },
    ],
  }),
  useSavedRemoteConnections: () => ({
    savedConnectionsById: {
      connection: { environmentId: "environment", environmentLabel: "Environment" },
      other: { environmentId: "other-environment", environmentLabel: "Other environment" },
    },
  }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => () => {} }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) =>
    atom === "project-clones"
      ? { data: state.cloneSnapshots, isSuccess: true }
      : {
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
    projectClones: () => "project-clones",
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
      state.trackedCloneRequests.push(request);
      state.knownProjects.push({
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
    discovery: () => null,
    publishRepository: async (request: { environmentId: string; input: { cwd: string } }) => {
      state.publishRequests.push({ environmentId: request.environmentId, cwd: request.input.cwd });
      return AsyncResult.success(undefined);
    },
    cloneRepository: async ({ input }: { input: { destinationPath: string } }) => {
      NodeFS.mkdirSync(input.destinationPath);
      return AsyncResult.success({ cwd: input.destinationPath });
    },
  },
}));
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
    createNew: async (request: { environmentId: string; input: { name: string } }) => {
      state.newProjectRequests.push({
        environmentId: request.environmentId,
        name: request.input.name,
      });
      if (state.revokePublishAfterCreate) state.scopes.delete(AuthSourceControlWriteScope);
      return AsyncResult.success({
        projectId: "project",
        workspaceRoot: `${state.baseDirectory}/project`,
      });
    },
    create: async ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { workspaceRoot: string; createWorkspaceRootIfMissing: boolean };
    }) => {
      state.createRequests.push({ environmentId, workspaceRoot: input.workspaceRoot });
      const scopes = environmentId === "environment" ? state.scopes : state.otherScopes;
      if (!scopes.has(AuthOrchestrationOperateScope)) {
        return AsyncResult.failure(Cause.fail(new Error("Project creation denied")));
      }
      if (state.checkDirectories && !NodeFS.existsSync(input.workspaceRoot)) {
        if (!input.createWorkspaceRootIfMissing) {
          return AsyncResult.failure(Cause.fail(new Error("Folder does not exist")));
        }
        NodeFS.mkdirSync(input.workspaceRoot, { recursive: true });
      }
      state.projects.push(input.workspaceRoot);
      return AsyncResult.success(undefined);
    },
  },
}));

import {
  AddProjectDestinationScreen,
  AddProjectLocalFolderScreen,
  AddProjectNewScreen,
} from "./AddProjectScreen";

function findAction(node: ReactNode, label: string): (() => unknown) | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const action = findAction(child, label);
      if (action) return action;
    }
    return null;
  }
  if (!isValidElement<{ label?: string; onPress?: () => unknown; children?: ReactNode }>(node)) {
    return null;
  }
  if (node.props.label === label) return node.props.onPress ?? null;
  return findAction(node.props.children, label);
}

function cloneAction() {
  const action = findAction(
    AddProjectDestinationScreen({
      environmentId: "environment",
      remoteUrl: "https://example.com/repo.git",
      repositoryName: "repo",
    }),
    "Clone project",
  );
  if (!action) throw new Error("Clone action missing");
  return action;
}

function localProjectAction(environmentId = "environment") {
  const action = findAction(AddProjectLocalFolderScreen({ environmentId }), "Open folder");
  if (!action) throw new Error("Open folder action missing");
  return action;
}

describe("reviewed project preparation", () => {
  beforeEach(() => {
    state.trackedClones = true;
    state.connected = true;
    state.disconnectAfterReceiptSave = false;
    state.revokeAfterReceiptSave = false;
    state.failReceiptSave = false;
    state.cloneSnapshots = [];
    state.navigationRequests = [];
    state.draftRequests = [];
    state.scopes = new Set([AuthSourceControlWriteScope, AuthOrchestrationOperateScope]);
    state.knownProjects = [];
    state.trackedCloneRequests = [];
    state.preparationReceipts = {};
    state.baseDirectory = "/prepared/projects";
  });
  afterEach(() => {
    state.trackedClones = false;
    state.connected = true;
    state.cloneSnapshots = [];
    state.knownProjects = [];
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
      AddProjectDestinationScreen({ ...params, preparationDestinationPath: reviewedPath }),
      "Clone project",
    );
    if (!start) throw new Error("Missing preparation clone action");
    await start();
    expect(state.trackedCloneRequests[0]?.input.destinationPath).toBe(reviewedPath);
    const receipt = Object.values(state.preparationReceipts)[0];
    expect(receipt?.destinationPath).toBe(reviewedPath);
    // A restarted device may need to replay the saved ID before its project cache catches up.
    state.knownProjects = [];
    const reopen = findAction(
      AddProjectDestinationScreen({
        ...params,
        preparationProjectId: "regenerated-project",
        preparationDestinationPath: "/different/proposal",
      }),
      "Clone project",
    );
    if (!reopen) throw new Error("Missing saved preparation action");
    await reopen();
    expect(state.trackedCloneRequests[1]?.input).toEqual(state.trackedCloneRequests[0]?.input);
    expect(Object.values(state.preparationReceipts)[0]).toEqual(receipt);
  });
  it("retains the exact request identity when the start response is lost and avoids creating another checkout", async () => {
    const first = findAction(AddProjectDestinationScreen(params), "Clone project");
    if (!first) throw new Error("Missing preparation clone action");
    await first();
    expect(state.trackedCloneRequests).toHaveLength(1);
    expect(state.trackedCloneRequests[0]?.input).toMatchObject({
      projectId: "stable-project",
      title: "My project",
      createdAt: params.preparationCreatedAt,
    });
    const retry = findAction(AddProjectDestinationScreen(params), "Clone project");
    if (!retry) throw new Error("Missing retained preparation action");
    await retry();
    expect(state.trackedCloneRequests).toHaveLength(1);
    expect(state.knownProjects).toHaveLength(1);
    const receipt = Object.values(state.preparationReceipts)[0];
    expect(receipt).toMatchObject({
      projectId: "stable-project",
      destinationPath: "/prepared/projects/repo",
      remoteUrl: params.remoteUrl,
    });
    const reopened = findAction(
      AddProjectDestinationScreen({
        ...params,
        preparationProjectId: "new-after-restart",
        remoteUrl: "https://example.com/other.git",
      }),
      "Clone project",
    );
    if (!reopened) throw new Error("Missing reopened preparation action");
    await reopened();
    expect(state.trackedCloneRequests).toHaveLength(1);
    expect(Object.values(state.preparationReceipts)[0]).toEqual(receipt);
  });
  it.each(["origin", "project-path", "clone-path"] as const)(
    "routes a known %s mismatch to manual review instead of clone Retry",
    async (mismatch) => {
      const start = findAction(AddProjectDestinationScreen(params), "Clone project");
      if (!start) throw new Error("Missing preparation action");
      await start();
      const project = state.knownProjects[0];
      if (!project) throw new Error("Missing saved project");
      state.knownProjects = [
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
      const screen = AddProjectDestinationScreen(params);
      expect(findAction(screen, "Open clone progress")).toBeNull();
      const inspect = findAction(screen, "Review saved project");
      if (!inspect) throw new Error("Missing manual recovery review");
      await inspect();
      expect(state.draftRequests).toEqual([]);
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
      const start = findAction(AddProjectDestinationScreen(params), "Clone project");
      if (!start) throw new Error("Missing preparation action");
      await start();
      expect(state.trackedCloneRequests).toEqual([]);
      expect(state.knownProjects).toEqual([]);
    },
  );
  it("does not treat a partial preparation source as an ordinary clone", async () => {
    const start = findAction(
      AddProjectDestinationScreen({
        environmentId: params.environmentId,
        remoteUrl: params.remoteUrl,
        repositoryName: params.repositoryName,
        preparationSourceEnvironmentId: params.preparationSourceEnvironmentId,
      }),
      "Clone project",
    );
    if (!start) throw new Error("Missing clone action");
    await start();
    expect(state.trackedCloneRequests).toEqual([]);
  });
  it("rechecks both destination grants after the reviewed form is opened", async () => {
    const action = findAction(AddProjectDestinationScreen(params), "Clone project");
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

describe("new project permissions", () => {
  beforeEach(() => {
    state.baseDirectory = "/workspace/projects";
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
  });

  function newProjectAction(environmentId = "environment") {
    state.booleanStateCount = 0;
    const action = findAction(AddProjectNewScreen({ environmentId }), "Create project");
    if (!action) throw new Error("Create project action missing");
    return action;
  }

  it.each([false, true])(
    "does not dispatch new-project creation without the current grant (revoked: %s)",
    async (revokeBeforeSubmit) => {
      if (revokeBeforeSubmit) state.scopes.add(AuthOrchestrationOperateScope);
      const submit = newProjectAction();
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

      await newProjectAction("other-environment")();

      expect(state.newProjectRequests).toEqual(
        allowSelectedEnvironment
          ? [{ environmentId: "other-environment", name: "New project" }]
          : [],
      );
    },
  );
  it("uses a creation grant added while the form is open", async () => {
    const submit = newProjectAction();
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
      const submit = newProjectAction();
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
    await newProjectAction()();
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
    await newProjectAction()();
    expect(state.newProjectRequests).toEqual([
      { environmentId: "environment", name: "New project" },
    ]);
    expect(state.publishRequests).toEqual([]);
  });
});

describe("open an existing folder", () => {
  let temporaryRoot: string;
  beforeEach(async () => {
    temporaryRoot = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-open-existing-"));
    state.baseDirectory = NodePath.join(temporaryRoot, "existing");
    state.scopes = new Set([AuthOrchestrationOperateScope]);
    state.projects = [];
    state.createRequests = [];
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
