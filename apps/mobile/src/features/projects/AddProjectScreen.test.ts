import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { AuthOrchestrationOperateScope, AuthSourceControlWriteScope } from "@t3tools/contracts";
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
vi.mock("../../components/MaterialListRow", () => ({ MaterialListRow: "MaterialListRow" }));
vi.mock("../../components/MaterialButton", () => ({ MaterialButton: "MaterialButton" }));
vi.mock("../../components/ScreenScrollView", () => ({ ScreenScrollView: "ScrollView" }));
vi.mock("../settings/components/SettingsScreen", () => ({ SettingsScreen: "SettingsScreen" }));
vi.mock("../../components/ThemedSwitch", () => ({ ThemedSwitch: "Switch" }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: () => {} },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ dispatch: () => {} }),
  CommonActions: { reset: (input: unknown) => input },
  StackActions: {},
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("../../components/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../../components/AppText", () => ({ AppText: "Text", AppTextInput: "TextInput" }));
vi.mock("../../components/EnvironmentMachineSymbol", () => ({
  EnvironmentMachineSymbol: "EnvironmentMachineSymbol",
}));
vi.mock("../../components/ErrorBanner", () => ({ ErrorBanner: "ErrorBanner" }));
vi.mock("../../components/SourceControlIcon", () => ({ SourceControlIcon: "SourceControlIcon" }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => "project" }));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.otherScopes).has(scope),
  readEnvironmentScope: (environmentId: string, scope: string) =>
    (environmentId === "environment" ? state.scopes : state.otherScopes).has(scope),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [],
  waitForProject: async () => ({ title: state.newProjectName }),
  useServerConfigs: () =>
    new Map([
      [
        "environment",
        {
          environment: { platform: { os: "linux" }, capabilities: {} },
          settings: { addProjectBaseDirectory: state.baseDirectory },
          newProjectsRoot: state.baseDirectory,
        },
      ],
      [
        "other-environment",
        {
          environment: { platform: { os: "linux" }, capabilities: {} },
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
  useEnvironmentQuery: () => ({
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
  }),
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({ isReady: true, presentation: null }),
}));
vi.mock("../../state/filesystem", () => ({ filesystemEnvironment: {} }));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: {
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

describe("clone project permissions", () => {
  beforeEach(async () => {
    state.baseDirectory = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-clone-permissions-"),
    );
    state.scopes = new Set([AuthSourceControlWriteScope]);
    state.otherScopes = new Set();
    state.projects = [];
    state.createRequests = [];
  });

  afterEach(async () => {
    await NodeFSP.rm(state.baseDirectory, { recursive: true, force: true });
  });

  it("does not leave a clone on disk when project creation is denied", async () => {
    await cloneAction()();

    expect(NodeFS.existsSync(NodePath.join(state.baseDirectory, "repo"))).toBe(false);
    expect(state.projects).toEqual([]);
  });

  it("clones and registers the project when both permissions are granted", async () => {
    state.scopes.add(AuthOrchestrationOperateScope);
    await cloneAction()();

    const destination = NodePath.join(state.baseDirectory, "repo");
    expect(NodeFS.existsSync(destination)).toBe(true);
    expect(state.projects).toEqual([destination]);
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

describe("local project permissions", () => {
  beforeEach(() => {
    state.baseDirectory = "/workspace/project";
    state.scopes = new Set();
    state.otherScopes = new Set();
    state.projects = [];
    state.createRequests = [];
  });

  it.each([false, true])(
    "does not dispatch project creation without the current grant (revoked: %s)",
    async (revokeBeforeSubmit) => {
      if (revokeBeforeSubmit) state.scopes.add(AuthOrchestrationOperateScope);
      const submit = localProjectAction();
      state.scopes.delete(AuthOrchestrationOperateScope);

      await submit();

      expect(state.createRequests).toEqual([]);
      expect(state.projects).toEqual([]);
    },
  );

  it("adds a typed local path with only task-operation permission", async () => {
    state.scopes.add(AuthOrchestrationOperateScope);

    await localProjectAction()();

    expect(state.createRequests).toEqual([
      { environmentId: "environment", workspaceRoot: state.baseDirectory },
    ]);
    expect(state.projects).toEqual([state.baseDirectory]);
  });

  it("uses a grant added while the local-folder form is open", async () => {
    const submit = localProjectAction();
    state.scopes.add(AuthOrchestrationOperateScope);

    await submit();

    expect(state.projects).toEqual([state.baseDirectory]);
  });

  it.each([false, true])(
    "uses the selected environment's grant (allowed: %s)",
    async (allowSelectedEnvironment) => {
      (allowSelectedEnvironment ? state.otherScopes : state.scopes).add(
        AuthOrchestrationOperateScope,
      );

      await localProjectAction("other-environment")();

      expect(state.createRequests).toEqual(
        allowSelectedEnvironment
          ? [{ environmentId: "other-environment", workspaceRoot: state.baseDirectory }]
          : [],
      );
      expect(state.projects).toEqual(allowSelectedEnvironment ? [state.baseDirectory] : []);
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
