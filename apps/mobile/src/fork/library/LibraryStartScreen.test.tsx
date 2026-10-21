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
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
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
  source: null as {
    summary: {
      title: string;
      resourceIds: string[];
      environmentId: EnvironmentId;
      threadId: ThreadId;
      sequence: number;
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
    copyHealth: vi.fn(),
    prepareCopy: state.prepare,
    bindThread: state.bind,
    registerCopy: state.registerCopy,
    registerThread: state.registerThread,
    reopenCopy: state.reopen,
    setCopyRetention: state.retention,
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
    new Map(state.computers.map((computer) => [computer.environmentId, computer.serverConfig])),
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
      atom === "copies"
        ? { _tag: "Success", value: state.copies, waiting: false }
        : state.computers.find((computer) => computer.environmentId === atom),
  },
}));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationAtom: (id: unknown) => id },
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: string | null) => ({
    data: query === "project" ? state.project : query === "copies" ? state.copies : state.source,
    error: query === "copies" ? state.copiesError : query === "history" ? state.sourceError : null,
    isPending:
      query === "copies" ? state.copiesPending : query === "history" ? state.sourcePending : false,
    isSuccess: true,
    refresh: state.refresh,
  }),
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
const makeComputer = (id: EnvironmentId, label: string, online = true): Computer => ({
  environmentId: id,
  label,
  entry: { enabled: true },
  connection: { phase: online ? "connected" : "offline" },
  serverConfig: {
    environment: { capabilities: { loomFeatures: ["project-library", "library-file-lifecycle"] } },
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
  state.source = null;
  state.warning = null;
  state.prepare.mockResolvedValue(AsyncResult.success(copy));
  state.create.mockResolvedValue(AsyncResult.success({}));
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
          remoteUrl: null,
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
    expect(state.prepare).toHaveBeenCalledWith({
      environmentId: computerA,
      input: expect.objectContaining({
        rootPath: "/Projects/Reviewed",
        strategy: "clone",
        resourceIds: [],
      }),
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
        remoteUrl: null,
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
