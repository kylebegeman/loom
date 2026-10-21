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
import type { LibraryProject, LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  commands: {
    bindThread: { run: vi.fn() },
    prepareCopy: { run: vi.fn() },
    reopenCopy: { run: vi.fn() },
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
  configsAtom: {},
  providersAtom: {},
  nextId: 0,
}));
vi.mock("./state", () => ({
  projectLibrary: { ...state.commands, copies: () => state.retainedQuery },
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
vi.mock("~/composerDraftStore", () => ({ useComposerDraftStore: {} }));
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
const preparationKey = `loom:library:launch-files:${authorityId}:${project.id}`;
const onChanged = vi.fn();
const onClose = vi.fn();
const failure = (message: string) => AsyncResult.failure(Cause.fail(new Error(message)));
const bindingReceipt = AsyncResult.success(null);
let renderer: ReactTestRenderer | undefined;
let storage: Storage;

async function mount(copies: readonly LibraryWorkingCopy[] = []) {
  await act(() => {
    renderer = create(
      <NewConversationDialog
        project={project}
        copies={copies}
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
  expect(button(label).props.disabled).toBe(false);
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
  for (const key of [attemptKey, reopeningKey, preparationKey])
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
  for (const key of [attemptKey, reopeningKey, preparationKey])
    saveLibraryAttempt(key, null, storage);
  vi.unstubAllGlobals();
});

describe("Library conversation retention", () => {
  it("automatically restores temporary files and waits for the new thread binding before enabling cleanup", async () => {
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
  });

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
