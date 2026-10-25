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
import { act, useEffect, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  commands: {
    executeOperation: { run: vi.fn() },
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
  permission: vi.fn(),
  providers: vi.fn(),
  projects: vi.fn(),
  shells: vi.fn(),
  registryGet: vi.fn(),
  waitForProject: vi.fn(),
  query: vi.fn(),
  ranking: vi.fn(),
  navigate: vi.fn(),
  retainedQuery: {},
  historyQuery: {},
  healthQuery: {},
  operationsQuery: {},
  threadIds: [] as string[],
  configsAtom: {},
  providersAtom: {},
  nextId: 0,
}));
vi.mock("./state", () => ({
  projectLibrary: {
    ...state.commands,
    copies: () => state.retainedQuery,
    history: () => state.historyQuery,
    copyHealth: () => state.healthQuery,
    operations: () => state.operationsQuery,
  },
  useLibraryAuthority: state.authority,
  useLibraryPermission: state.permission,
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
  useThreadShells: state.shells,
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
vi.mock("~/modelSelection", () => ({ getCustomModelOptionsByInstance: () => new Map() }));
vi.mock("~/composerDraftStore", () => {
  const sticky = { stickyActiveProvider: null, stickyModelSelectionByProvider: {} };
  return {
    useComposerDraftStore: Object.assign(
      (select: (store: typeof sticky) => unknown) => select(sticky),
      { getState: () => ({ ...sticky, setPrompt: vi.fn() }) },
    ),
  };
});
vi.mock("~/lib/utils", () => ({
  newThreadId: () => state.threadIds.shift() ?? "new-thread",
  randomUUID: () => `launch-request-${++state.nextId}`,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: "a",
  useNavigate: () => state.navigate,
}));
vi.mock("../vault/LibraryCloneRepair", () => ({ LibraryCloneRepair: () => null }));
vi.mock("./ReleaseCopyDialog", () => ({ ReleaseCopyDialog: () => null }));
vi.mock("./useLibraryLaunchRanking", () => ({ useLibraryLaunchRanking: state.ranking }));
vi.mock("~/fork/switchboard/switchboardPicker", () => ({
  withSwitchboardEntries: (component: unknown) => component,
}));
vi.mock("./ProfileReadiness", () => ({ ProfileReadiness: () => null }));
vi.mock("./LibraryPalette", () => ({
  LibraryPaletteDialog: ({ children }: { children: import("react").ReactNode }) => <>{children}</>,
  LibraryPaletteView: (
    props: ComponentProps<typeof import("./LibraryPalette").LibraryPaletteView>,
  ) => (
    <>
      <input value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} />
      {props.onBack ? <button onClick={props.onBack}>Back</button> : null}
      {props.items.map((item) => (
        <button key={item.id} disabled={props.busy || item.disabled} onClick={item.select}>
          {item.title}
          {item.description ? <small>{item.description}</small> : null}
        </button>
      ))}
      {props.message}
    </>
  ),
}));

import { NewConversationDialog, useLibraryConversationSetup } from "./NewConversationDialog";
import { ConversationAutoStartContext, type ConversationQuickStart } from "./ConversationPalette";
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
const continuationScope = `${authorityId}:${project.id}:continue:saved-conversation`;
const continuationAttemptKey = `loom:library:conversation:${continuationScope}`;
const continuationPortableKey = `loom:library:launch-portable:${continuationScope}`;
const savedKeys = ["conversation", "launch-files", "launch-reopen", "launch-portable"].flatMap(
  (kind) => [
    `loom:library:${kind}:${authorityId}:${project.id}`,
    `loom:library:${kind}:${continuationScope}`,
  ],
);
const onChanged = vi.fn();
const onClose = vi.fn();
const failure = (message: string) => AsyncResult.failure(Cause.fail(new Error(message)));
const bindingReceipt = AsyncResult.success(null);
let renderer: ReactTestRenderer | undefined;
let storage: Storage;

let launch: ReturnType<typeof useLibraryConversationSetup>;
function SetupHarness(props: Parameters<typeof useLibraryConversationSetup>[0]) {
  const current = useLibraryConversationSetup(props);
  useEffect(() => {
    launch = current;
  });
  return null;
}

async function mount(
  copies: readonly LibraryWorkingCopy[] = [],
  defaults: Partial<Parameters<typeof useLibraryConversationSetup>[0]> = {},
) {
  await act(() => {
    renderer = create(
      <SetupHarness
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
async function click(label: string) {
  if (label === "Start conversation" || label === "Retry conversation") {
    expect(launch.canCreate).toBe(true);
    await act(() => {
      void launch.submit();
    });
  } else if (label === "Review latest source files") await act(() => launch.reviewLatest?.());
  else if (label === "Start over") await act(() => launch.startOver?.());
  else if (label === "Use files in this folder")
    await act(() => launch.selectFolder(launch.existingFolder!));
  else throw new Error(`Unknown launch operation: ${label}`);
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
  for (const key of savedKeys) saveLibraryAttempt(key, null, storage);
  for (const command of Object.values(commands)) command.run.mockReset();
  state.permission.mockReset().mockReturnValue(true);
  state.nextId = 0;
  state.threadIds = [];
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
  state.shells.mockReturnValue([]);
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
  for (const key of savedKeys) saveLibraryAttempt(key, null, storage);
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
      expect(launch.keepOnComputer).toBe(false);
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

    expect(launch.error).toContain("Authority unavailable");
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

    expect(launch.error).toContain("Thread binding failed");
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
    expect(launch.continuation).toBeUndefined();
    expect(commands.create.run).not.toHaveBeenCalled();
    await click("Start conversation");
    expect(commands.reopenCopy.run).toHaveBeenCalledOnce();
    expect(commands.create.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: {
        threadId,
        projectId: localProjectId,
        title: "New conversation",
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
    await act(() => launch.setModelChoice({ instanceId, model: "edited-model" }));
    const options = [{ id: "reasoningEffort", value: "low" }];
    await act(() => launch.setModelChoice({ instanceId, model: "edited-model", options }));
    await act(() => {
      launch.setRuntimeChoice("approval-required");
      launch.setInteractionChoice("default");
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
    await act(() => launch.selectHost(otherId));
    await act(() => launch.selectCopy(otherCopy.id));
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
    expect(launch.title).toBe("");
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
    expect(launch.canCreate).toBe(false);
    expect(commands.authorizeRecovery.run).not.toHaveBeenCalled();
    await act(() => launch.selectCopy(sourceCopy.id));
    await click("Start conversation");
    expect(commands.authorizeRecovery.run).toHaveBeenCalledWith({
      environmentId: authorityId,
      input: expect.objectContaining({ workingCopyId: sourceCopy.id }),
    });
  });

  it("blocks an offline ready source even when an older archive is available", async () => {
    setup([{ ...sourceCopy, state: "ready" }]);
    await mount();
    expect(launch.canCreate).toBe(false);
    expect(launch.blocker).toContain("Connect the source computer to save its latest files");
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
    const rejected = JSON.parse(storage.getItem(continuationPortableKey)!);
    expect(rejected).toMatchObject({
      sourceReviewToken: "review-source",
      sourceSnapshotRejected: true,
    });
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
    expect(commands.create.run).not.toHaveBeenCalled();
    expect(launch.canCreate).toBe(false);

    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([], { continuation: sourceSummary });
    expect(launch.canCreate).toBe(false);
    await click("Review latest source files");
    const reviewed = JSON.parse(storage.getItem(continuationPortableKey)!);
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
    expect(launch.reviewLatest).toBeNull();
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
    expect(launch.canCreate).toBe(false);
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

  it("starts over after a failed transfer without overwriting a destination whose response was lost", async () => {
    setup();
    commands.restoreCopy.run.mockResolvedValueOnce(failure("Destination disconnected"));
    await mount();
    await click("Start conversation");
    expect(storage.getItem(portableKey)).not.toBeNull();
    await click("Start over");
    expect(storage.getItem(portableKey)).toBeNull();
    commands.inspectFolder.run.mockResolvedValue(
      AsyncResult.success({ rootPath: destinationCopy.rootPath, exists: true, repositories: [] }),
    );
    await click("Start conversation");
    expect(commands.restoreCopy.run).toHaveBeenCalledOnce();
    expect(launch.canCreate).toBe(false);
    expect(launch.existingFolder).toBeTruthy();
  });

  it("starts over in the abandoned destination after a remount instead of restoring a second set of files", async () => {
    setup();
    commands.restoreCopy.run.mockResolvedValueOnce(failure("Destination disconnected"));
    await mount();
    await act(() => launch.setRootPath("/work/custom"));
    await click("Start conversation");
    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount();
    await click("Start over");
    // The computer may still be restoring there, so the next start must look before writing.
    expect(launch.rootPath).toBe("/work/custom");
    commands.inspectFolder.run.mockResolvedValue(
      AsyncResult.success({ rootPath: "/work/custom", exists: true, repositories: [] }),
    );
    await click("Start conversation");
    expect(commands.restoreCopy.run).toHaveBeenCalledOnce();
    expect(launch.existingFolder).toBe("/work/custom");
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
    expect(launch.canCreate).toBe(false);
    await act(() => launch.selectCopy(restoredCopy.id));
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

  it("holds an unfinished continuation for that continuation only, names it, and retries it there", async () => {
    setup();
    commands.resolveBinding.run.mockResolvedValueOnce(failure("Disconnected"));
    await mount([restoredCopy], { continuation: sourceSummary });
    await act(() => launch.selectCopy(restoredCopy.id));
    await click("Start conversation");
    const held = JSON.parse(storage.getItem(continuationAttemptKey)!);
    expect(held.binding.continuationOf).toEqual({
      environmentId: sourceEnvironmentId,
      threadId: sourceSummary.threadId,
      sequence: sourceSummary.sequence,
    });
    expect(savedAttempt()).toBeNull();

    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([restoredCopy]);
    expect(launch.locked).toBe(false);
    expect(launch.held).toBeNull();
    expect(launch.title).toBe("");

    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([restoredCopy], { continuation: sourceSummary });
    expect(launch.held).toEqual({ title: "Continue: Original work", savedAt: held.createdAt });
    await click("Retry conversation");
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
    expect(commands.bindThread.run).toHaveBeenLastCalledWith({
      environmentId,
      input: { threadId, binding: held.binding, project },
    });
    expect(storage.getItem(continuationAttemptKey)).toBeNull();
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
    expect(storage.getItem(portableKey)).toBeNull();
    const receipt = JSON.parse(storage.getItem(continuationPortableKey)!);
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
    // An ordinary start in the same project is not held by the continuation's restore.
    await mount();
    expect(launch.locked).toBe(false);
    expect(launch.title).toBe("");
    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([], { continuation: sourceSummary });
    expect(launch.held).toEqual({ title: "Continue: Original work", savedAt: null });
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
    await act(() => launch.setRootPath(newPath));
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
    expect(launch.canCreate).toBe(false);
    expect(commands.prepareCopy.run).not.toHaveBeenCalled();
    expect(commands.restoreCopy.run).not.toHaveBeenCalled();
  });
});

describe("conversation palette ergonomics", () => {
  async function mountPalette() {
    await act(() => {
      renderer = create(
        <NewConversationDialog
          project={project}
          initialHostId={environmentId}
          initialCopyId={restoredCopy.id}
          initialModelSelection={{
            instanceId,
            model: "test-model",
            options: [{ id: "reasoningEffort", value: "high" }],
          }}
          initialRuntimeMode="approval-required"
          initialInteractionMode="plan"
          copies={[restoredCopy]}
          copiesQuery={{ isPending: false, isSuccess: true, error: null, refresh: vi.fn() }}
          onChanged={onChanged}
          onClose={onClose}
        />,
      );
    });
  }
  function action(title: string) {
    return renderer!.root.findAllByType("button").find((node) => node.children.includes(title))!;
  }
  async function choose(title: string) {
    expect(action(title).props.disabled).not.toBe(true);
    await act(() => action(title).props.onClick());
  }
  it("starts with valid inherited settings without forcing setup steps", async () => {
    await mountPalette();
    expect(action("Start conversation").props.disabled).toBe(false);
    expect(commands.create.run).not.toHaveBeenCalled();
    await choose("Start conversation");
    expect(commands.create.run).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        input: expect.objectContaining({
          modelSelection: {
            instanceId,
            model: "test-model",
            options: [{ id: "reasoningEffort", value: "high" }],
          },
          runtimeMode: "approval-required",
          interactionMode: "plan",
        }),
      }),
    );
  });
  it("keeps the title and source options across settings drill-down and Back until Start", async () => {
    await mountPalette();
    await choose("Computer");
    await choose("Computer");
    await choose("Model");
    await choose("Test model");
    await choose("Conversation title");
    await act(() =>
      renderer!.root.findByType("input").props.onChange({ target: { value: "Inspect project" } }),
    );
    await choose("Back");
    await choose("Permissions");
    await choose("Full access");
    await choose("Conversation title");
    expect(renderer!.root.findByType("input").props.value).toBe("Inspect project");
    await choose("Back");
    expect(commands.create.run).not.toHaveBeenCalled();
    await choose("Start conversation");
    expect(commands.create.run).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          title: "Inspect project",
          runtimeMode: "full-access",
          interactionMode: "plan",
          modelSelection: {
            instanceId,
            model: "test-model",
            options: [{ id: "reasoningEffort", value: "high" }],
          },
        }),
      }),
    );
  });
});

describe("held attempts and one-step starts", () => {
  const readyFiles = { isPending: false, isSuccess: true, error: null, refresh: vi.fn() };
  const chosenSettings = {
    initialModelSelection: { instanceId, model: "chosen-model" },
    initialRuntimeMode: "approval-required" as const,
    initialInteractionMode: "plan" as const,
  };
  const promised: ConversationQuickStart = {
    environmentId,
    workingCopyId: restoredCopy.id,
    modelSelection: { instanceId, model: "test-model" },
    runtimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
  };
  function dialog(launchPromise?: ConversationQuickStart, settle = vi.fn()) {
    return (
      <ConversationAutoStartContext
        value={launchPromise ? { launch: launchPromise, settle } : null}
      >
        <NewConversationDialog
          project={project}
          initialHostId={environmentId}
          copies={[restoredCopy]}
          copiesQuery={readyFiles}
          onChanged={onChanged}
          onClose={onClose}
        />
      </ConversationAutoStartContext>
    );
  }
  async function render(tree: ReturnType<typeof dialog>) {
    await act(() => {
      if (renderer) renderer.update(tree);
      else renderer = create(tree);
    });
  }
  async function remount(tree: ReturnType<typeof dialog>) {
    await act(() => renderer?.unmount());
    renderer = undefined;
    await render(tree);
  }
  function action(title: string) {
    return renderer!.root.findAllByType("button").find((node) => node.children.includes(title));
  }
  async function choose(title: string) {
    expect(action(title)?.props.disabled).not.toBe(true);
    await act(async () => action(title)!.props.onClick());
  }
  function withCapabilities(...features: string[]) {
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
                loomFeatures: ["project-library", "library-file-lifecycle", ...features],
              },
            },
          },
        },
      ],
    });
  }

  it("offers Retry and Start over in a reopened dialog, and starts a new conversation with the settings it showed", async () => {
    commands.resolveBinding.run.mockResolvedValueOnce(failure("Disconnected"));
    await mount([], chosenSettings);
    await click("Start conversation");
    const first = savedAttempt();
    expect(first).toMatchObject({ threadId, created: false });

    // Reopened later with no error showing: the held attempt must still have a way out.
    await remount(dialog());
    expect(action("Retry untitled conversation")).toBeDefined();
    expect(action("Computer")?.props.disabled).toBe(true);
    await choose("Start over");
    expect(savedAttempt()).toBeNull();
    expect(action("Retry untitled conversation")).toBeUndefined();
    expect(action("Computer")?.props.disabled).toBe(false);

    state.threadIds.push("second-thread");
    await choose("Start conversation");
    expect(commands.reopenCopy.run).toHaveBeenCalledOnce();
    expect(commands.create.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: expect.objectContaining({
        threadId: "second-thread",
        modelSelection: { instanceId, model: "chosen-model" },
        runtimeMode: "approval-required",
        interactionMode: "plan",
      }),
    });
    const registered = commands.registerThread.run.mock.calls[0]![0].input.requestId;
    expect(registered).not.toBe(first.registerRequestId);
    expect(savedAttempt()).toBeNull();
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: "second-thread" },
    });
  });

  it("offers an attempt already saved for the project by name, with Retry and Start over", async () => {
    const continuationOf = {
      environmentId: EnvironmentId.make("old-computer"),
      threadId: ThreadId.make("old-thread"),
      sequence: 3,
    };
    const stuck = {
      environmentId,
      threadId,
      binding: { ...binding, continuationOf },
      project,
      title: "Continue: Old work",
      context: "Earlier notes",
      modelSelection: { instanceId, model: "test-model" },
      runtimeMode: "full-access",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      created: true,
      registerRequestId: "stuck-request",
    };
    saveLibraryAttempt(attemptKey, JSON.stringify(stuck), storage);
    await render(dialog());
    const retry = action("Retry “Continue: Old work”");
    expect(retry?.props.disabled).toBe(false);
    expect(retry!.findByType("small").children.join("")).toMatch(/^First tried 2h ago\. /);
    expect(action("Start over")).toBeDefined();

    await choose("Retry “Continue: Old work”");
    expect(commands.create.run).not.toHaveBeenCalled();
    expect(commands.bindThread.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId, binding: stuck.binding, project },
    });
    expectOpened();
  });

  it("names an attempt held before the conversation step by the title it will use", async () => {
    commands.reopenCopy.run.mockResolvedValueOnce(failure("Disconnected"));
    await mount();
    await act(() => launch.setTitle("Fix login"));
    await click("Start conversation");
    const held = JSON.parse(storage.getItem(reopeningKey)!);
    expect(Number.isNaN(Date.parse(held.savedAt))).toBe(false);
    expect(launch.held).toEqual({ title: "Fix login", savedAt: held.savedAt });
  });

  it("retries with the project revision it started from after the brief changes", async () => {
    commands.resolveBinding.run.mockResolvedValueOnce(failure("Disconnected"));
    await mount([restoredCopy]);
    await click("Start conversation");
    await act(() => renderer!.unmount());
    renderer = undefined;
    // The binding names the first revision, and the computer refuses a project that differs from it.
    await mount([restoredCopy], { project: { ...project, brief: "Edited", revision: 2 } });
    await click("Retry conversation");
    expect(commands.resolveBinding.run).toHaveBeenLastCalledWith({
      environmentId,
      input: { binding, project },
    });
    expect(commands.bindThread.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId, binding, project },
    });
    expectOpened();
  });

  it("keeps the clone repair pinned to the failed preparation computer", async () => {
    withCapabilities("project-workflows");
    const repair = {
      kind: "github-host-setup" as const,
      environmentId,
      label: "Computer",
      agentTool: "loom_github_host_setup" as const,
      action: "start" as const,
    };
    commands.executeOperation.run.mockResolvedValueOnce(
      AsyncResult.failure(
        Cause.fail(
          new LibraryError({
            reason: "blocked",
            detail: "Git authentication failed on Computer.",
            repair,
          }),
        ),
      ),
    );
    await mount();
    await click("Start conversation");
    expect(launch.cloneRepair).toEqual(repair);
    expect(launch.error).toBe("Git authentication failed on Computer.");
  });

  it("keeps a retry whose conversation was deleted, says so, and starts a new operation after Start over", async () => {
    withCapabilities("project-workflows");
    const detail =
      "The conversation from an earlier try was deleted. Start over to begin a new one.";
    commands.executeOperation.run
      .mockResolvedValueOnce(
        AsyncResult.failure(Cause.fail(new LibraryError({ reason: "blocked", detail }))),
      )
      .mockResolvedValueOnce(AsyncResult.success({ result: { threadId } }));
    await mount();
    await click("Start conversation");
    expect(launch.error).toBe(detail);
    const first = savedAttempt();
    expect(first).toMatchObject({ threadId });
    expect(launch.startOver).not.toBeNull();

    await click("Start over");
    expect(launch.locked).toBe(false);
    expect(launch.error).toBeNull();
    state.threadIds.push("second-thread");
    await click("Start conversation");
    const [retried, fresh] = commands.executeOperation.run.mock.calls.map(([call]) => call.input);
    expect(retried.operationId).toBe(`${first.registerRequestId}:launch`);
    expect(fresh.operationId).not.toBe(retried.operationId);
    expect(fresh.request.input.threadId).toBe("second-thread");
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId: "second-thread" },
    });
  });

  it("starts in a new worktree while another conversation works in the folder, and a retry keeps it", async () => {
    withCapabilities("project-workflows", "library-worktree-starts");
    const site = {
      id: "site",
      title: "Site",
      remoteUrl: null,
      relativePath: ".",
      defaultBranch: null,
    };
    const siteProject = { ...project, resources: [site] };
    const siteCopy: LibraryWorkingCopy = {
      ...restoredCopy,
      repositories: [
        { resourceId: site.id, path: "/work/project", localProjectId, head: null, branch: "main" },
      ],
    };
    state.shells.mockReturnValue([
      {
        environmentId,
        worktreePath: siteCopy.rootPath,
        archivedAt: null,
        runtime: {
          status: "running",
          activeRunId: null,
          providerInstanceId: instanceId,
          providerName: null,
          lastError: null,
          updatedAt: provider.checkedAt,
        },
      },
    ]);
    commands.executeOperation.run
      .mockResolvedValueOnce(failure("Disconnected"))
      .mockResolvedValueOnce(AsyncResult.success({ result: { threadId } }));
    await mount([siteCopy], { project: siteProject });
    expect(launch.workspace).toBe("worktree");
    expect(launch.warning).toBeNull();
    await click("Start conversation");
    expect(savedAttempt()).toMatchObject({ workspace: "worktree" });

    // The other conversation finishing must not move the retry back into the shared folder.
    state.shells.mockReturnValue([]);
    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount([siteCopy], { project: siteProject });
    expect(launch.workspace).toBe("worktree");
    await click("Retry conversation");
    const [first, retried] = commands.executeOperation.run.mock.calls.map(([call]) => call.input);
    expect(first.request.input.workspace).toBe("worktree");
    expect(retried.operationId).toBe(first.operationId);
    expect(retried.request.input.workspace).toBe("worktree");
  });

  it("creates one conversation when started twice before the next render", async () => {
    await mount([restoredCopy]);
    await act(async () => {
      await Promise.all([launch.submit(), launch.submit()]);
    });
    expect(commands.create.run).toHaveBeenCalledOnce();
    expectOpened();
  });

  it("starts once from the project list, and a held attempt waits for Retry or Start over", async () => {
    commands.resolveBinding.run.mockResolvedValueOnce(failure("Disconnected"));
    const settle = vi.fn();
    await render(dialog(promised, settle));
    expect(settle).toHaveBeenCalledOnce();
    expect(commands.resolveBinding.run).toHaveBeenCalledOnce();
    expect(savedAttempt()).not.toBeNull();

    await remount(dialog(promised, settle));
    expect(settle).toHaveBeenCalledTimes(2);
    expect(commands.resolveBinding.run).toHaveBeenCalledOnce();
    expect(action("Retry untitled conversation")).toBeDefined();
    expect(action("Start over")).toBeDefined();
  });

  it("shows the settings instead of starting when the promise no longer holds", async () => {
    const settle = vi.fn();
    await render(dialog({ ...promised, runtimeMode: "approval-required" }, settle));
    expect(settle).toHaveBeenCalledOnce();
    expect(action("Start conversation")?.props.disabled).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "These settings differ from what the project list showed.",
    );
    expect(commands.resolveBinding.run).not.toHaveBeenCalled();
  });

  it("waits on the files' health check, and shows the settings when it fails", async () => {
    withCapabilities("library-copy-health");
    let health = { data: null, isPending: true, isSuccess: false, error: null as string | null };
    state.query.mockImplementation((query: unknown) => ({
      ...(query === state.healthQuery
        ? health
        : {
            data: query === state.retainedQuery ? [restoredCopy] : undefined,
            isPending: false,
            isSuccess: true,
            error: null,
          }),
      refresh: vi.fn(),
    }));
    const settle = vi.fn();
    await render(dialog(promised, settle));
    expect(action("Starting...")?.props.disabled).toBe(true);
    expect(settle).not.toHaveBeenCalled();

    health = {
      data: null,
      isPending: false,
      isSuccess: false,
      error: "Environment host is offline.",
    };
    await render(dialog(promised, settle));
    expect(settle).toHaveBeenCalledOnce();
    expect(action("Start conversation")?.props.disabled).toBe(false);
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      "Could not check whether these files are up to date. Environment host is offline.",
    );
    expect(commands.resolveBinding.run).not.toHaveBeenCalled();
  });

  it("stops waiting on files once the computer disconnects", async () => {
    const loading = { isPending: true, isSuccess: false, error: null, refresh: vi.fn() };
    const tree = () => (
      <SetupHarness
        project={project}
        initialHostId={environmentId}
        copies={[]}
        copiesQuery={loading}
        onChanged={onChanged}
        onClose={onClose}
      />
    );
    await act(() => {
      renderer = create(tree());
    });
    expect(launch.checking).toBe(true);
    const previous = state.authority();
    state.authority.mockReturnValue({
      ...previous,
      environments: [{ ...previous.environments[0], connection: { phase: "backoff" } }],
    });
    await act(() => renderer!.update(tree()));
    expect(launch.checking).toBe(false);
    expect(launch.blocker).toBe("Reconnect the selected computer before starting.");
  });
});

describe("Library offline starts", () => {
  function offline(copies: readonly LibraryWorkingCopy[], durable = true) {
    const previous = state.authority();
    const host = previous.environments[0];
    state.authority.mockReturnValue({
      ...previous,
      connected: false,
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
                  ...(durable ? ["project-workflows"] : []),
                ],
              },
            },
          },
        },
      ],
    });
    // Library grants are unavailable during the outage; the host still checks its own grants.
    state.permission.mockImplementation((_command, environment) => environment !== authorityId);
    state.query.mockImplementation((query: unknown) => ({
      data: query === state.retainedQuery ? copies : undefined,
      isPending: false,
      isSuccess: true,
      error: null,
      refresh: vi.fn(),
    }));
    commands.executeOperation.run.mockResolvedValue(AsyncResult.success({ result: { threadId } }));
  }

  it.each(["managed", "borrowed"] as const)(
    "starts once on a registered %s copy without an authority request",
    async (ownership) => {
      const copy = { ...restoredCopy, ownership };
      offline([copy]);
      await mount([copy]);
      expect(launch.offlineNotice).toContain("Library offline; starting from this computer's copy");
      await click("Start conversation");
      expect(commands.prepareCopy.run).not.toHaveBeenCalled();
      expect(commands.registerCopy.run).not.toHaveBeenCalled();
      expect(commands.registerThread.run).not.toHaveBeenCalled();
      expect(commands.executeOperation.run).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: {
          operationId: expect.any(String),
          request: {
            kind: "launch",
            input: expect.objectContaining({ project, binding, threadId }),
          },
        },
      });
      expect(
        commands.executeOperation.run.mock.calls[0]![0].input.request.input,
      ).not.toHaveProperty("keepOnComputer");
      expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    },
  );

  it("keeps preparation, unregistered folders, old hosts and retention changes blocked offline", async () => {
    offline([restoredCopy]);
    await mount([restoredCopy]);
    expect(launch.canCreate).toBe(true);
    await act(() => launch.setKeepChoice(false));
    expect(launch.canCreate).toBe(false);
    await act(() => launch.submit());
    expect(commands.executeOperation.run).not.toHaveBeenCalled();
    await act(() => renderer!.unmount());
    for (const [copies, durable] of [
      [[], true],
      [[releasedCopy], true],
      [[{ ...restoredCopy, registered: false }], true],
      [[restoredCopy], false],
    ] as const) {
      offline(copies, durable);
      await mount(copies);
      expect(launch.canCreate).toBe(false);
      await act(() => launch.submit());
      expect(commands.prepareCopy.run).not.toHaveBeenCalled();
      expect(commands.executeOperation.run).not.toHaveBeenCalled();
      await act(() => renderer!.unmount());
      renderer = undefined;
    }
  });
});
