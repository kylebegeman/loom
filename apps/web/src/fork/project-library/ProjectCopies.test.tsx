import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { type LibraryProject, type LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  retain: vi.fn(),
  reopen: vi.fn(),
  register: vi.fn(),
  download: vi.fn(),
  openExternal: vi.fn(),
  commands: { retain: {}, reopen: {}, register: {}, download: {} },
  authorityId: "authority",
  connected: true,
  supported: true,
  canRetain: true,
  canReopen: true,
  canRegister: true,
  nextId: 0,
}));
vi.mock("./state", () => ({
  projectLibrary: {
    setCopyRetention: state.commands.retain,
    reopenCopy: state.commands.reopen,
    registerCopy: state.commands.register,
  },
  useLibraryAuthority: () => ({
    authorityId: state.authorityId,
    connected: state.connected,
    environments: [
      {
        environmentId: "host",
        serverConfig: {
          environment: {
            capabilities: {
              loomFeatures: state.supported ? ["library-file-lifecycle"] : [],
            },
          },
        },
      },
    ],
  }),
  useLibraryPermission: (command: unknown) =>
    command === state.commands.retain
      ? state.canRetain
      : command === state.commands.reopen
        ? state.canReopen
        : state.canRegister,
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === state.commands.retain
      ? state.retain
      : command === state.commands.reopen
        ? state.reopen
        : command === state.commands.download
          ? state.download
          : state.register,
}));
vi.mock("~/rpc/libraryAssets", () => ({ libraryRecoveryAccess: state.commands.download }));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("~/state/environments", () => ({ useEnvironments: () => ({ environments: [] }) }));
vi.mock("~/state/query", () => ({ useEnvironmentQuery: vi.fn() }));
vi.mock("~/state/vcs", () => ({ vcsEnvironment: {} }));
vi.mock("~/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter((value) => typeof value === "string").join(" "),
  randomUUID: () => `file-update-${++state.nextId}`,
}));
vi.mock("~/components/settings/useSettingsProjectGroups", () => ({
  useSettingsProjectGroups: () => [],
}));
vi.mock("@tanstack/react-router", () => ({ Link: "a" }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "input" }));
vi.mock("~/components/ui/menu", () => ({
  Menu: "div",
  MenuItem: "div",
  MenuPopup: "div",
  MenuTrigger: "div",
}));
vi.mock("./LibraryControls", () => ({
  LibraryPanel: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  LibrarySection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  LibraryErrorNotice: ({ error }: { error: string | null }) =>
    error ? <p role="alert">{error}</p> : null,
}));
vi.mock("./ProjectIdentity", () => ({
  ComputerIcon: () => null,
  ComputerTile: () => null,
  PathLabel: () => null,
  ProjectGlow: () => null,
}));
vi.mock("./ProfileReadiness", () => ({ CopyProfileSetup: () => null }));
vi.mock("./ExistingFolderStorage", () => ({ ExistingFolderStorage: () => null }));

import { ProjectCopies } from "./ProjectCopies";
import { readLibraryAttempt, saveLibraryAttempt } from "./attempts";

const environmentId = EnvironmentId.make("host");
const authorityId = EnvironmentId.make("authority");
const project: LibraryProject = {
  id: "project",
  title: "Project",
  brief: "",
  revision: 1,
  resources: [],
  archived: false,
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: project.id,
  projectRevision: project.revision,
  environmentId,
  rootPath: "/work/project",
  rootLocalProjectId: ProjectId.make("local-project"),
  repositories: [],
  ownership: "managed",
  state: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const changedCopy: LibraryWorkingCopy = {
  ...copy,
  keepOnComputer: false,
  updatedAt: "2026-10-21T12:00:00.000Z",
};
const attemptKey = `loom:library:file-change:${environmentId}:${copy.id}`;
const onChanged = vi.fn();
type Props = Parameters<typeof ProjectCopies>[0];
let renderer: ReactTestRenderer | undefined;
let storage: Storage;
let currentProps: Props;
const props = (patch: Partial<Props> = {}): Props => ({
  project,
  copies: [copy],
  loading: false,
  error: null,
  onRetry: onChanged,
  canAct: true,
  canStart: true,
  hostLabel: () => "Computer",
  hostConnected: () => true,
  lastSeenAt: () => undefined,
  publishedHealth: false,
  onGetCopy: vi.fn(),
  onStart: vi.fn(),
  onRemove: vi.fn(),
  ...patch,
});
async function mount(patch: Partial<Props> = {}) {
  currentProps = props(patch);
  await act(() => {
    renderer = create(<ProjectCopies {...currentProps} />);
  });
}
async function rerender(patch: Partial<Props> = {}) {
  currentProps = { ...currentProps, ...patch };
  await act(() => renderer!.update(<ProjectCopies {...currentProps} />));
}
function buttons(label: string) {
  return renderer!.root.findAllByType("button").filter((node) => node.children.includes(label));
}
function button(label: string) {
  const match = buttons(label)[0];
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}
function toggle() {
  return renderer!.root.findByType("input");
}
async function click(label: string) {
  await act(() => button(label).props.onClick());
}
async function retain(keep: boolean) {
  await act(() => toggle().props.onCheckedChange(keep));
}
function savedAttempt() {
  const serialized = storage.getItem(attemptKey);
  expect(readLibraryAttempt(attemptKey, storage)).toBe(serialized);
  return serialized === null ? null : JSON.parse(serialized);
}
const failure = (message: string) => AsyncResult.failure(Cause.fail(new Error(message)));

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
    desktopBridge: { openExternal: state.openExternal },
  });
  saveLibraryAttempt(attemptKey, null, storage);
  state.authorityId = authorityId;
  state.connected = true;
  state.supported = true;
  state.canRetain = true;
  state.canReopen = true;
  state.canRegister = true;
  state.nextId = 0;
  state.retain.mockReset().mockResolvedValue(AsyncResult.success(changedCopy));
  state.reopen.mockReset().mockResolvedValue(AsyncResult.success(copy));
  state.register.mockReset().mockResolvedValue(AsyncResult.success(changedCopy));
  state.download.mockReset().mockResolvedValue(AsyncResult.success("https://files.test/recovery"));
  state.openExternal.mockReset().mockResolvedValue(true);
  onChanged.mockReset();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  saveLibraryAttempt(attemptKey, null, storage);
  vi.unstubAllGlobals();
});

describe("project file changes", () => {
  it("persists the request and host receipt before publishing to the authority", async () => {
    state.retain.mockImplementationOnce(async () => {
      expect(savedAttempt()).toMatchObject({ authorityId, keepOnComputer: false, copy: null });
      return AsyncResult.success(changedCopy);
    });
    state.register.mockImplementationOnce(async () => {
      expect(savedAttempt()).toMatchObject({ copy: changedCopy });
      return AsyncResult.success(changedCopy);
    });
    await mount();
    await retain(false);
    expect(state.retain).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { workingCopyId: copy.id, keepOnComputer: false },
    });
    expect(state.register).toHaveBeenCalledExactlyOnceWith({
      environmentId: authorityId,
      input: { requestId: "file-update-1:publish", copy: changedCopy },
    });
    expect(savedAttempt()).toBeNull();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it.each(["policy", "restore"] as const)(
    "retries a persisted %s publisher failure after remount without repeating the host mutation",
    async (operation) => {
      state.register.mockResolvedValueOnce(failure("Authority unavailable"));
      const inputCopy = operation === "restore" ? { ...copy, state: "released" as const } : copy;
      if (operation === "restore")
        state.reopen.mockResolvedValueOnce(AsyncResult.success(changedCopy));
      await mount({ copies: [inputCopy] });
      if (operation === "restore") await click("Restore files");
      else await retain(false);
      expect(onChanged).not.toHaveBeenCalled();
      expect(renderer!.root.findByProps({ role: "alert" }).children).toContain(
        "Authority unavailable",
      );
      expect(toggle().props.checked).toBe(false);
      expect(toggle().props.disabled).toBe(true);
      expect(buttons("Cancel update")).toHaveLength(0);
      const firstPublish = state.register.mock.calls[0];
      await act(() => renderer!.unmount());
      state.canRetain = false;
      state.canReopen = false;
      await mount({ copies: [inputCopy] });
      await click("Retry file update");
      expect(state.retain).toHaveBeenCalledTimes(operation === "policy" ? 1 : 0);
      expect(state.reopen).toHaveBeenCalledTimes(operation === "restore" ? 1 : 0);
      expect(state.register.mock.calls[1]).toEqual(firstPublish);
      expect(onChanged).toHaveBeenCalledOnce();
      expect(savedAttempt()).toBeNull();
    },
  );

  it("recovers a host receipt from browser storage without changing files again", async () => {
    const persistedCopy = { ...changedCopy, id: "persisted-files" };
    const key = `loom:library:file-change:${environmentId}:${persistedCopy.id}`;
    storage.setItem(
      key,
      JSON.stringify({
        authorityId,
        requestId: "persisted-request",
        keepOnComputer: false,
        copy: persistedCopy,
      }),
    );
    state.canRetain = false;
    await mount({ copies: [{ ...copy, id: persistedCopy.id }] });
    expect(toggle().props.checked).toBe(false);
    await click("Retry file update");
    expect(state.retain).not.toHaveBeenCalled();
    expect(state.reopen).not.toHaveBeenCalled();
    expect(state.register).toHaveBeenCalledExactlyOnceWith({
      environmentId: authorityId,
      input: { requestId: "persisted-request:publish", copy: persistedCopy },
    });
    expect(storage.getItem(key)).toBeNull();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("keeps the same reopen request after an ambiguous host failure and remount", async () => {
    state.reopen.mockResolvedValueOnce(failure("Connection lost"));
    const released = { ...copy, state: "released" as const };
    await mount({ copies: [released] });
    await click("Restore files");
    expect(savedAttempt()).toMatchObject({ requestId: "file-update-1", copy: null });
    expect(state.register).not.toHaveBeenCalled();
    const originalReopen = state.reopen.mock.calls[0];
    await act(() => renderer!.unmount());
    await mount({ copies: [released] });
    await click("Retry file update");
    expect(state.reopen.mock.calls[1]).toEqual(originalReopen);
    expect(state.reopen).toHaveBeenLastCalledWith({
      environmentId,
      input: { requestId: "file-update-1", workingCopyId: copy.id },
    });
    expect(state.register.mock.calls[0]![0].input.requestId).toBe("file-update-1:publish");
    expect(savedAttempt()).toBeNull();
  });

  it("cancels an unreceipted failure and unlocks a new file policy change", async () => {
    state.retain.mockResolvedValueOnce(failure("Host unavailable"));
    await mount();
    await retain(false);
    expect(toggle().props.disabled).toBe(true);
    await click("Cancel update");
    expect(savedAttempt()).toBeNull();
    expect(toggle().props.disabled).toBe(false);
    expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(state.register).not.toHaveBeenCalled();
    await retain(true);
    expect(state.retain).toHaveBeenCalledTimes(2);
    expect(state.retain).toHaveBeenLastCalledWith({
      environmentId,
      input: { workingCopyId: copy.id, keepOnComputer: true },
    });
    expect(state.register.mock.calls[0]![0].input.requestId).toBe("file-update-2:publish");
  });

  it("rejects duplicate submissions before React commits the busy state", async () => {
    let resolveHost!: (result: AsyncResult.AsyncResult<LibraryWorkingCopy, Error>) => void;
    state.retain.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHost = resolve;
        }),
    );
    await mount();
    const submit = toggle().props.onCheckedChange;
    await act(() => {
      submit(false);
      submit(false);
    });
    expect(state.retain).toHaveBeenCalledOnce();
    expect(state.register).not.toHaveBeenCalled();
    expect(button("Saving...").props.disabled).toBe(true);
    expect(button("Cancel update").props.disabled).toBe(true);
    await act(() => resolveHost(AsyncResult.success(changedCopy)));
    expect(state.register).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it.each(["canRetain", "canRegister", "connected", "supported"] as const)(
    "refuses a fresh policy mutation without %s",
    async (permission) => {
      state[permission] = false;
      await mount();
      expect(toggle().props.disabled).toBe(true);
      await retain(false);
      expect(state.retain).not.toHaveBeenCalled();
      expect(state.register).not.toHaveBeenCalled();
      expect(savedAttempt()).toBeNull();
    },
  );

  it.each(["canReopen", "canRegister"] as const)(
    "refuses restoring released files without %s",
    async (permission) => {
      state[permission] = false;
      await mount({ copies: [{ ...copy, state: "released" }] });
      expect(button("Restore files").props.disabled).toBe(true);
      await click("Restore files");
      expect(state.reopen).not.toHaveBeenCalled();
      expect(state.register).not.toHaveBeenCalled();
    },
  );

  it.each(["offline", "cannot-act"] as const)("refuses file changes when %s", async (condition) => {
    await mount({
      canAct: condition !== "cannot-act",
      hostConnected: () => condition !== "offline",
    });
    expect(toggle().props.disabled).toBe(true);
    await retain(false);
    expect(state.retain).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
  });

  it("rechecks the host permission on retry before obtaining a receipt", async () => {
    state.retain.mockResolvedValueOnce(failure("Host unavailable"));
    await mount();
    await retain(false);
    state.canRetain = false;
    await rerender();
    await click("Retry file update");
    expect(state.retain).toHaveBeenCalledOnce();
    expect(state.register).not.toHaveBeenCalled();
    state.canRetain = true;
    await rerender();
    await click("Retry file update");
    expect(state.retain).toHaveBeenCalledTimes(2);
    expect(state.register).toHaveBeenCalledOnce();
  });

  it("keeps a host receipt while authority permission is revoked, then publishes after permission returns", async () => {
    state.register.mockResolvedValueOnce(failure("Authority unavailable"));
    await mount();
    await retain(false);
    state.canRegister = false;
    await rerender();
    expect(button("Retry file update").props.disabled).toBe(true);
    await click("Retry file update");
    expect(state.register).toHaveBeenCalledOnce();
    expect(savedAttempt()).toMatchObject({ copy: changedCopy });
    state.canRegister = true;
    await rerender();
    await click("Retry file update");
    expect(state.register).toHaveBeenCalledTimes(2);
    expect(state.retain).toHaveBeenCalledOnce();
  });

  it("does not publish a pending host receipt to a newly selected authority", async () => {
    state.register.mockResolvedValueOnce(failure("Authority unavailable"));
    await mount();
    await retain(false);
    state.authorityId = "different-authority";
    await rerender();
    await click("Retry file update");
    expect(state.register).toHaveBeenCalledOnce();
    expect(savedAttempt()).toMatchObject({ authorityId, copy: changedCopy });
  });

  it.each(["missing", "failed"] as const)(
    "downloads recovery for %s files without asking the host to reopen them",
    async (copyState) => {
      const recovery = {
        sha256: "a".repeat(64),
        byteLength: 1024,
        archiveKey: "recovery-key",
        verifiedAt: project.updatedAt,
      };
      await mount({ copies: [{ ...copy, state: copyState, recovery }] });
      expect(buttons("Restore files")).toHaveLength(0);
      await click("Download recovery archive");
      expect(state.download).toHaveBeenCalledExactlyOnceWith({
        environmentId: authorityId,
        input: { sourceEnvironmentId: environmentId, copyId: copy.id, sha256: recovery.sha256 },
      });
      expect(state.openExternal).toHaveBeenCalledExactlyOnceWith("https://files.test/recovery");
      expect(state.reopen).not.toHaveBeenCalled();
      expect(state.retain).not.toHaveBeenCalled();
    },
  );
});
