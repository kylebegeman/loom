// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ButtonProps } from "../../components/ui/Button";
import type { SheetProps } from "../../components/ui/Sheet.types";

type PreviewResult = AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>;
type CopiesResult = AsyncResult.AsyncResult<readonly LibraryWorkingCopy[], Error>;
type ComputerPresentation = {
  entry: { enabled: boolean };
  connection: { phase: string };
};
const state = vi.hoisted(() => ({
  update: vi.fn(),
  preview: vi.fn(),
  copies: vi.fn(),
  navigate: vi.fn(),
  permissions: new Map<EnvironmentId, Atom.Writable<boolean>>(),
  command: { permissionAtom: (id: EnvironmentId) => state.permissions.get(id)! },
  presentation: null as Atom.Writable<ComputerPresentation> | null,
  authorityId: null as EnvironmentId | null,
  authorityLoaded: true,
  connected: true,
  readable: true,
  supported: true,
  handlers: new Map<string, () => void>(),
  change: (_value: string) => {},
  submit: () => {},
  dismiss: () => {},
  dismissible: true,
}));
vi.mock("@t3tools/client-runtime/fork", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/fork")>()),
  createProjectCheckoutAtoms: () => ({ preview: state.preview }),
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { update: state.command } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.update }));
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
vi.mock("../../state/session", () => ({ useEnvironmentScope: () => state.readable }));
vi.mock("../library/libraryState", () => ({
  library: { copies: (request: unknown) => state.copies(request) },
  useLibraryAuthority: () => ({
    environmentId: state.authorityId,
    loaded: state.authorityLoaded,
  }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: state.navigate }),
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/ScreenScrollView", () => ({
  ScreenScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({
    children,
    accessibilityRole,
  }: {
    children: ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
  AppTextInput: ({
    value,
    editable,
    onChangeText,
    onSubmitEditing,
    accessibilityLabel,
  }: {
    value: string;
    editable: boolean;
    onChangeText: (value: string) => void;
    onSubmitEditing: () => void;
    accessibilityLabel: string;
  }) => {
    state.change = onChangeText;
    state.submit = onSubmitEditing;
    return <input aria-label={accessibilityLabel} value={value} disabled={!editable} readOnly />;
  },
}));
vi.mock("../../components/ui/Button", () => ({
  Button: ({ label, disabled, onPress }: ButtonProps) => {
    state.handlers.set(label, onPress);
    return (
      <button disabled={disabled} onClick={onPress}>
        {label}
      </button>
    );
  },
}));
vi.mock("../../components/ui/Sheet", () => ({
  Sheet: ({ children, onClose, dismissible = true }: SheetProps) => {
    state.dismiss = onClose;
    state.dismissible = dismissible;
    return <div role="dialog">{children}</div>;
  },
}));

import { ProjectFolderLocation } from "./ProjectFolderLocation";

const environmentId = EnvironmentId.make("destination-computer");
const project = {
  environmentId,
  id: ProjectId.make("existing-project-with-conversations"),
  workspaceRoot: "/work/office",
};
const preview = (patch: Partial<ProjectCheckoutPreview> = {}): ProjectCheckoutPreview => ({
  projectId: project.id,
  workspaceRoot: project.workspaceRoot,
  state: "blocked",
  ownershipSource: null,
  retention: "inherit",
  head: null,
  branch: null,
  repositoryIdentity: null,
  localFiles: { trackedChanges: 0, untrackedFiles: 0, ignoredFiles: 0, truncated: false },
  blockers: ["The project folder is missing and has no managed recovery receipt."],
  reviewToken: null,
  ...patch,
});
const copy: LibraryWorkingCopy = {
  id: "copy",
  projectId: "shared-project",
  projectRevision: 1,
  environmentId,
  rootPath: project.workspaceRoot,
  rootLocalProjectId: project.id,
  repositories: [],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
let registry: AtomRegistry.AtomRegistry;
let root: Root;
let container: HTMLDivElement;
let checkoutAtom: Atom.Writable<PreviewResult>;
let copiesAtom: Atom.Writable<CopiesResult>;
function render(patch: Partial<typeof project> & { isScratch?: boolean } = {}, disabled = false) {
  act(() =>
    root.render(
      <RegistryContext.Provider value={registry}>
        <ProjectFolderLocation
          project={{ ...project, ...patch }}
          computerLabel="Work computer"
          disabled={disabled}
        />
      </RegistryContext.Provider>,
    ),
  );
}
function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function open() {
  await click("Update folder location");
}
function change(value = "/work/desk") {
  act(() => state.change(value));
}
async function submit() {
  await act(async () => state.submit());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.update.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.preview.mockReset();
  state.copies.mockReset();
  state.navigate.mockReset();
  state.permissions.clear();
  state.permissions.set(environmentId, Atom.make(true));
  state.presentation = Atom.make<ComputerPresentation>({
    entry: { enabled: true },
    connection: { phase: "connected" },
  });
  state.authorityId = null;
  state.authorityLoaded = true;
  state.connected = true;
  state.readable = true;
  state.supported = true;
  state.handlers.clear();
  registry = AtomRegistry.make();
  checkoutAtom = Atom.make<PreviewResult>(AsyncResult.success(preview())).pipe(Atom.keepAlive);
  copiesAtom = Atom.make<CopiesResult>(AsyncResult.success([])).pipe(Atom.keepAlive);
  state.preview.mockReturnValue(checkoutAtom);
  state.copies.mockReturnValue(copiesAtom);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("correcting a mobile project folder location", () => {
  it("hides the editor for Scratch without inspecting its files", () => {
    render({ isScratch: true });
    expect(container.querySelector("button")).toBeNull();
    expect(state.preview).not.toHaveBeenCalled();
    expect(state.copies).not.toHaveBeenCalled();
  });

  it("saves only the trimmed folder path on the existing project's computer", async () => {
    render();
    expect(state.preview).not.toHaveBeenCalled();
    await open();
    expect(state.preview).toHaveBeenCalledWith({ environmentId, input: { projectId: project.id } });
    expect(button("Save folder location").disabled).toBe(true);
    change("  /work/desk  ");
    await submit();
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId: project.id, workspaceRoot: "/work/desk" },
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("cancels without saving and refuses an empty or unchanged path", async () => {
    render();
    await open();
    change("   ");
    expect(button("Save folder location").disabled).toBe(true);
    await submit();
    await click("Cancel");
    expect(state.update).not.toHaveBeenCalled();
    await open();
    expect(container.querySelector("input")?.value).toBe(project.workspaceRoot);
    await submit();
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each(["The folder does not exist.", "This folder already belongs to another project."])(
    "shows an inline failure and allows correcting the input: %s",
    async (message) => {
      state.update.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error(message))));
      render();
      await open();
      change();
      await submit();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(message);
      expect(container.querySelector("input")?.value).toBe("/work/desk");
      change("/work/another-folder");
      await click("Save folder location");
      expect(state.update).toHaveBeenLastCalledWith({
        environmentId,
        input: { projectId: project.id, workspaceRoot: "/work/another-folder" },
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    },
  );

  it("uses the destination's permission and blocks offline or externally busy editors", async () => {
    const other = EnvironmentId.make("another-computer");
    state.permissions.set(other, Atom.make(false));
    render({ environmentId: other });
    expect(button("Update folder location").disabled).toBe(true);
    render();
    expect(button("Update folder location").disabled).toBe(false);
    state.connected = false;
    render();
    expect(button("Update folder location").disabled).toBe(true);
    state.connected = true;
    render({}, true);
    expect(button("Update folder location").disabled).toBe(true);
  });

  it("rechecks live destination permission and connection before a stale submit", async () => {
    render();
    await open();
    change();
    const staleSubmit = state.submit;
    act(() => registry.set(state.permissions.get(environmentId)!, false));
    await act(async () => staleSubmit());
    expect(state.update).not.toHaveBeenCalled();
    act(() => registry.set(state.permissions.get(environmentId)!, true));
    registry.set(state.presentation!, {
      entry: { enabled: true },
      connection: { phase: "offline" },
    });
    await submit();
    expect(state.update).not.toHaveBeenCalled();
    registry.set(state.presentation!, {
      entry: { enabled: true },
      connection: { phase: "connected" },
    });
    state.update.mockResolvedValueOnce(
      AsyncResult.failure(
        Cause.fail(new Error("This connection cannot change threads or projects.")),
      ),
    );
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "This connection cannot change threads or projects.",
    );
  });

  it("prevents duplicate submission and dismissal while saving", async () => {
    const pending = Promise.withResolvers<AsyncResult.Success<void>>();
    state.update.mockReturnValueOnce(pending.promise);
    render();
    await open();
    change();
    const staleSubmit = state.submit;
    await submit();
    expect(button("Saving…").disabled).toBe(true);
    expect(button("Cancel").disabled).toBe(true);
    expect(state.dismissible).toBe(false);
    await act(async () => {
      staleSubmit();
      state.dismiss();
    });
    expect(state.update).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => pending.resolve(AsyncResult.success(undefined)));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it.each(["clone", "adopted"] as const)("blocks %s checkout roots", async (ownershipSource) => {
    registry.set(checkoutAtom, AsyncResult.success(preview({ ownershipSource })));
    render();
    await open();
    expect(container.textContent).toContain("Loom manages this folder's location and recovery.");
    expect(container.querySelector("input")).toBeNull();
    expect(button("Save folder location").disabled).toBe(true);
    await click("Save folder location");
    expect(state.update).not.toHaveBeenCalled();
  });

  it.each(["ready", "released"] as const)(
    "blocks %s Library roots by identity even if paths differ",
    async (copyState) => {
      state.authorityId = EnvironmentId.make("library-authority");
      registry.set(
        copiesAtom,
        AsyncResult.success([
          { ...copy, rootPath: "/different/path", state: copyState, registered: false },
        ]),
      );
      render();
      await open();
      expect(state.copies).toHaveBeenCalledWith({
        environmentId: state.authorityId,
        input: { includeReleased: true },
      });
      expect(container.textContent).toContain("Loom manages this location and its recovery.");
      expect(container.querySelector("input")).toBeNull();
      expect(button("Save folder location").disabled).toBe(true);
      await click("Open Project files");
      expect(state.navigate).toHaveBeenCalledWith("LibraryProject", { projectId: copy.projectId });
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it("protects Library repository project IDs and keeps computers separate", async () => {
    state.authorityId = EnvironmentId.make("library-authority");
    registry.set(
      copiesAtom,
      AsyncResult.success([
        {
          ...copy,
          rootLocalProjectId: null,
          repositories: [
            {
              resourceId: "resource",
              path: "/different/path",
              localProjectId: project.id,
              head: null,
              branch: null,
            },
          ],
        },
      ]),
    );
    render();
    await open();
    expect(button("Save folder location").disabled).toBe(true);
    act(() =>
      registry.set(
        copiesAtom,
        AsyncResult.success([{ ...copy, environmentId: EnvironmentId.make("another-computer") }]),
      ),
    );
    change();
    expect(button("Save folder location").disabled).toBe(false);
  });

  it("waits for Library preferences and fails closed if working copies cannot be checked", async () => {
    state.authorityLoaded = false;
    render();
    await open();
    expect(container.querySelector("input")).toBeNull();
    state.authorityLoaded = true;
    state.authorityId = EnvironmentId.make("library-authority");
    registry.set(copiesAtom, AsyncResult.failure(Cause.fail(new Error("Library disconnected"))));
    render();
    expect(container.textContent).toContain(
      "Could not check Project working copies: Library disconnected",
    );
    expect(container.querySelector("input")).toBeNull();
    expect(button("Save folder location").disabled).toBe(true);
    const refresh = vi.spyOn(registry, "refresh");
    await click("Retry checks");
    expect(refresh).toHaveBeenCalledWith(copiesAtom);
    act(() => registry.set(copiesAtom, AsyncResult.success([])));
    change();
    await submit();
    expect(state.update).toHaveBeenCalledOnce();
  });

  it("waits for a successful checkout check and supports retrying errors", async () => {
    registry.set(checkoutAtom, AsyncResult.initial());
    render();
    await open();
    expect(container.querySelector("input")).toBeNull();
    act(() =>
      registry.set(
        checkoutAtom,
        AsyncResult.failure(Cause.fail(new Error("Computer unavailable"))),
      ),
    );
    expect(container.textContent).toContain("Computer unavailable");
    expect(button("Save folder location").disabled).toBe(true);
    const refresh = vi.spyOn(registry, "refresh");
    await click("Retry checks");
    expect(refresh).toHaveBeenCalledWith(checkoutAtom);
    act(() => registry.set(checkoutAtom, AsyncResult.success(preview())));
    change();
    await submit();
    expect(state.update).toHaveBeenCalledOnce();
  });

  it.each([
    { projectId: ProjectId.make("another-project") },
    { workspaceRoot: "/changed/saved/path" },
  ])("rejects a checkout check for a different saved folder: %j", async (patch) => {
    registry.set(checkoutAtom, AsyncResult.success(preview(patch)));
    render();
    await open();
    expect(container.textContent).toContain("The saved folder changed.");
    expect(container.querySelector("input")).toBeNull();
    expect(button("Save folder location").disabled).toBe(true);
  });

  it("requires read access and a computer that supports management checks", async () => {
    state.readable = false;
    render();
    await open();
    expect(state.preview).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "This connection cannot check whether Loom manages this folder.",
    );
    await click("Cancel");
    state.readable = true;
    state.supported = false;
    await open();
    expect(state.preview).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Update Loom on this computer before changing its folder location.",
    );
  });
});
