import { libraryLaunchRanking } from "@t3tools/client-runtime/fork";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  LibraryError,
  type LibraryProject,
  type LibraryWorkingCopy,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  commands: {
    bindThread: { run: vi.fn() },
    prepareCopy: { run: vi.fn() },
    reopenCopy: { run: vi.fn() },
    readCopyStatus: { run: vi.fn() },
    snapshotCopy: { run: vi.fn() },
    authorizeRecovery: { run: vi.fn() },
    restoreCopy: { run: vi.fn() },
    setCopyRetention: { run: vi.fn() },
    registerCopy: { run: vi.fn() },
    registerThread: { run: vi.fn() },
    inspectFolder: { run: vi.fn() },
    resolveBinding: { run: vi.fn() },
    snapshotThread: { run: vi.fn() },
    preparation: { run: vi.fn() },
    create: { run: vi.fn() },
    pull: { run: vi.fn() },
  },
  authority: vi.fn(),
  providers: vi.fn(),
  projects: vi.fn(),
  registryGet: vi.fn(),
  waitForProject: vi.fn(),
  query: vi.fn(),
  ranking: vi.fn(),
  navigate: vi.fn(),
  retainedQuery: {},
  historyQuery: {},
  configsAtom: {},
  providersAtom: {},
  nextId: 0,
}));
vi.mock("./state", () => ({
  projectLibrary: {
    ...state.commands,
    copies: () => state.retainedQuery,
    history: () => state.historyQuery,
  },
  useLibraryAuthority: state.authority,
  useLibraryPermission: () => true,
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: { run: unknown }) => command.run,
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (command: { run: unknown }) => command.run,
}));
vi.mock("~/state/use-orchestration-command", () => ({
  useOrchestrationCommand: (command: { run: unknown }) => command.run,
}));
vi.mock("~/state/threads", () => ({ threadEnvironment: { create: state.commands.create } }));
vi.mock("~/state/vcs", () => ({ vcsEnvironment: { pull: state.commands.pull } }));
vi.mock("~/state/query", () => ({ useEnvironmentQuery: state.query }));
vi.mock("~/state/environments", () => ({ useEnvironmentProviders: state.providers }));
vi.mock("~/state/entities", () => ({
  useProjects: state.projects,
  waitForProject: state.waitForProject,
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: state.registryGet } }));
vi.mock("~/state/server", () => ({
  environmentServerConfigsAtom: state.configsAtom,
  serverEnvironment: { providersValueAtom: () => state.providersAtom },
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: () => ({}),
  mergeEnvironmentSettings: (settings: unknown) => settings,
}));
vi.mock("~/modelSelection", () => ({ getCustomModelOptionsByInstance: () => ({}) }));
vi.mock("~/composerDraftStore", () => ({
  useComposerDraftStore: { getState: () => ({ setPrompt: vi.fn() }) },
}));
vi.mock("~/lib/utils", () => ({
  newThreadId: () => "new-thread",
  randomUUID: () => `launch-request-${++state.nextId}`,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: "a",
  useNavigate: () => state.navigate,
}));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "input" }));
vi.mock("~/components/ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("~/components/ui/select", () => ({
  Select: "select",
  SelectTrigger: "div",
  SelectValue: "span",
  SelectPopup: "div",
  SelectItem: "option",
}));
vi.mock("~/components/chat/ProviderModelPicker", () => ({ ProviderModelPicker: () => null }));
vi.mock("~/components/chat/TraitsPicker", () => ({ TraitsPicker: () => null }));
vi.mock("./ProfileReadiness", () => ({ ProfileReadiness: () => null }));
vi.mock("./ReleaseCopyDialog", () => ({ ReleaseCopyDialog: () => null }));
vi.mock("./useLibraryLaunchRanking", () => ({ useLibraryLaunchRanking: state.ranking }));
vi.mock("./LibraryControls", () => ({
  LibraryDialog: ({ children, actions }: { children: ReactNode; actions: ReactNode }) => (
    <dialog>
      {children}
      {actions}
    </dialog>
  ),
  LibraryField: ({ children, label }: { children: ReactNode; label: string }) => (
    <label>
      {label}
      {children}
    </label>
  ),
  LibraryErrorNotice: ({ error }: { error: string | null }) =>
    error ? <p role="alert">{error}</p> : null,
}));

import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { TraitsPicker } from "~/components/chat/TraitsPicker";
import { NewConversationDialog } from "./NewConversationDialog";
import { readLibraryAttempt, saveLibraryAttempt } from "./attempts";

const environmentId = EnvironmentId.make("host");
const authorityId = EnvironmentId.make("authority");
const localProjectId = ProjectId.make("local-project");
const threadId = ThreadId.make("new-thread");
const instanceId = ProviderInstanceId.make("codex");
const provider: ServerProvider = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-15T12:00:00.000Z",
  models: [
    { slug: "test-model", name: "Test model", capabilities: {}, isCustom: false, isDefault: true },
  ],
  slashCommands: [],
  skills: [],
};
const project: LibraryProject = {
  id: "library-project",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: provider.checkedAt,
  updatedAt: provider.checkedAt,
};
const releasedCopy: LibraryWorkingCopy = {
  id: "saved-files",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId,
  rootPath: "/work/project",
  rootLocalProjectId: localProjectId,
  repositories: [],
  ownership: "managed",
  state: "released",
  recovery: {
    sha256: "a".repeat(64),
    byteLength: 100,
    archiveKey: "source-archive",
    verifiedAt: project.updatedAt,
  },
  keepOnComputer: false,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const restoredCopy: LibraryWorkingCopy = { ...releasedCopy, state: "ready", keepOnComputer: true };
const temporaryCopy: LibraryWorkingCopy = {
  ...restoredCopy,
  keepOnComputer: false,
  updatedAt: "2026-10-21T12:00:00.000Z",
};
const binding = {
  projectId: project.id,
  projectRevision: project.revision,
  workingCopyId: releasedCopy.id,
  environmentId,
  resourceIds: [],
};
const commands = state.commands;
const attemptKey = `loom:library:conversation:${authorityId}:${project.id}`;
const reopeningKey = `loom:library:launch-reopen:${authorityId}:${project.id}`;
const portableKey = `loom:library:launch-portable:${authorityId}:${project.id}`;
const preparationKey = `loom:library:launch-files:${authorityId}:${project.id}`;
const onChanged = vi.fn();
const onClose = vi.fn();
const failure = (message: string) => AsyncResult.failure(Cause.fail(new Error(message)));
const bindingReceipt = AsyncResult.success(null);
let renderer: ReactTestRenderer | undefined;
let storage: Storage;

async function mount(
  copies: readonly LibraryWorkingCopy[] = [],
  defaults: Partial<ComponentProps<typeof NewConversationDialog>> = {},
) {
  await act(() => {
    renderer = create(
      <NewConversationDialog
        project={project}
        copies={copies}
        {...defaults}
        copiesQuery={{ isPending: false, isSuccess: true, error: null, refresh: vi.fn() }}
        onChanged={onChanged}
        onClose={onClose}
      />,
    );
  });
}
function button(label: string) {
  const match = renderer!.root
    .findAllByType("button")
    .find((node) => node.children.includes(label));
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
async function click(label: string) {
  expect(button(label).props.disabled).not.toBe(true);
  await act(() => button(label).props.onClick());
}
function savedAttempt() {
  const serialized = storage.getItem(attemptKey);
  expect(readLibraryAttempt(attemptKey, storage)).toBe(serialized);
  return serialized === null ? null : JSON.parse(serialized);
}
function expectOpened() {
  expect(savedAttempt()).toBeNull();
  expect(commands.snapshotThread.run).toHaveBeenCalledWith({
    environmentId,
    input: { threadId },
  });
  expect(commands.registerThread.run).toHaveBeenCalledOnce();
  expect(onClose).toHaveBeenCalledOnce();
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId, threadId },
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const values = new Map<string, string>();
  storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
  };
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  for (const key of [attemptKey, reopeningKey, preparationKey, portableKey])
    saveLibraryAttempt(key, null, storage);
  for (const command of Object.values(commands)) command.run.mockReset();
  state.nextId = 0;
  const serverConfig = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      defaultModelSelection: { instanceId, model: "test-model" },
    },
    newProjectsRoot: "/work",
    environment: {
      capabilities: {
        supportsExecution: true,
        loomFeatures: ["project-library", "library-file-lifecycle"],
      },
    },
  };
  state.authority.mockReturnValue({
    authorityId,
    connected: true,
    computers: [],
    environments: [
      {
        environmentId,
        label: "Computer",
        entry: { enabled: true },
        connection: { phase: "connected" },
        serverConfig,
      },
    ],
  });
  state.providers.mockReturnValue(new Map([[environmentId, [provider]]]));
  state.projects.mockReturnValue([]);
  state.registryGet.mockImplementation((atom: unknown) =>
    atom === state.configsAtom ? new Map([[environmentId, serverConfig]]) : [provider],
  );
  state.waitForProject.mockResolvedValue({ id: localProjectId });
  state.query.mockImplementation((query: unknown) => ({
    data: query === state.retainedQuery ? [releasedCopy] : undefined,
    isPending: false,
    isSuccess: true,
    error: null,
    refresh: vi.fn(),
  }));
  state.ranking.mockImplementation(
    (input: { project: LibraryProject; copies: readonly LibraryWorkingCopy[]; resourceId: null }) =>
      libraryLaunchRanking({
        ...input,
        computers: [
          {
            environmentId,
            label: "Computer",
            online: true,
            supportsExecution: true,
            workingThreads: 0,
          },
        ],
        threads: [],
      }),
  );
  state.navigate.mockReset().mockResolvedValue(undefined);
  onChanged.mockReset();
  onClose.mockReset();
  commands.reopenCopy.run.mockResolvedValue(AsyncResult.success(restoredCopy));
  commands.registerCopy.run.mockImplementation(
    async (input: { input: { copy: LibraryWorkingCopy } }) => AsyncResult.success(input.input.copy),
  );
  commands.resolveBinding.run.mockResolvedValue(
    AsyncResult.success({ localProjectId, cwd: restoredCopy.rootPath }),
  );
  commands.create.run.mockResolvedValue(AsyncResult.success(null));
  commands.bindThread.run.mockResolvedValue(bindingReceipt);
  commands.setCopyRetention.run.mockResolvedValue(AsyncResult.success(temporaryCopy));
  commands.snapshotThread.run.mockResolvedValue(AsyncResult.success({ summary: { threadId } }));
  commands.registerThread.run.mockResolvedValue(AsyncResult.success(null));
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  for (const key of [attemptKey, reopeningKey, preparationKey, portableKey])
    saveLibraryAttempt(key, null, storage);
  vi.unstubAllGlobals();
});

describe("Library conversation retention", () => {
  it.each([true, false])(
    "restores saved files with registered=%s and binds the new thread before enabling cleanup",
    async (registered) => {
      state.query.mockImplementation((query: unknown) => ({
        data: query === state.retainedQuery ? [{ ...releasedCopy, registered }] : undefined,
        isPending: false,
        isSuccess: true,
        error: null,
        refresh: vi.fn(),
      }));
      let resolveBind!: (receipt: typeof bindingReceipt) => void;
      const bindingPromise = new Promise<typeof bindingReceipt>((resolve) => {
        resolveBind = resolve;
      });
      commands.bindThread.run.mockReturnValueOnce(bindingPromise);
      await mount();
      const keep = renderer!.root.findAllByType("input").find((node) => "checked" in node.props);
      expect(keep?.props.checked).toBe(false);
      await click("Start conversation");

      expect(commands.reopenCopy.run).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: { requestId: expect.any(String), workingCopyId: releasedCopy.id },
      });
      expect(commands.prepareCopy.run).not.toHaveBeenCalled();
      expect(commands.registerCopy.run).toHaveBeenCalledExactlyOnceWith({
        environmentId: authorityId,
        input: { requestId: expect.any(String), copy: restoredCopy },
      });
      expect(commands.create.run).toHaveBeenCalledWith({
        environmentId,
        input: expect.objectContaining({ threadId, projectId: localProjectId }),
      });
      expect(commands.bindThread.run).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: { threadId, binding, project },
      });
      expect(commands.setCopyRetention.run).not.toHaveBeenCalled();
      expect(commands.snapshotThread.run).not.toHaveBeenCalled();
      expect(state.navigate).not.toHaveBeenCalled();
      expect(savedAttempt()).toMatchObject({ threadId, created: true, keepOnComputer: false });

      await act(() => resolveBind(bindingReceipt));

      expect(commands.setCopyRetention.run).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: { workingCopyId: restoredCopy.id, keepOnComputer: false },
      });
      expect(commands.registerCopy.run).toHaveBeenNthCalledWith(2, {
        environmentId: authorityId,
        input: { requestId: expect.stringMatching(/:retention$/), copy: temporaryCopy },
      });
      expectOpened();
    },
  );

  it("persists a successful retention mutation and republishes its receipt after an authority failure and remount", async () => {
    commands.registerCopy.run
      .mockResolvedValueOnce(AsyncResult.success(restoredCopy))
      .mockImplementationOnce(async () => {
        expect(savedAttempt()).toMatchObject({
          threadId,
          created: true,
          keepOnComputer: false,
          retentionCopy: temporaryCopy,
        });
        return failure("Authority unavailable");
      });
    await mount();
    await click("Start conversation");

    expect(renderer!.root.findByProps({ role: "alert" }).children).toContain(
      "Authority unavailable",
    );
    expect(commands.setCopyRetention.run).toHaveBeenCalledOnce();
    expect(savedAttempt()).toMatchObject({ retentionCopy: temporaryCopy });
    expect(commands.snapshotThread.run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    const failedPublication = commands.registerCopy.run.mock.calls[1]![0];

    await act(() => renderer!.unmount());
    renderer = undefined;
    // The authority still has the kept restoration because publishing the changed policy failed.
    await mount([restoredCopy]);
    await click("Retry conversation");

    expect(commands.reopenCopy.run).toHaveBeenCalledOnce();
    expect(commands.create.run).toHaveBeenCalledOnce();
    expect(commands.setCopyRetention.run).toHaveBeenCalledOnce();
    expect(commands.registerCopy.run).toHaveBeenCalledTimes(3);
    expect(commands.registerCopy.run).toHaveBeenLastCalledWith(failedPublication);
    expectOpened();
  });

  it("keeps restored files protected when binding fails and enables cleanup only after retry succeeds", async () => {
    commands.bindThread.run.mockResolvedValueOnce(failure("Thread binding failed"));
    await mount();
    await click("Start conversation");

    expect(renderer!.root.findByProps({ role: "alert" }).children).toContain(
      "Thread binding failed",
    );
    expect(commands.setCopyRetention.run).not.toHaveBeenCalled();
    expect(commands.registerCopy.run).toHaveBeenCalledTimes(1);
    expect(commands.registerCopy.run).toHaveBeenCalledWith({
      environmentId: authorityId,
      input: { requestId: expect.any(String), copy: restoredCopy },
    });
    expect(savedAttempt()).toMatchObject({ threadId, created: true, keepOnComputer: false });
    expect(savedAttempt()).not.toHaveProperty("retentionCopy");
    expect(commands.snapshotThread.run).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();

    await click("Retry conversation");

    expect(commands.reopenCopy.run).toHaveBeenCalledOnce();
    expect(commands.create.run).toHaveBeenCalledOnce();
    expect(commands.bindThread.run).toHaveBeenCalledTimes(2);
    expect(commands.bindThread.run.mock.calls[1]).toEqual(commands.bindThread.run.mock.calls[0]);
    expect(commands.setCopyRetention.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { workingCopyId: restoredCopy.id, keepOnComputer: false },
    });
    expectOpened();
  });
});

describe("new conversations with source settings", () => {
  const sourceSelection = {
    instanceId,
    model: "source-model",
    options: [{ id: "reasoningEffort", value: "high" }],
  };
  const sourceDefaults = {
    initialHostId: environmentId,
    initialCopyId: releasedCopy.id,
    initialModelSelection: sourceSelection,
    initialRuntimeMode: "auto" as const,
    initialInteractionMode: "plan" as const,
  };

  it("restores files automatically and creates a fresh empty conversation with the source launch settings", async () => {
    await mount([], sourceDefaults);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    expect(commands.create.run).not.toHaveBeenCalled();
    await click("Start conversation");
    expect(commands.reopenCopy.run).toHaveBeenCalledOnce();
    expect(commands.create.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        threadId,
        projectId: localProjectId,
        title: "New project conversation",
        modelSelection: sourceSelection,
        runtimeMode: "auto",
        interactionMode: "plan",
        branch: null,
        worktreePath: restoredCopy.rootPath,
        createdAt: expect.any(String),
      },
    });
    expect(commands.bindThread.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId, binding, project },
    });
    expectOpened();
  });

  it("uses edits to the source model, options, permissions and mode before starting", async () => {
    await mount([], sourceDefaults);
    await act(() =>
      renderer!.root
        .findByType(ProviderModelPicker)
        .props.onInstanceModelChange(instanceId, "edited-model"),
    );
    const options = [{ id: "reasoningEffort", value: "low" }];
    await act(() => renderer!.root.findByType(TraitsPicker).props.onModelOptionsChange(options));
    await act(() => {
      renderer!.root
        .findAllByType("select")
        .find((node) => node.props.value === "auto")!
        .props.onValueChange("approval-required");
      renderer!.root
        .findAllByType("select")
        .find((node) => node.props.value === "plan")!
        .props.onValueChange("default");
    });
    await click("Start conversation");
    expect(commands.create.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        modelSelection: { instanceId, model: "edited-model", options },
        runtimeMode: "approval-required",
        interactionMode: "default",
      }),
    });
    expectOpened();
  });

  it("drops source machine defaults when a different computer is selected", async () => {
    const otherId = EnvironmentId.make("other-computer");
    const authority = state.authority();
    const otherSelection = { instanceId, model: "other-model" };
    const serverConfig = {
      ...authority.environments[0].serverConfig,
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        defaultModelSelection: otherSelection,
        defaultRuntimeMode: "approval-required",
      },
    };
    state.authority.mockReturnValue({
      ...authority,
      environments: [
        ...authority.environments,
        {
          ...authority.environments[0],
          environmentId: otherId,
          label: "Other computer",
          serverConfig,
        },
      ],
    });
    state.providers.mockReturnValue(
      new Map([
        [environmentId, [provider]],
        [otherId, [provider]],
      ]),
    );
    state.registryGet.mockImplementation((atom: unknown) =>
      atom === state.configsAtom
        ? new Map([
            [environmentId, authority.environments[0].serverConfig],
            [otherId, serverConfig],
          ])
        : [provider],
    );
    state.ranking.mockImplementation(
      (input: {
        project: LibraryProject;
        copies: readonly LibraryWorkingCopy[];
        resourceId: string | null;
      }) =>
        libraryLaunchRanking({
          ...input,
          computers: [environmentId, otherId].map((id) => ({
            environmentId: id,
            label: id,
            online: true,
            supportsExecution: true,
            workingThreads: 0,
          })),
          threads: [],
        }),
    );
    const otherCopy = { ...restoredCopy, id: "other-files", environmentId: otherId };
    await mount([restoredCopy, otherCopy], sourceDefaults);
    await act(() =>
      renderer!.root
        .findAllByType("select")
        .find((node) => node.props.value === environmentId)!
        .props.onValueChange(otherId),
    );
    await act(() =>
      renderer!.root
        .findAllByType("select")
        .find((node) =>
          node.props.items?.some((item: { value: string }) => item.value === otherCopy.id),
        )!
        .props.onValueChange(otherCopy.id),
    );
    await click("Start conversation");
    expect(commands.create.run).toHaveBeenCalledWith({
      environmentId: otherId,
      input: expect.objectContaining({
        modelSelection: otherSelection,
        runtimeMode: "approval-required",
        interactionMode: "default",
      }),
    });
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId: otherId,
      input: {
        threadId,
        project,
        binding: { ...binding, environmentId: otherId, workingCopyId: otherCopy.id },
      },
    });
    expect(commands.reopenCopy.run).not.toHaveBeenCalled();
  });

  it("recovers the selected launch settings after a failure and remount", async () => {
    commands.resolveBinding.run.mockResolvedValueOnce(failure("Disconnected"));
    await mount([], sourceDefaults);
    await click("Start conversation");
    expect(savedAttempt()).toMatchObject({
      modelSelection: sourceSelection,
      requestedModelSelection: sourceSelection,
      runtimeMode: "auto",
      requestedRuntimeMode: "auto",
      interactionMode: "plan",
      created: false,
    });
    expect(commands.create.run).not.toHaveBeenCalled();
    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([restoredCopy]);
    await click("Retry conversation");
    expect(commands.create.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: expect.objectContaining({
        modelSelection: sourceSelection,
        runtimeMode: "auto",
        interactionMode: "plan",
      }),
    });
    expectOpened();
  });

  it("leaves the regular form blank and resolves its project defaults", async () => {
    await mount();
    const title = renderer!.root.findAllByType("input").find((node) => "value" in node.props);
    expect(title?.props.value).toBe("");
    await click("Start conversation");
    expect(commands.create.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        modelSelection: { instanceId, model: "test-model" },
        runtimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
        interactionMode: "default",
      }),
    });
    expectOpened();
  });
});

describe("portable project launch", () => {
  const sourceEnvironmentId = EnvironmentId.make("source-computer");
  const sourceCopy: LibraryWorkingCopy = {
    ...releasedCopy,
    id: "source-files",
    environmentId: sourceEnvironmentId,
    rootPath: "/source/project",
  };
  const destinationCopy: LibraryWorkingCopy = {
    ...restoredCopy,
    id: "portable-files",
    rootPath: "/work/project",
  };
  const sourceSummary = {
    id: "saved-conversation",
    projectId: project.id,
    environmentId: sourceEnvironmentId,
    threadId: ThreadId.make("original-thread"),
    localProjectId,
    workingCopyId: sourceCopy.id,
    resourceIds: [],
    title: "Original work",
    status: "completed",
    archived: false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    syncedAt: project.updatedAt,
    sequence: 5,
  };
  function setup(sources: readonly LibraryWorkingCopy[] = [sourceCopy], onlineSource = false) {
    const previous = state.authority();
    const host = previous.environments[0];
    state.authority.mockReturnValue({
      ...previous,
      environments: [
        {
          ...host,
          serverConfig: {
            ...host.serverConfig,
            environment: {
              capabilities: {
                supportsExecution: true,
                loomFeatures: [
                  "project-library",
                  "library-file-lifecycle",
                  "library-portable-recovery",
                ],
              },
            },
          },
        },
        ...(onlineSource
          ? [
              {
                ...host,
                environmentId: sourceEnvironmentId,
                label: "Source computer",
                serverConfig: {
                  ...host.serverConfig,
                  environment: {
                    capabilities: {
                      supportsExecution: true,
                      loomFeatures: [
                        "project-library",
                        "library-file-lifecycle",
                        "library-portable-recovery",
                      ],
                    },
                  },
                },
              },
            ]
          : []),
      ],
      computers: [
        { environmentId: sourceEnvironmentId, label: "Source computer", supportsExecution: true },
      ],
    });
    state.query.mockImplementation((query: unknown) => ({
      data:
        query === state.retainedQuery
          ? sources
          : query === state.historyQuery
            ? { summary: sourceSummary, projection: { messages: [], visibleTurnItems: [] } }
            : undefined,
      isPending: false,
      isSuccess: true,
      error: null,
      refresh: vi.fn(),
    }));
    commands.authorizeRecovery.run.mockResolvedValue(
      AsyncResult.success({
        sourceCopy: sources[0],
        destinationEnvironmentId: environmentId,
        libraryEnvironmentId: authorityId,
        expiresAt: "2026-10-21T12:05:00.000Z",
        accessToken: "private-download-token",
      }),
    );
    commands.restoreCopy.run.mockResolvedValue(AsyncResult.success(destinationCopy));
    commands.inspectFolder.run.mockResolvedValue(
      AsyncResult.success({ rootPath: destinationCopy.rootPath, exists: false, repositories: [] }),
    );
    commands.setCopyRetention.run.mockResolvedValue(
      AsyncResult.success({ ...destinationCopy, keepOnComputer: false }),
    );
    commands.readCopyStatus.run.mockResolvedValue(
      AsyncResult.success({ copy: sources[0], blockers: [], reviewToken: "review-source" }),
    );
    commands.snapshotCopy.run.mockResolvedValue(AsyncResult.success(sources[0]));
    return destinationCopy;
  }

  it("restores the unique saved source from an offline computer and binds a fresh destination before temporary cleanup", async () => {
    const restored = setup();
    await mount();
    await click("Start conversation");
    expect(commands.authorizeRecovery.run).toHaveBeenCalledWith({
      environmentId: authorityId,
      input: {
        sourceEnvironmentId,
        workingCopyId: sourceCopy.id,
        destinationEnvironmentId: environmentId,
        sourceCopy,
      },
    });
    expect(commands.restoreCopy.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({ project, rootPath: restored.rootPath }),
    });
    expect(commands.prepareCopy.run).not.toHaveBeenCalled();
    expect(commands.reopenCopy.run).not.toHaveBeenCalled();
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId,
      input: { threadId, project, binding: { ...binding, workingCopyId: restored.id } },
    });
    expect(commands.bindThread.run.mock.invocationCallOrder[0]).toBeLessThan(
      commands.setCopyRetention.run.mock.invocationCallOrder[0]!,
    );
    expect(commands.readCopyStatus.run).not.toHaveBeenCalled();
    expect(
      [...Array(storage.length)].map((_, index) => storage.getItem(storage.key(index)!)).join(),
    ).not.toContain("private-download-token");
    expectOpened();
  });

  it("uses newer released source metadata instead of a stale ready-copy list", async () => {
    const latest = { ...sourceCopy, updatedAt: "2026-10-22T12:00:00.000Z" };
    setup([latest]);
    await mount([{ ...sourceCopy, state: "ready" }]);
    await click("Start conversation");
    expect(commands.readCopyStatus.run).not.toHaveBeenCalled();
    expect(commands.snapshotCopy.run).not.toHaveBeenCalled();
    expect(commands.restoreCopy.run).toHaveBeenCalledOnce();
    expectOpened();
  });

  it("makes competing saved states an explicit choice", async () => {
    const second = { ...sourceCopy, id: "other-saved-files", rootPath: "/other/project" };
    setup([sourceCopy, second]);
    await mount();
    expect(button("Start conversation").props.disabled).toBe(true);
    expect(commands.authorizeRecovery.run).not.toHaveBeenCalled();
    await act(() =>
      renderer!.root
        .findAllByType("select")
        .find((node) =>
          node.props.items?.some((item: { value: string }) => item.value === second.id),
        )!
        .props.onValueChange(sourceCopy.id),
    );
    await click("Start conversation");
    expect(commands.authorizeRecovery.run).toHaveBeenCalledWith({
      environmentId: authorityId,
      input: expect.objectContaining({ workingCopyId: sourceCopy.id }),
    });
  });

  it("blocks an offline ready source even when an older archive is available", async () => {
    setup([{ ...sourceCopy, state: "ready" }]);
    await mount();
    expect(button("Start conversation").props.disabled).toBe(true);
    expect(
      renderer!.root.findAllByProps({ role: "alert" }).map((node) => node.children.join()),
    ).toContain("Connect the source computer to save its latest files before starting here.");
    expect(commands.authorizeRecovery.run).not.toHaveBeenCalled();
  });

  it("refreshes a ready source before authority authorization", async () => {
    setup([{ ...sourceCopy, state: "ready" }], true);
    await mount();
    await click("Start conversation");
    expect(commands.readCopyStatus.run).toHaveBeenCalledWith({
      environmentId: sourceEnvironmentId,
      input: { workingCopyId: sourceCopy.id },
    });
    expect(commands.snapshotCopy.run).toHaveBeenCalledWith({
      environmentId: sourceEnvironmentId,
      input: {
        requestId: expect.any(String),
        workingCopyId: sourceCopy.id,
        reviewToken: "review-source",
      },
    });
    expect(commands.registerCopy.run.mock.invocationCallOrder[0]).toBeLessThan(
      commands.authorizeRecovery.run.mock.invocationCallOrder[0]!,
    );
    expectOpened();
  });

  it("reviews a definitively rejected source snapshot without changing the destination or conversation intent", async () => {
    setup([{ ...sourceCopy, state: "ready" }], true);
    commands.snapshotCopy.run.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked" }))),
    );
    await mount([], { continuation: sourceSummary });
    await click("Start conversation");
    const rejected = JSON.parse(storage.getItem(portableKey)!);
    expect(rejected).toMatchObject({
      sourceReviewToken: "review-source",
      sourceSnapshotRejected: true,
    });
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
    expect(commands.create.run).not.toHaveBeenCalled();
    expect(button("Retry conversation").props.disabled).toBe(true);

    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([], { continuation: sourceSummary });
    expect(button("Retry conversation").props.disabled).toBe(true);
    await click("Review latest source files");
    const reviewed = JSON.parse(storage.getItem(portableKey)!);
    expect(reviewed.snapshotRequestId).not.toBe(rejected.snapshotRequestId);
    expect(reviewed.sourceReviewToken).toBeUndefined();
    expect(reviewed.sourceSnapshotRejected).toBeUndefined();
    expect({
      ...reviewed,
      snapshotRequestId: rejected.snapshotRequestId,
      sourceReviewToken: rejected.sourceReviewToken,
      sourceSnapshotRejected: true,
    }).toEqual(rejected);
    commands.readCopyStatus.run.mockResolvedValue(
      AsyncResult.success({
        copy: { ...sourceCopy, state: "ready" },
        blockers: [],
        reviewToken: "latest-review",
      }),
    );
    await click("Retry conversation");
    expect(commands.snapshotCopy.run).toHaveBeenLastCalledWith({
      environmentId: sourceEnvironmentId,
      input: {
        requestId: reviewed.snapshotRequestId,
        workingCopyId: sourceCopy.id,
        reviewToken: "latest-review",
      },
    });
    expect(commands.restoreCopy.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        requestId: rejected.requestId,
        rootPath: rejected.rootPath,
      }),
    });
    expect(commands.bindThread.run).toHaveBeenCalledOnce();
    expect(commands.create.run).toHaveBeenCalledOnce();
    expectOpened();
  });

  it("replays the exact reviewed source snapshot after an uncertain failure and remount", async () => {
    setup([{ ...sourceCopy, state: "ready" }], true);
    commands.snapshotCopy.run.mockResolvedValueOnce(failure("Source disconnected"));
    await mount();
    await click("Start conversation");
    const snapshot = commands.snapshotCopy.run.mock.calls[0];
    expect(JSON.parse(storage.getItem(portableKey)!).sourceSnapshotRejected).not.toBe(true);
    await act(() => renderer!.unmount());
    renderer = undefined;
    commands.readCopyStatus.run.mockResolvedValue(
      AsyncResult.success({
        copy: { ...sourceCopy, state: "ready" },
        blockers: [],
        reviewToken: "changed-review",
      }),
    );
    await mount();
    expect(
      renderer!.root
        .findAllByType("button")
        .some((node) => node.children.includes("Review latest source files")),
    ).toBe(false);
    await click("Retry conversation");
    expect(commands.snapshotCopy.run.mock.calls[1]).toEqual(snapshot);
    expect(commands.readCopyStatus.run).toHaveBeenCalledOnce();
    expectOpened();
  });

  it("asks before using an occupied destination folder and never dispatches a restore over its files", async () => {
    setup();
    commands.inspectFolder.run.mockResolvedValue(
      AsyncResult.success({ rootPath: destinationCopy.rootPath, exists: true, repositories: [] }),
    );
    await mount();
    await click("Start conversation");
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
    expect(storage.getItem(portableKey)).toBeNull();
    expect(button("Start conversation").props.disabled).toBe(true);
    await click("Use files in this folder");
    const existing = { ...destinationCopy, ownership: "borrowed" as const };
    commands.prepareCopy.run.mockResolvedValue(AsyncResult.success(existing));
    await click("Start conversation");
    expect(commands.prepareCopy.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({ rootPath: destinationCopy.rootPath, strategy: "reuse" }),
    });
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
    expectOpened();
  });

  it("lets a failed transfer review files again without overwriting a destination whose response was lost", async () => {
    setup();
    commands.restoreCopy.run.mockResolvedValueOnce(failure("Destination disconnected"));
    await mount();
    await click("Start conversation");
    expect(storage.getItem(portableKey)).not.toBeNull();
    await click("Choose files again");
    expect(storage.getItem(portableKey)).toBeNull();
    commands.inspectFolder.run.mockResolvedValue(
      AsyncResult.success({ rootPath: destinationCopy.rootPath, exists: true, repositories: [] }),
    );
    await click("Start conversation");
    expect(commands.restoreCopy.run).toHaveBeenCalledOnce();
    expect(button("Start conversation").props.disabled).toBe(true);
    expect(button("Use files in this folder")).toBeDefined();
  });

  it("retries destination registration across remount without restoring or changing the destination identity", async () => {
    setup();
    commands.registerCopy.run.mockResolvedValueOnce(failure("Library offline"));
    await mount();
    await click("Start conversation");
    expect(JSON.parse(storage.getItem(portableKey)!)).toMatchObject({
      copy: destinationCopy,
      sourceCopy,
    });
    const registration = commands.registerCopy.run.mock.calls[0];
    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount();
    await click("Retry conversation");
    expect(commands.authorizeRecovery.run).toHaveBeenCalledOnce();
    expect(commands.restoreCopy.run).toHaveBeenCalledOnce();
    expect(commands.registerCopy.run.mock.calls[1]).toEqual(registration);
    expectOpened();
  });

  it("pins a continuation to its exact source instead of a newer saved copy", async () => {
    const newer = {
      ...sourceCopy,
      id: "newer-files",
      rootPath: "/source/newer",
      updatedAt: "2026-10-22T12:00:00.000Z",
    };
    setup([sourceCopy, newer]);
    await mount([], { continuation: sourceSummary });
    await click("Start conversation");
    expect(commands.authorizeRecovery.run).toHaveBeenCalledWith({
      environmentId: authorityId,
      input: {
        sourceEnvironmentId,
        workingCopyId: sourceCopy.id,
        destinationEnvironmentId: environmentId,
        sourceCopy,
      },
    });
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId,
      input: {
        threadId,
        project,
        binding: {
          ...binding,
          workingCopyId: destinationCopy.id,
          continuationOf: {
            environmentId: sourceEnvironmentId,
            threadId: sourceSummary.threadId,
            sequence: sourceSummary.sequence,
          },
        },
      },
    });
    expectOpened();
  });

  it("requires a deliberate choice before continuing with different files already on the destination", async () => {
    setup();
    await mount([restoredCopy], { continuation: sourceSummary });
    expect(button("Start conversation").props.disabled).toBe(true);
    await act(() =>
      renderer!.root
        .findAllByType("select")
        .find((node) =>
          node.props.items?.some((item: { value: string }) => item.value === sourceCopy.id),
        )!
        .props.onValueChange(restoredCopy.id),
    );
    await click("Start conversation");
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
    expect(commands.authorizeRecovery.run).not.toHaveBeenCalled();
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        binding: expect.objectContaining({
          workingCopyId: restoredCopy.id,
          continuationOf: {
            environmentId: sourceEnvironmentId,
            threadId: sourceSummary.threadId,
            sequence: sourceSummary.sequence,
          },
        }),
      }),
    });
    expectOpened();
  });

  it("preserves continuation context and chosen model options across a restore failure and remount", async () => {
    setup();
    commands.restoreCopy.run.mockResolvedValueOnce(failure("Destination disconnected"));
    const modelSelection = {
      instanceId,
      model: "test-model",
      options: [{ id: "reasoningEffort", value: "high" }],
    };
    await mount([], {
      continuation: sourceSummary,
      initialModelSelection: modelSelection,
      initialRuntimeMode: "auto",
      initialInteractionMode: "plan",
    });
    await click("Start conversation");
    const receipt = JSON.parse(storage.getItem(portableKey)!);
    expect(receipt.launch).toMatchObject({
      modelSelection,
      runtimeMode: "auto",
      interactionMode: "plan",
      continuationOf: {
        environmentId: sourceEnvironmentId,
        threadId: sourceSummary.threadId,
        sequence: sourceSummary.sequence,
      },
    });
    expect(receipt.launch.context).toContain("Original work");
    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount();
    await click("Retry conversation");
    expect(commands.restoreCopy.run.mock.calls[0]![0].input.requestId).toBe(
      commands.restoreCopy.run.mock.calls[1]![0].input.requestId,
    );
    expect(commands.create.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        modelSelection,
        runtimeMode: "auto",
        interactionMode: "plan",
        title: "Continue: Original work",
      }),
    });
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        binding: expect.objectContaining({ continuationOf: receipt.launch.continuationOf }),
      }),
    });
    expectOpened();
  });

  it("carries a multiple-repository continuation scope without expanding it to the whole project", async () => {
    const resources = ["app", "api", "docs"].map((id) => ({
      id,
      title: id,
      kind: "repository" as const,
      relativePath: id,
      remoteUrl: null,
      defaultBranch: null,
    }));
    const scopedProject = { ...project, resources };
    const scopedSource = {
      ...sourceCopy,
      repositories: resources.slice(0, 2).map((resource) => ({
        resourceId: resource.id,
        path: `${sourceCopy.rootPath}/${resource.id}`,
        localProjectId,
        head: "unpushed-local-head",
        branch: "local-only",
      })),
    };
    setup([scopedSource]);
    await mount([], {
      project: scopedProject,
      continuation: { ...sourceSummary, resourceIds: ["app", "api"] },
    });
    await click("Start conversation");
    expect(commands.restoreCopy.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({ resourceIds: ["app", "api"] }),
    });
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        binding: expect.objectContaining({ resourceIds: ["app", "api"] }),
      }),
    });
    expectOpened();
  });

  it("saves and restores the same local source into an explicitly chosen new folder", async () => {
    const localSource = { ...restoredCopy, id: "local-source" };
    setup([localSource]);
    const newPath = "/work/project-copy";
    const newCopy = { ...destinationCopy, rootPath: newPath };
    commands.restoreCopy.run.mockResolvedValue(AsyncResult.success(newCopy));
    commands.setCopyRetention.run.mockResolvedValue(
      AsyncResult.success({ ...newCopy, keepOnComputer: false }),
    );
    commands.resolveBinding.run.mockResolvedValue(
      AsyncResult.success({ localProjectId, cwd: newPath }),
    );
    await mount([localSource]);
    await act(() =>
      renderer!.root
        .findAllByType("input")
        .find((node) => node.props.font === "mono")!
        .props.onChange({ target: { value: newPath } }),
    );
    await click("Start conversation");
    expect(commands.snapshotCopy.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({ workingCopyId: localSource.id }),
    });
    expect(commands.restoreCopy.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({ rootPath: newPath }),
    });
    expect(commands.prepareCopy.run).not.toHaveBeenCalled();
    expect(commands.bindThread.run).toHaveBeenCalledWith({
      environmentId,
      input: expect.objectContaining({
        binding: expect.objectContaining({ workingCopyId: newCopy.id }),
      }),
    });
    expectOpened();
  });

  it("blocks source-less continuations instead of preparing an unrelated clone", async () => {
    setup();
    await mount([], { continuation: { ...sourceSummary, workingCopyId: null } });
    expect(button("Start conversation").props.disabled).toBe(true);
    expect(commands.prepareCopy.run).not.toHaveBeenCalled();
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
  });
});
