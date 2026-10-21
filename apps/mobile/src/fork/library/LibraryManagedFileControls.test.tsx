// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentAuthorizationError, EnvironmentId } from "@t3tools/contracts";
import type { LibraryWorkingCopy } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Preferences } from "../../persistence/mobile-preferences";

const state = vi.hoisted(() => ({
  reopen: vi.fn(),
  retain: vi.fn(),
  register: vi.fn(),
  save: vi.fn(),
  permission: null as Atom.Writable<boolean> | null,
  preferences: null as Atom.Writable<AsyncResult.AsyncResult<Preferences, never>> | null,
  commands: {
    reopenCopy: { permissionAtom: () => state.permission! },
    setCopyRetention: { permissionAtom: () => state.permission! },
    registerCopy: { permissionAtom: () => state.permission! },
  },
}));
vi.mock("./libraryState", () => ({ library: state.commands }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => crypto.randomUUID() }));
vi.mock("../../state/preferences", () => ({
  get mobilePreferencesAtom() {
    return state.preferences;
  },
  updateMobilePreferencesAtom: {},
}));
vi.mock("@effect/atom-react", async (original) => ({
  ...(await original<typeof import("@effect/atom-react")>()),
  useAtomSet: () => state.save,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === state.commands.reopenCopy
      ? state.reopen
      : command === state.commands.setCopyRetention
        ? state.retain
        : state.register,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
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
    <button disabled={disabled} onClick={onPress}>
      {label}
    </button>
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
    disabled?: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <button
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onValueChange(!value)}
    >
      {label}
    </button>
  ),
}));
import { LibraryManagedFileControls } from "./LibraryManagedFileControls";

const environmentId = EnvironmentId.make("computer");
const authorityEnvironmentId = EnvironmentId.make("library");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId,
  rootPath: "/project",
  repositories: [],
  ownership: "managed",
  state: "released",
  registered: false,
  keepOnComputer: false,
  recovery: {
    sha256: "a".repeat(64),
    byteLength: 100,
    archiveKey: "archive",
    verifiedAt: "2026-10-21T00:00:00Z",
  },
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const restored: LibraryWorkingCopy = {
  ...copy,
  state: "ready",
  registered: true,
  keepOnComputer: true,
  updatedAt: "2026-10-21T01:00:00Z",
};
let registry: AtomRegistry.AtomRegistry, container: HTMLDivElement, root: Root;
const onChanged = vi.fn(),
  onPending = vi.fn();
function render(patch: Partial<Parameters<typeof LibraryManagedFileControls>[0]> = {}) {
  root.render(
    <RegistryContext.Provider value={registry}>
      <LibraryManagedFileControls
        copy={copy}
        connected
        supported
        canAct
        authorityEnvironmentId={authorityEnvironmentId}
        onChanged={onChanged}
        onPending={onPending}
        {...patch}
      />
    </RegistryContext.Provider>,
  );
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((x) => x.textContent === label)!;
}
async function click(label: string) {
  await act(() => button(label).click());
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  state.permission = Atom.make(true);
  state.preferences = Atom.make<AsyncResult.AsyncResult<Preferences, never>>(
    AsyncResult.success({}),
  ).pipe(Atom.keepAlive);
  state.reopen.mockReset().mockResolvedValue(AsyncResult.success(restored));
  state.retain.mockReset().mockResolvedValue(AsyncResult.success(restored));
  state.register.mockReset().mockResolvedValue(AsyncResult.success(restored));
  state.save
    .mockReset()
    .mockImplementation(
      async ({ transform }: { transform: (p: Preferences) => Partial<Preferences> }) => {
        const current = registry.get(state.preferences!);
        if (current._tag !== "Success") throw new Error("preferences unavailable");
        registry.set(
          state.preferences!,
          AsyncResult.success({ ...current.value, ...transform(current.value) }),
        );
      },
    );
  onChanged.mockReset();
  onPending.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  registry.dispose();
  vi.unstubAllGlobals();
});

it("restores the same files directly and publishes the restored copy", async () => {
  await act(() => render());
  await click("Restore files");
  expect(state.reopen).toHaveBeenCalledWith({
    environmentId,
    input: { workingCopyId: copy.id, requestId: expect.any(String) },
  });
  expect(state.register).toHaveBeenCalledWith({
    environmentId: authorityEnvironmentId,
    input: { requestId: expect.any(String), copy: restored },
  });
  expect(state.retain).not.toHaveBeenCalled();
  expect(onChanged).toHaveBeenCalledWith(restored);
});
it("retries publication after remount without restoring a second time", async () => {
  state.register.mockResolvedValueOnce(
    AsyncResult.failure(Cause.fail(new Error("Library offline"))),
  );
  await act(() => render());
  await click("Restore files");
  const request = state.register.mock.calls[0]![0];
  await act(() => root.unmount());
  root = createRoot(container);
  await act(() => render());
  await click("Retry saving file status");
  expect(state.reopen).toHaveBeenCalledTimes(1);
  expect(state.register).toHaveBeenLastCalledWith(request);
});
it("retains a stable restore request after an uncertain host response", async () => {
  state.reopen.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Connection lost"))));
  await act(() => render());
  await click("Restore files");
  const request = state.reopen.mock.calls[0]![0];
  await click("Retry restoring files");
  expect(state.reopen).toHaveBeenLastCalledWith(request);
});
it("offers recovery for missing and failed files with a saved archive", async () => {
  await act(() => render({ copy: { ...copy, state: "missing", registered: true } }));
  expect(button("Restore files")).toBeDefined();
  await act(() => render({ copy: { ...copy, state: "failed", registered: true } }));
  expect(button("Restore files")).toBeDefined();
});
it("does not restore while disconnected or permission is missing", async () => {
  await act(() => render({ connected: false }));
  expect(button("Restore files").disabled).toBe(true);
  await act(() => {
    registry.set(state.permission!, false);
    render();
  });
  expect(button("Restore files").disabled).toBe(true);
  expect(state.reopen).not.toHaveBeenCalled();
});
it("saves the intent before changing host files", async () => {
  state.save.mockRejectedValueOnce(new Error("Storage full"));
  await act(() => render());
  await click("Restore files");
  expect(state.reopen).not.toHaveBeenCalled();
  expect(state.register).not.toHaveBeenCalled();
});
it("prevents simultaneous restore and Keep changes", async () => {
  let complete!: (result: AsyncResult.AsyncResult<LibraryWorkingCopy, never>) => void;
  state.reopen.mockReturnValueOnce(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  await act(() => render());
  await click("Restore files");
  expect(onPending).toHaveBeenLastCalledWith(true);
  expect(button("Restoring files…").disabled).toBe(true);
  await act(async () => complete(AsyncResult.success(restored)));
  expect(state.reopen).toHaveBeenCalledTimes(1);
  expect(onPending).toHaveBeenLastCalledWith(false);
});

it("unlocks Keep after a definite authorization rejection", async () => {
  state.retain.mockResolvedValueOnce(
    AsyncResult.failure(
      Cause.fail(
        new EnvironmentAuthorizationError({
          message: "Permission denied",
          requiredScope: "source-control:write",
        }),
      ),
    ),
  );
  await act(() => render({ copy: restored }));
  await click("Keep files on this computer");
  expect(button("Keep files on this computer").disabled).toBe(false);
  expect(container.textContent).toContain("Permission denied");
  expect(button("Retry saving Keep files setting")).toBeUndefined();
  expect(onPending).toHaveBeenLastCalledWith(false);
});
it("preserves the completed host change when the final local save fails", async () => {
  const save = state.save.getMockImplementation()!;
  let failed = false;
  state.save.mockImplementation(async (value) => {
    if (state.register.mock.calls.length > 0 && !failed) {
      failed = true;
      throw new Error("Local storage unavailable");
    }
    return save(value);
  });
  await act(() => render());
  await click("Restore files");
  expect(onChanged).not.toHaveBeenCalled();
  await click("Retry saving file status");
  expect(state.reopen).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledWith(restored);
});
it("does not publish a restored folder under another authority", async () => {
  state.register.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Offline"))));
  await act(() => render());
  await click("Restore files");
  await act(() => render({ authorityEnvironmentId: EnvironmentId.make("another-library") }));
  expect(button("Retry saving file status").disabled).toBe(true);
  expect(state.register).toHaveBeenCalledTimes(1);
});
