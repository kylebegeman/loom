// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type PreviewResult = AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>;
const state = vi.hoisted(() => ({
  adopt: vi.fn(),
  retention: vi.fn(),
  review: vi.fn(),
  query: vi.fn(),
  adoptPermission: null as Atom.Writable<boolean> | null,
  retentionPermission: null as Atom.Writable<boolean> | null,
  presentation: null as Atom.Writable<{
    entry: { enabled: boolean };
    connection: { phase: string };
  }> | null,
  adoptCommand: { permissionAtom: () => state.adoptPermission! },
  retentionCommand: { permissionAtom: () => state.retentionPermission! },
  connected: true,
  supported: true,
  readable: true,
  handlers: new Map<string, () => void>(),
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  createProjectCheckoutAtoms: () => ({
    preview: state.query,
    adopt: state.adoptCommand,
    setRetention: state.retentionCommand,
  }),
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === state.adoptCommand ? state.adopt : state.retention,
}));
vi.mock("../../state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.review }));
vi.mock("../../state/entities", () => ({
  useEnvironmentServerConfig: () => ({
    environment: {
      capabilities: { loomFeatures: state.supported ? ["project-checkout-management"] : [] },
    },
  }),
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    presentation: {
      entry: { enabled: true },
      connection: { phase: state.connected ? "connected" : "offline" },
    },
  }),
  environmentPresentations: { presentationAtom: () => state.presentation! },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => state.readable,
  readEnvironmentScope: () => state.readable,
}));
vi.mock("./libraryState", () => ({ useRefreshOnRefocus: () => undefined }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({
    children,
    accessibilityRole,
  }: {
    children: ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled: boolean;
    onPress: () => void;
  }) => {
    state.handlers.set(label, onPress);
    return (
      <button disabled={disabled} onClick={onPress}>
        {label}
      </button>
    );
  },
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
    onValueChange: (keep: boolean) => void;
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

import { LibraryFolderStorage } from "./LibraryFolderStorage";
const environmentId = EnvironmentId.make("computer"),
  projectId = ProjectId.make("root");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "project",
  projectRevision: 1,
  environmentId,
  rootPath: "/project",
  rootLocalProjectId: projectId,
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
};
const preview = (patch: Partial<ProjectCheckoutPreview> = {}): ProjectCheckoutPreview => ({
  projectId,
  workspaceRoot: copy.rootPath,
  state: "external",
  ownershipSource: null,
  retention: "keep",
  head: null,
  branch: null,
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: [],
  reviewToken: "initial",
  ...patch,
});
let registry: AtomRegistry.AtomRegistry,
  query: Atom.Writable<PreviewResult>,
  container: HTMLDivElement,
  root: Root;
const onChanged = vi.fn();
function render(canAct = true) {
  root.render(
    <RegistryContext.Provider value={registry}>
      <LibraryFolderStorage copy={copy} canAct={canAct} onChanged={onChanged} />
    </RegistryContext.Provider>,
  );
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((node) => node.textContent === label)!;
}
async function click(label: string) {
  await act(() => button(label).click());
}
async function mount(initial = preview()) {
  registry.set(query, AsyncResult.success(initial));
  await act(() => render());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  query = Atom.make<PreviewResult>(AsyncResult.success(preview()));
  state.adoptPermission = Atom.make(true);
  state.retentionPermission = Atom.make(true);
  state.presentation = Atom.make<{ entry: { enabled: boolean }; connection: { phase: string } }>({
    entry: { enabled: true },
    connection: { phase: "connected" },
  });
  state.connected = true;
  state.supported = true;
  state.readable = true;
  state.query.mockReset().mockReturnValue(query);
  state.adopt
    .mockReset()
    .mockResolvedValue(
      AsyncResult.success(
        preview({ state: "managed", ownershipSource: "adopted", retention: "release-on-settle" }),
      ),
    );
  state.retention
    .mockReset()
    .mockResolvedValue(
      AsyncResult.success(
        preview({ state: "managed", ownershipSource: "adopted", retention: "keep" }),
      ),
    );
  state.review.mockReset().mockImplementation(async () => {
    const result = AsyncResult.success(preview({ reviewToken: "fresh" }));
    registry.set(query, result);
    return result;
  });
  state.handlers.clear();
  onChanged.mockReset();
  vi.spyOn(registry, "refresh").mockImplementation(() => undefined);
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

describe("mobile existing-folder storage", () => {
  it("waits for a fresh review and explicit confirmation before consenting to cleanup", async () => {
    await mount();
    let finish!: (value: PreviewResult) => void;
    state.review.mockReturnValueOnce(
      new Promise<PreviewResult>((resolve) => {
        finish = resolve;
      }),
    );
    await click("Keep files on this computer");
    expect(button("Allow Loom to manage files").disabled).toBe(true);
    expect(state.adopt).not.toHaveBeenCalled();
    await act(() => {
      const result = AsyncResult.success(preview({ reviewToken: "fresh" }));
      registry.set(query, result);
      finish(result);
    });
    await click("Allow Loom to manage files");
    expect(state.adopt).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "fresh", retention: "release-on-settle" },
    });
    expect(state.retention).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledOnce();
  });
  it("invalidates canceled and superseded consent handlers", async () => {
    await mount();
    await click("Keep files on this computer");
    const canceled = state.handlers.get("Allow Loom to manage files")!;
    await click("Cancel");
    await act(() => canceled());
    expect(state.adopt).not.toHaveBeenCalled();
    await click("Keep files on this computer");
    const stale = state.handlers.get("Allow Loom to manage files")!;
    await act(() => registry.set(query, AsyncResult.success(preview({ reviewToken: "changed" }))));
    expect(button("Allow Loom to manage files").disabled).toBe(true);
    await act(() => stale());
    expect(state.adopt).not.toHaveBeenCalled();
    await click("Review files again");
    await click("Allow Loom to manage files");
    expect(state.adopt).toHaveBeenCalledOnce();
  });
  it("invalidates consent when file permission is lost and does not reuse it on reconnection", async () => {
    await mount();
    await click("Keep files on this computer");
    const stale = state.handlers.get("Allow Loom to manage files")!;
    await act(() => registry.set(state.adoptPermission!, false));
    await act(() => stale());
    expect(state.adopt).not.toHaveBeenCalled();
    await act(() => registry.set(state.adoptPermission!, true));
    expect(container.textContent).not.toContain("Let Loom free space here?");
  });
  it("requires another consent after a stale-review failure", async () => {
    state.adopt.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("The folder changed. Review it again."))),
    );
    await mount();
    await click("Keep files on this computer");
    await click("Allow Loom to manage files");
    expect(container.textContent).toContain("The folder changed.");
    expect(container.textContent).not.toContain("Let Loom free space here?");
    await click("Keep files on this computer");
    await click("Allow Loom to manage files");
    expect(state.adopt).toHaveBeenCalledTimes(2);
  });
  it("changes adopted retention directly and restores released files using keep", async () => {
    await mount(preview({ state: "managed", ownershipSource: "adopted" }));
    await click("Keep files on this computer");
    expect(state.retention).toHaveBeenCalledWith({
      environmentId,
      input: { projectId, reviewToken: "initial", retention: "release-on-settle" },
    });
    await act(() =>
      registry.set(
        query,
        AsyncResult.success(preview({ state: "released", ownershipSource: "adopted" })),
      ),
    );
    await click("Restore files");
    expect(state.retention).toHaveBeenLastCalledWith({
      environmentId,
      input: { projectId, reviewToken: "initial", retention: "keep" },
    });
    expect(state.adopt).not.toHaveBeenCalled();
  });
  it("blocks review while loading, blocked, unauthorized, or pointing at another root", async () => {
    await mount();
    for (const result of [
      AsyncResult.waiting(AsyncResult.success(preview())),
      AsyncResult.success(preview({ state: "blocked" })),
    ]) {
      await act(() => registry.set(query, result));
      expect(button("Keep files on this computer").disabled).toBe(true);
    }
    await act(() => registry.set(query, AsyncResult.success(preview({ workspaceRoot: "/other" }))));
    expect(container.textContent).toContain("file location changed");
    expect(state.adopt).not.toHaveBeenCalled();
    state.supported = false;
    await act(() => render());
    expect(container.textContent).toContain("Update Loom");
    state.supported = true;
    state.readable = false;
    await act(() => render());
    expect(container.textContent).toContain("cannot check files");
  });
});
