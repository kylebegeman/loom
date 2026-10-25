// @vitest-environment jsdom
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerConfig,
} from "@t3tools/contracts";
import { libraryLaunchRanking } from "@t3tools/client-runtime/fork";
import {
  LibraryError,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type Launch = typeof import("./libraryLaunch").launchLibraryConversation;
type Computer = {
  environmentId: EnvironmentId;
  label: string;
  entry: { enabled: boolean };
  connection: { phase: string };
  serverConfig: ServerConfig;
};
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  dispatch: vi.fn(),
  launch: vi.fn<Launch>(),
  prepare: Object.assign(vi.fn(), { permissionAtom: () => true }),
  bind: Object.assign(vi.fn(), { permissionAtom: () => true }),
  registerCopy: Object.assign(vi.fn(), { permissionAtom: () => true }),
  registerThread: Object.assign(vi.fn(), { permissionAtom: () => true }),
  reopen: Object.assign(vi.fn(), { permissionAtom: () => true }),
  retention: Object.assign(vi.fn(), { permissionAtom: () => true }),
  authorize: Object.assign(vi.fn(), { permissionAtom: () => true }),
  restore: Object.assign(vi.fn(), { permissionAtom: () => true }),
  readStatus: Object.assign(vi.fn(), { permissionAtom: () => true }),
  snapshotCopy: Object.assign(vi.fn(), { permissionAtom: () => true }),
  create: vi.fn(),
  pull: Object.assign(vi.fn(), { permissionAtom: () => true }),
  resolve: vi.fn(),
  snapshot: vi.fn(),
  savePreferences: vi.fn(),
  preferenceAtom: {},
  preferences: {} as Record<string, string>,
  refresh: vi.fn(),
  project: null as LibraryProject | null,
  copies: [] as LibraryWorkingCopy[],
  computers: [] as Computer[],
  copiesError: null as string | null,
  copiesPending: false,
  sourceError: null as string | null,
  sourcePending: false,
  healthPending: false,
  source: null as {
    summary: {
      title: string;
      resourceIds: string[];
      environmentId: EnvironmentId;
      threadId: ThreadId;
      sequence: number;
      workingCopyId: string | null;
    };
    projection: { messages: { role: string; text: string }[]; visibleTurnItems: [] };
  } | null,
  warning: null as { message: string; pullPaths: string[] | null } | null,
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === state.preferenceAtom
      ? { _tag: "Success", value: { loomLibraryLaunches: state.preferences } }
      : atom,
  useAtomSet: () => state.savePreferences,
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate, dispatch: state.dispatch }),
  useFocusEffect: () => undefined,
  usePreventRemove: () => undefined,
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  libraryLaunchWarning: () => state.warning,
}));
vi.mock("./libraryLaunch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./libraryLaunch")>()),
  launchLibraryConversation: state.launch,
}));
vi.mock("./libraryState", () => ({
  useLibraryAuthority: () => ({
    environmentId: "library",
    ready: true,
    connected: true,
    canRead: true,
    computers: [],
  }),
  refreshLibraryWork: vi.fn(),
  library: {
    project: () => "project",
    copies: () => "copies",
    history: () => "history",
    copyHealth: () => "health",
    prepareCopy: state.prepare,
    bindThread: state.bind,
    registerCopy: state.registerCopy,
    registerThread: state.registerThread,
    reopenCopy: state.reopen,
    setCopyRetention: state.retention,
    authorizeRecovery: state.authorize,
    restoreCopy: state.restore,
    readCopyStatus: state.readStatus,
    snapshotCopy: state.snapshotCopy,
    resolveBinding: state.resolve,
    snapshotThread: state.snapshot,
  },
}));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => crypto.randomUUID() }));
vi.mock("../../state/preferences", () => ({
  mobilePreferencesAtom: state.preferenceAtom,
  updateMobilePreferencesAtom: {},
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: state.computers }),
}));
vi.mock("../../state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      ...state.computers.map(
        (computer) => [computer.environmentId, computer.serverConfig] as const,
      ),
      ["library", state.computers[0]?.serverConfig],
    ]),
  useProject: () => null,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentsWithScope: () =>
    new Set(state.computers.map((computer) => computer.environmentId)),
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: {
    refresh: vi.fn(),
    get: (atom: unknown) =>
      typeof atom === "boolean"
        ? atom
        : atom === "copies"
          ? { _tag: "Success", value: state.copies, waiting: false }
          : state.computers.find((computer) => computer.environmentId === atom),
  },
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationAtom: (id: unknown) => id },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: string | null) =>
    query === "health"
      ? {
          data: null,
          error: null,
          isPending: state.healthPending,
          isSuccess: !state.healthPending,
          refresh: state.refresh,
        }
      : {
          data:
            query === "project" ? state.project : query === "copies" ? state.copies : state.source,
          error:
            query === "copies" ? state.copiesError : query === "history" ? state.sourceError : null,
          isPending:
            query === "copies"
              ? state.copiesPending
              : query === "history"
                ? state.sourcePending
                : false,
          isSuccess: true,
          refresh: state.refresh,
        },
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (query: unknown) => query,
}));
vi.mock("../../state/threads", () => ({ threadEnvironment: { create: state.create } }));
vi.mock("../../state/vcs", () => ({ vcsEnvironment: { pull: state.pull } }));
vi.mock("../../state/use-composer-drafts", () => ({
  setComposerDraftText: vi.fn(),
  flushComposerDrafts: vi.fn(),
  useStickyComposerModelSelection: () => null,
}));
vi.mock("./useLibraryLaunchRanking", () => ({
  useLibraryLaunchRanking: (input: {
    project: LibraryProject;
    copies: LibraryWorkingCopy[];
    resourceId: string | null;
  }) =>
    libraryLaunchRanking({
      ...input,
      computers: state.computers.map((computer) => ({
        environmentId: computer.environmentId,
        label: computer.label,
        online: computer.entry.enabled && computer.connection.phase === "connected",
        supportsExecution: true,
        workingThreads: 0,
      })),
      threads: [],
    }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: ({
    accessibilityLabel,
    value,
    editable,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    editable: boolean;
    onChangeText: (text: string) => void;
  }) => (
    <textarea
      aria-label={accessibilityLabel}
      value={value}
      disabled={!editable}
      onInput={(event) => onChangeText(event.currentTarget.value)}
      onChange={() => undefined}
    />
  ),
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("../../components/ui/ListRow", () => ({
  ListRow: ({
    label,
    description,
    detail,
    disabled,
    onPress,
  }: {
    label: string;
    description?: string;
    detail?: string;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button aria-label={label} disabled={disabled} onClick={onPress}>
      {label} {description} {detail}
    </button>
  ),
}));
vi.mock("../../components/ui/ListChoiceRow", () => ({
  ListChoiceRow: ({
    label,
    description,
    selected,
    disabled,
    onPress,
  }: {
    label: string;
    description?: string;
    selected: boolean;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button
      role="radio"
      aria-label={label}
      aria-checked={selected}
      disabled={disabled}
      onClick={onPress}
    >
      {label} {description}
    </button>
  ),
}));
vi.mock("../../features/settings/components/SettingsSection", () => ({
  SettingsSection: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));
vi.mock("../../features/settings/components/SettingsSwitchRow", () => ({
  SettingsSwitchRow: ({
    label,
    value,
    disabled,
    onValueChange,
  }: {
    label: string;
    value: boolean;
    disabled: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <button
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onValueChange(!value)}
    >
      {label}
    </button>
  ),
}));
vi.mock("./LibraryScreens", () => ({
  LibraryPage: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  LibraryAuthorityScreen: () => null,
  LibraryNotice: ({
    error,
    detail,
    onRetry,
  }: {
    error?: string;
    detail?: string;
    onRetry?: () => void;
  }) => (
    <div>
      {error ?? detail}
      {onRetry ? (
        <button aria-label="Retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  ),
}));
vi.mock("./LibraryProfileReadiness", () => ({
  LibraryProfileReadiness: () => <span>Setup checks</span>,
}));
vi.mock("./LibraryFolderStorage", () => ({
  LibraryFolderStorage: () => <button>Review folder storage</button>,
}));

import { emptyLibraryLaunchReceipt, encodeLibraryLaunchAttempt } from "./libraryLaunch";
import { LibraryStartRouteScreen } from "./LibraryStartScreen";

const computerA = EnvironmentId.make("computer-a"),
  computerB = EnvironmentId.make("computer-b"),
  localProjectId = ProjectId.make("local-project");
const makeComputer = (
  id: EnvironmentId,
  label: string,
  online = true,
  features: readonly string[] = [],
): Computer => ({
  environmentId: id,
  label,
  entry: { enabled: true },
  connection: { phase: online ? "connected" : "offline" },
  serverConfig: {
    environment: {
      capabilities: {
        loomFeatures: [
          "project-library",
          "library-file-lifecycle",
          "library-portable-recovery",
          ...features,
        ],
      },
    },
    newProjectsRoot: `/Projects/${id}`,
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
    },
    providers: [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver: "codex",
        enabled: true,
        installed: true,
        auth: { status: "authenticated" },
        models: ["default", "custom"].map((slug) => ({
          slug,
          name: slug,
          isDefault: slug === "default",
          capabilities: null,
        })),
      },
    ],
  } as unknown as ServerConfig,
});
const project: LibraryProject = {
  id: "project",
  title: "Loom",
  brief: "Project context",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const recoveryMetadata = {
  sha256: "a".repeat(64),
  byteLength: 2048,
  archiveKey: "source-files",
  verifiedAt: project.updatedAt,
};
const copy: LibraryWorkingCopy = {
  id: "copy-a",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId: computerA,
  rootPath: "/Projects/Loom",
  rootLocalProjectId: localProjectId,
  repositories: [],
  ownership: "managed",
  state: "ready",
  keepOnComputer: false,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
let root: Root, container: HTMLDivElement;
type Params = Parameters<typeof LibraryStartRouteScreen>[0]["route"]["params"];
let params: Params;
async function render() {
  await act(() => root.render(<LibraryStartRouteScreen route={{ params }} />));
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (node) => node.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label: string) {
  await act(() => button(label).click());
}
async function input(label: string, text: string) {
  const field = container.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;
  await act(() => {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  state.project = project;
  state.copies = [copy];
  state.computers = [
    makeComputer(computerA, "MacBook"),
    makeComputer(computerB, "Mac mini"),
    makeComputer(EnvironmentId.make("offline"), "Offline fixture", false),
  ];
  state.preferences = {};
  state.copiesError = null;
  state.copiesPending = false;
  state.sourceError = null;
  state.sourcePending = false;
  state.healthPending = false;
  state.source = null;
  state.warning = null;
  // Applies each update the way the preferences store does, so a remounted screen reads it.
  state.savePreferences.mockImplementation(
    async (update: {
      transform: (current: { loomLibraryLaunches: Record<string, string> }) => {
        loomLibraryLaunches: Record<string, string>;
      };
    }) => {
      state.preferences = update.transform({
        loomLibraryLaunches: state.preferences,
      }).loomLibraryLaunches;
    },
  );
  state.prepare.mockResolvedValue(AsyncResult.success(copy));
  state.create.mockResolvedValue(AsyncResult.success({}));
  state.registerCopy.mockResolvedValue(AsyncResult.success({}));
  state.readStatus.mockResolvedValue(
    AsyncResult.success({ copy, blockers: [], reviewToken: "review" }),
  );
  state.snapshotCopy.mockResolvedValue(
    AsyncResult.success({ ...copy, recovery: recoveryMetadata }),
  );
  state.authorize.mockResolvedValue(
    AsyncResult.success({
      sourceCopy: { ...copy, recovery: recoveryMetadata },
      destinationEnvironmentId: computerA,
      libraryEnvironmentId: "library",
      expiresAt: "2026-10-21T01:00:00Z",
      accessToken: "temporary-grant",
    }),
  );
  state.restore.mockResolvedValue(
    AsyncResult.success({
      ...copy,
      id: "new-copy",
      rootPath: "/Projects/Reviewed",
      keepOnComputer: true,
    }),
  );
  state.launch.mockImplementation(async (intent, _receipt, ports) => {
    await ports.prepare(intent);
    await ports.create(localProjectId);
    throw new Error("Preparation interrupted");
  });
  params = { projectId: project.id };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("Library start progressive disclosure", () => {
  it.each([0, 1])(
    "keeps the launch essentials visible without a redundant scope choice for %i repositories",
    async (count) => {
      state.project = {
        ...project,
        resources: Array.from({ length: count }, () => ({
          id: "app",
          title: "App",
          relativePath: ".",
          remoteUrl: "https://github.com/team/app",
          defaultBranch: null,
        })),
      };
      state.copies = [];
      params = { ...params, reuseEnvironmentId: computerA };
      await render();
      expect(button("Computer").textContent).toContain("MacBook");
      expect(button("Agent model").textContent).toContain("Codex: default");
      expect(button("Files").textContent).toContain("Prepare project files when starting");
      expect(button("Start work").disabled).toBe(false);
      expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
      expect(container.querySelector("textarea")).toBeNull();
      expect(container.textContent).not.toContain("Offline fixture");
      await click("Start work");
      expect(state.launch.mock.calls[0]![0].resourceIds).toEqual(count ? ["app"] : []);
    },
  );

  it("lets users change computers and automatically exposes alternatives when their explicit selection goes offline", async () => {
    await render();
    await click("Computer");
    expect(button("Offline fixture").disabled).toBe(true);
    await click("Mac mini");
    expect(button("Computer").textContent).toContain("Mac mini");
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
    state.computers[1] = makeComputer(computerB, "Mac mini", false);
    await render();
    expect(button("Computer").textContent).toContain("Mac mini. Unavailable");
    expect(button("Mac mini").getAttribute("aria-checked")).toBe("true");
    expect(button("MacBook").disabled).toBe(false);
    expect(button("Start work").disabled).toBe(true);
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("retains edited title, folder, model and retention when disclosures close and launches with those values", async () => {
    await render();
    await click("Conversation options");
    await input("Conversation title", "Ship the new flow");
    await click("Conversation options");
    await click("Agent model");
    await click("Codex: custom");
    await click("Files");
    await click("Prepare files in a new folder");
    await input("Project folder on selected computer", "/Projects/Reviewed");
    await click("Keep files on this computer");
    await click("Files");
    expect(container.querySelector("textarea")).toBeNull();
    expect(button("Files").textContent).toContain("Files stay kept.");
    await click("Files");
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Project folder on selected computer"]',
      )!.value,
    ).toBe("/Projects/Reviewed");
    expect(button("Keep files on this computer").getAttribute("aria-checked")).toBe("true");
    await click("Files");
    await click("Start work");
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.snapshotCopy).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({ workingCopyId: copy.id, reviewToken: "review" }),
    });
    expect(state.restore).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({ rootPath: "/Projects/Reviewed", resourceIds: [] }),
    });
    expect(state.create).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({
        title: "Ship the new flow",
        modelSelection: { instanceId: "codex", model: "custom" },
        branch: null,
        worktreePath: null,
      }),
    });
  });

  it("preserves meaningful component selection for projects with multiple repositories", async () => {
    state.project = {
      ...project,
      resources: ["app", "server"].map((id) => ({
        id,
        title: id,
        relativePath: id,
        remoteUrl: "https://github.com/team/app",
        defaultBranch: null,
      })),
    };
    state.copies = [];
    await render();
    await click("server");
    await click("Conversation options");
    await click("Conversation options");
    expect(button("server").getAttribute("aria-checked")).toBe("true");
    await click("Start work");
    expect(state.launch.mock.calls[0]![0].resourceIds).toEqual(["server"]);
  });

  it("starts a project tapped in New task once, on the computer and files its row named", async () => {
    params = { ...params, reuseEnvironmentId: computerA, initialCopyId: copy.id, startNow: true };
    await render();
    expect(state.launch).toHaveBeenCalledTimes(1);
    expect(state.launch.mock.calls[0]![0].executionEnvironmentId).toBe(computerA);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Preparation interrupted");
    await render();
    expect(state.launch).toHaveBeenCalledTimes(1);
  });

  it("leaves a tapped project to the Start button when its files need a decision", async () => {
    state.warning = { message: "This copy is 2 commits behind.", pullPaths: ["/Projects/Loom"] };
    params = { ...params, reuseEnvironmentId: computerA, initialCopyId: copy.id, startNow: true };
    await render();
    expect(state.launch).not.toHaveBeenCalled();
    state.warning = null;
    await render();
    expect(state.launch).not.toHaveBeenCalled();
    expect(button("Start work").disabled).toBe(false);
  });

  it("leaves a tapped project to the Start button when its files were released since", async () => {
    state.copies = [{ ...copy, state: "released", recovery: recoveryMetadata }];
    params = { ...params, reuseEnvironmentId: computerA, initialCopyId: copy.id, startNow: true };
    await render();
    expect(button("Files").textContent).toContain("Restore saved files when starting");
    expect(button("Start work").disabled).toBe(false);
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("waits for the copy's live health before starting a tapped project", async () => {
    state.computers[0] = makeComputer(computerA, "MacBook", true, ["library-copy-health"]);
    state.healthPending = true;
    params = { ...params, reuseEnvironmentId: computerA, initialCopyId: copy.id, startNow: true };
    await render();
    expect(state.launch).not.toHaveBeenCalled();
    state.healthPending = false;
    await render();
    expect(state.launch).toHaveBeenCalledTimes(1);
  });

  it.each(["Start work", "Conversation options"])(
    "drops a waiting start once %s is pressed",
    async (label) => {
      state.computers[0] = makeComputer(computerA, "MacBook", true, ["library-copy-health"]);
      state.healthPending = true;
      params = { ...params, reuseEnvironmentId: computerA, initialCopyId: copy.id, startNow: true };
      await render();
      expect(state.launch).not.toHaveBeenCalled();
      await click(label);
      const pressed = state.launch.mock.calls.length;
      state.healthPending = false;
      await render();
      expect(state.launch).toHaveBeenCalledTimes(pressed);
    },
  );

  it("adds a handed-in folder by starting in it", async () => {
    state.copies = [];
    params = {
      ...params,
      reuseEnvironmentId: computerA,
      reuseRootPath: "/Projects/Existing",
      startNow: true,
    };
    await render();
    expect(state.launch).toHaveBeenCalledTimes(1);
    expect(state.prepare).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({ rootPath: "/Projects/Existing", strategy: "reuse" }),
    });
  });

  it("offers Start over on a reopened attempt, then starts fresh on the files it left", async () => {
    const prepared = { ...copy, id: "prepared", rootPath: "/Projects/computer-a/Loom" };
    state.copies = [prepared];
    state.preferences = {
      [JSON.stringify(["library", project.id, "new"])]: encodeLibraryLaunchAttempt({
        version: 1,
        requestId: "saved-request",
        threadId: ThreadId.make("saved-thread"),
        receipt: {
          ...emptyLibraryLaunchReceipt(),
          intent: {
            project,
            executionEnvironmentId: computerA,
            resourceIds: [],
            threadId: ThreadId.make("saved-thread"),
          },
          copy: prepared,
          copyRegistered: true,
        },
        review: {
          authorityEnvironmentId: EnvironmentId.make("library"),
          model: {
            key: "codex:default",
            selection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
          },
          title: "Project discussion",
          mode: "clone",
          rootPath: prepared.rootPath,
          copy: null,
          carryContext: "",
          keepOnComputer: false,
        },
      }),
    };
    await render();
    expect(container.textContent).toContain("An unfinished preparation is saved");
    expect(button("Computer").disabled).toBe(true);
    await click("Start over");
    expect(state.preferences).toEqual({});
    expect(container.textContent).not.toContain("An unfinished preparation is saved");
    expect(button("Computer").disabled).toBe(false);
    // The files the attempt prepared are reused rather than cloned again beside them.
    expect(button("Files").textContent).toContain("Use files already on this computer");
    await click("Start work");
    const [intent, receipt] = state.launch.mock.calls[0]!;
    expect(intent.threadId).not.toBe("saved-thread");
    expect(receipt.copy).toBeNull();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.create).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({ threadId: intent.threadId }),
    });
    expect(state.create.mock.calls[0]![0].input.commandId).not.toContain("saved-request");
  });

  it("starts over on the dropped attempt's computer, model, permissions and folder", async () => {
    state.copies = [];
    state.preferences = {
      [JSON.stringify(["library", project.id, "new"])]: encodeLibraryLaunchAttempt({
        version: 1,
        requestId: "saved-request",
        threadId: ThreadId.make("saved-thread"),
        receipt: {
          ...emptyLibraryLaunchReceipt(),
          intent: {
            project,
            executionEnvironmentId: computerA,
            resourceIds: [],
            threadId: ThreadId.make("saved-thread"),
          },
        },
        review: {
          authorityEnvironmentId: EnvironmentId.make("library"),
          model: {
            key: "codex:custom",
            selection: { instanceId: ProviderInstanceId.make("codex"), model: "custom" },
          },
          title: "Ship the new flow",
          mode: "clone",
          rootPath: "/Work/Loom",
          copy: null,
          carryContext: "",
          keepOnComputer: true,
          runtimeMode: "approval-required",
          interactionMode: "plan",
        },
      }),
    };
    await render();
    await click("Start over");
    expect(state.preferences).toEqual({});
    expect(button("Computer").disabled).toBe(false);
    // Ranked alone, the Mac mini would lead.
    expect(button("Computer").textContent).toContain("MacBook");
    expect(button("Agent model").textContent).toContain("Codex: custom");
    await click("Files");
    // The computer may still be preparing this folder, so a second one is never suggested.
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Project folder on selected computer"]',
      )!.value,
    ).toBe("/Work/Loom");
    await click("Start work");
    expect(state.launch.mock.calls[0]![0].executionEnvironmentId).toBe(computerA);
    expect(state.prepare).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({ rootPath: "/Work/Loom", strategy: "clone" }),
    });
    expect(state.create).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({
        title: "Ship the new flow",
        modelSelection: { instanceId: "codex", model: "custom" },
        runtimeMode: "approval-required",
        interactionMode: "plan",
      }),
    });
  });

  it("keeps launch warnings and explicit safety actions visible while options are collapsed", async () => {
    state.warning = { message: "This copy is 2 commits behind.", pullPaths: ["/Projects/Loom"] };
    await render();
    expect(container.querySelector("textarea")).toBeNull();
    expect(container.textContent).toContain(state.warning.message);
    expect(button("Pull first").disabled).toBe(false);
    expect(button("Continue anyway").disabled).toBe(false);
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("keeps file and continuation source errors with retries visible and blocks starting", async () => {
    params = { ...params, sourceArchiveId: "source-archive" };
    state.copiesError = "File catalog unavailable";
    state.sourceError = "Saved source unavailable";
    await render();
    expect(container.textContent).toContain(state.copiesError);
    expect(container.textContent).toContain(state.sourceError);
    expect(button("Start work").disabled).toBe(true);
    await click("Retry");
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("lets users inspect the saved launch review while keeping its choices locked", async () => {
    const originalCopy = { ...copy, id: "reviewed-copy", rootPath: "/Projects/Original" };
    state.copies = [copy, originalCopy];
    state.preferences = {
      [JSON.stringify(["library", project.id, "new"])]: encodeLibraryLaunchAttempt({
        version: 1,
        requestId: "saved-request",
        threadId: ThreadId.make("saved-thread"),
        receipt: {
          ...emptyLibraryLaunchReceipt(),
          intent: {
            project,
            executionEnvironmentId: computerA,
            resourceIds: [],
            threadId: ThreadId.make("saved-thread"),
          },
          copy: originalCopy,
        },
        review: {
          authorityEnvironmentId: EnvironmentId.make("library"),
          model: {
            key: "codex:custom",
            selection: { instanceId: ProviderInstanceId.make("codex"), model: "custom" },
          },
          title: "Reviewed title",
          mode: "reuse",
          rootPath: originalCopy.rootPath,
          copy: originalCopy,
          carryContext: "Reviewed context",
          keepOnComputer: false,
        },
      }),
    };
    await render();
    expect(button("Resume starting work").disabled).toBe(false);
    expect(button("Computer").disabled).toBe(true);
    expect(button("Agent model").textContent).toContain("Codex: custom");
    await click("Conversation options");
    const title = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Conversation title"]',
    )!;
    expect(title.value).toBe("Reviewed title");
    expect(title.disabled).toBe(true);
    await click("Files");
    expect(container.textContent).toContain(originalCopy.rootPath);
    expect(button(originalCopy.rootPath).getAttribute("aria-checked")).toBe("true");
    expect(button(originalCopy.rootPath).disabled).toBe(true);
    expect(button("Keep files on this computer").disabled).toBe(true);
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("keeps continuation context editable and preserves it when options are closed", async () => {
    params = { ...params, sourceArchiveId: "source-archive" };
    state.source = {
      summary: {
        title: "Earlier work",
        resourceIds: [],
        environmentId: computerA,
        threadId: ThreadId.make("source-thread"),
        sequence: 4,
        workingCopyId: copy.id,
      },
      projection: {
        messages: [{ role: "user", text: "Keep the existing behavior" }],
        visibleTurnItems: [],
      },
    };
    await render();
    expect(container.textContent).toContain("Earlier work");
    expect(container.querySelector("textarea")).toBeNull();
    await click("Conversation options");
    const field = () =>
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Context to carry forward"]',
      )!;
    expect(field().value).toContain("Keep the existing behavior");
    await input("Context to carry forward", "Reviewed handoff");
    await click("Conversation options");
    await click("Conversation options");
    expect(field().value).toBe("Reviewed handoff");
    await click("Conversation options");
    await click("Start work");
    expect(state.launch.mock.calls[0]![0].continuationOf).toEqual({
      environmentId: computerA,
      threadId: "source-thread",
      sequence: 4,
    });
  });
});

describe("portable project files on mobile", () => {
  const savedCopy = { ...copy, state: "released" as const, recovery: recoveryMetadata };
  const continuedSource = (): NonNullable<typeof state.source> => ({
    summary: {
      title: "Earlier work",
      resourceIds: [],
      environmentId: computerA,
      threadId: ThreadId.make("source-thread"),
      sequence: 4,
      workingCopyId: copy.id,
    },
    projection: { messages: [], visibleTurnItems: [] },
  });
  const restoreToB = (sourceCopy: LibraryWorkingCopy = savedCopy) => {
    const rootPath = "/Projects/computer-b/loom";
    state.authorize.mockResolvedValue(
      AsyncResult.success({
        sourceCopy,
        destinationEnvironmentId: computerB,
        libraryEnvironmentId: "library",
        expiresAt: "2026-10-21T01:00:00Z",
        accessToken: "temporary-grant",
      }),
    );
    state.restore.mockResolvedValue(
      AsyncResult.success({
        ...copy,
        environmentId: computerB,
        rootPath,
        id: "new-destination-copy",
        keepOnComputer: true,
      }),
    );
  };

  it("restores local-only saved files from an offline source instead of cloning Git", async () => {
    const released = { ...savedCopy, registered: false };
    state.copies = [released];
    state.computers[0] = makeComputer(computerA, "MacBook", false);
    params = { ...params, reuseEnvironmentId: computerB };
    restoreToB(released);
    await render();
    expect(button("Files").textContent).toContain("Restore source files when starting");
    expect(button("Start work").disabled).toBe(false);
    await click("Start work");
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.snapshotCopy).not.toHaveBeenCalled();
    expect(state.restore).toHaveBeenCalledWith({
      environmentId: computerB,
      input: expect.objectContaining({
        rootPath: "/Projects/computer-b/loom",
        grant: expect.objectContaining({ sourceCopy: released }),
      }),
    });
    expect(state.create.mock.calls[0]![0].environmentId).toBe(computerB);
    expect(JSON.stringify(state.savePreferences.mock.calls)).not.toContain("temporary-grant");
  });

  it("starts on another computer from idle kept source files without changing Keep", async () => {
    const kept = { ...copy, keepOnComputer: true };
    state.copies = [kept];
    params = { ...params, reuseEnvironmentId: computerB };
    state.readStatus.mockResolvedValue(
      AsyncResult.success({
        copy: kept,
        blockers: [],
        reviewToken: "snapshot-review",
      }),
    );
    state.snapshotCopy.mockResolvedValue(
      AsyncResult.success({ ...kept, recovery: recoveryMetadata }),
    );
    restoreToB({ ...kept, recovery: recoveryMetadata });
    await render();
    expect(button("Start work").disabled).toBe(false);
    await click("Start work");
    expect(state.snapshotCopy).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({ workingCopyId: copy.id, reviewToken: "snapshot-review" }),
    });
    expect(state.restore).toHaveBeenCalledOnce();
    expect(state.create).toHaveBeenCalled();
    expect(state.prepare).not.toHaveBeenCalled();
    expect(kept.keepOnComputer).toBe(true);
  });

  it("requires a fresh snapshot of ready files and does not use their old backup while offline", async () => {
    state.copies = [{ ...copy, recovery: recoveryMetadata }];
    state.computers[0] = makeComputer(computerA, "MacBook", false);
    params = { ...params, reuseEnvironmentId: computerB };
    await render();
    expect(container.textContent).toContain("Reconnect the source computer");
    expect(button("Start work").disabled).toBe(true);
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.restore).not.toHaveBeenCalled();
  });

  it("asks which files to use when a continuation conflicts with destination files", async () => {
    state.copies = [savedCopy, { ...copy, id: "destination-copy", environmentId: computerB }];
    state.source = continuedSource();
    params = { ...params, sourceArchiveId: "source-archive", reuseEnvironmentId: computerB };
    restoreToB();
    await render();
    expect(container.querySelector('section[aria-label="Choose source files"]')).not.toBeNull();
    expect(button("Start work").disabled).toBe(true);
    await click(`MacBook: ${copy.rootPath}`);
    expect(button("Start work").disabled).toBe(false);
    await click("Start work");
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.restore.mock.calls[0]![0].input.grant.sourceCopy.id).toBe(copy.id);
    expect(state.launch.mock.calls[0]![0].continuationOf?.threadId).toBe("source-thread");
  });

  it("allows the deliberate local alternative for a continuation", async () => {
    const local = { ...copy, id: "destination-copy", environmentId: computerB };
    state.copies = [savedCopy, local];
    state.source = continuedSource();
    params = { ...params, sourceArchiveId: "source-archive", reuseEnvironmentId: computerB };
    await render();
    await click(`Mac mini: ${local.rootPath}`);
    expect(button("Files").textContent).toContain("Use files already on this computer");
    await click("Start work");
    expect(state.restore).not.toHaveBeenCalled();
    expect(state.snapshotCopy).not.toHaveBeenCalled();
    expect(state.create).toHaveBeenCalled();
  });

  it("blocks a continuation with no source file identity until files are deliberately selected", async () => {
    state.source = continuedSource();
    state.source.summary.workingCopyId = null;
    params = { ...params, sourceArchiveId: "source-archive", reuseEnvironmentId: computerB };
    await render();
    expect(container.textContent).toContain("The source conversation has no saved file location");
    expect(button("Start work").disabled).toBe(true);
    expect(state.launch).not.toHaveBeenCalled();
  });

  it("blocks whole-project continuation from a saved layout containing a removed repository", async () => {
    state.project = {
      ...project,
      resources: [
        {
          id: "app",
          title: "App",
          relativePath: "app",
          remoteUrl: "https://github.com/team/app",
          defaultBranch: null,
        },
      ],
    };
    state.copies = [
      {
        ...savedCopy,
        repositories: ["app", "removed"].map((id) => ({
          resourceId: id,
          path: `${copy.rootPath}/${id}`,
          localProjectId,
          head: null,
          branch: null,
        })),
      },
    ];
    state.source = continuedSource();
    params = { ...params, sourceArchiveId: "source-archive", reuseEnvironmentId: computerB };
    await render();
    expect(button("Start work").disabled).toBe(true);
    expect(container.textContent).toContain("no longer match the selected repositories");
    expect(state.restore).not.toHaveBeenCalled();
    expect(state.prepare).not.toHaveBeenCalled();
  });

  it("requires an explicit source among multiple saved snapshots", async () => {
    const second = {
      ...savedCopy,
      id: "second-source",
      rootPath: "/Projects/Other",
      recovery: { ...recoveryMetadata, sha256: "b".repeat(64) },
    };
    state.copies = [savedCopy, second];
    params = { ...params, reuseEnvironmentId: computerB };
    restoreToB(second);
    await render();
    expect(button("Start work").disabled).toBe(true);
    await click(`MacBook: ${second.rootPath}`);
    await click("Start work");
    expect(state.restore.mock.calls[0]![0].input.grant.sourceCopy.id).toBe(second.id);
  });

  it("requires the review action before retrying a definite source snapshot rejection", async () => {
    state.copies = [copy];
    params = { ...params, reuseEnvironmentId: computerB };
    restoreToB({ ...copy, recovery: recoveryMetadata });
    state.snapshotCopy.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked" }))),
    );
    await render();
    await click("Start work");
    expect(button("Start work").disabled).toBe(true);
    expect(button("Review latest source files").disabled).toBe(false);
    state.readStatus.mockResolvedValue(
      AsyncResult.success({ copy, blockers: [], reviewToken: "latest-review" }),
    );
    await click("Review latest source files");
    expect(button("Start work").disabled).toBe(false);
    await click("Start work");
    expect(state.snapshotCopy.mock.calls[0]![0].input.reviewToken).toBe("review");
    expect(state.snapshotCopy.mock.calls[1]![0].input).toEqual({
      requestId: `${state.snapshotCopy.mock.calls[0]![0].input.requestId}:1`,
      workingCopyId: copy.id,
      reviewToken: "latest-review",
    });
    expect(state.restore).toHaveBeenCalledOnce();
  });

  it("keeps unregistered released exact-root restoration on its original identity", async () => {
    state.copies = [{ ...savedCopy, registered: false }];
    state.reopen.mockResolvedValue(
      AsyncResult.success({ ...savedCopy, state: "ready", registered: true, keepOnComputer: true }),
    );
    params = { ...params, reuseEnvironmentId: computerA, initialCopyId: copy.id };
    await render();
    await click("Start work");
    expect(state.reopen).toHaveBeenCalledWith({
      environmentId: computerA,
      input: { requestId: expect.stringContaining(":reopen"), workingCopyId: copy.id },
    });
    expect(state.restore).not.toHaveBeenCalled();
    expect(state.prepare).not.toHaveBeenCalled();
  });
});
