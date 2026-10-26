import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type PreviewResult = AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>;
type CopiesResult = AsyncResult.AsyncResult<readonly LibraryWorkingCopy[], Error>;
const state = vi.hoisted(() => ({
  update: vi.fn(),
  preview: vi.fn(),
  copies: vi.fn(),
  permissions: new Map<EnvironmentId, Atom.Writable<boolean>>(),
  command: { permissionAtom: (id: EnvironmentId) => state.permissions.get(id)! },
  authorityId: null as EnvironmentId | null,
  connected: true,
  readable: true,
  authorized: true,
}));
vi.mock("~/state/projects", () => ({ projectEnvironment: { update: state.command } }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.update }));
vi.mock("~/state/environments", () => ({
  useEnvironment: () => ({
    label: "Work computer",
    entry: { enabled: true },
    connection: { phase: state.connected ? "connected" : "disconnected" },
    serverConfig: {
      environment: { capabilities: { loomFeatures: ["project-checkout-management"] } },
    },
  }),
}));
vi.mock("~/state/session", () => ({
  useEnvironmentScope: () => state.readable,
  readEnvironmentScope: () => state.authorized,
}));
vi.mock("~/fork/project-checkout/state", () => ({
  PROJECT_CHECKOUT_FEATURE: "project-checkout-management",
  projectCheckouts: { preview: (request: unknown) => state.preview(request) },
}));
vi.mock("~/fork/project-library/state", () => ({
  projectLibrary: { copies: (request: unknown) => state.copies(request) },
  useLibraryAuthority: () => ({ authorityId: state.authorityId }),
}));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/input", () => ({ Input: "input" }));
vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => children,
  DialogPopup: "dialog",
  DialogHeader: "header",
  DialogTitle: "h2",
  DialogDescription: "p",
  DialogPanel: "section",
  DialogFooter: "footer",
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

import { ProjectFolderLocation } from "./ProjectFolderLocation";

const environmentId = EnvironmentId.make("destination-computer");
const project = {
  id: ProjectId.make("existing-project-with-conversations"),
  environmentId,
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
let renderer: ReactTestRenderer | undefined;
let checkoutAtom: Atom.Writable<PreviewResult>;
let copiesAtom: Atom.Writable<CopiesResult>;

const button = (label: string) =>
  renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
const form = () => renderer!.root.findByType("form");
async function mount() {
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <ProjectFolderLocation project={project} />
      </RegistryContext.Provider>,
    );
  });
}
async function open() {
  await act(() => button("Update folder location").props.onClick());
}
async function change(value = "/work/desk") {
  await act(() => renderer!.root.findByType("input").props.onChange({ currentTarget: { value } }));
}
async function submit() {
  await act(async () => {
    form().props.onSubmit({ preventDefault() {} });
  });
}
const text = () =>
  renderer!.root
    .findAll((node) => typeof node.type === "string")
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join(" ");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.update.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.preview.mockReset();
  state.copies.mockReset();
  state.permissions.clear();
  state.permissions.set(environmentId, Atom.make(true));
  state.authorityId = null;
  state.connected = true;
  state.readable = true;
  state.authorized = true;
  registry = AtomRegistry.make();
  checkoutAtom = Atom.make<PreviewResult>(AsyncResult.success(preview())).pipe(Atom.keepAlive);
  copiesAtom = Atom.make<CopiesResult>(AsyncResult.success([])).pipe(Atom.keepAlive);
  state.preview.mockReturnValue(checkoutAtom);
  state.copies.mockReturnValue(copiesAtom);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("updating an existing project folder location", () => {
  it("hides relocation for the environment's Scratch folder", async () => {
    await act(() => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          <ProjectFolderLocation project={{ ...project, isScratch: true }} />
        </RegistryContext.Provider>,
      );
    });
    expect(renderer!.root.findAllByType("button")).toHaveLength(0);
    expect(state.preview).not.toHaveBeenCalled();
  });

  it("updates only the saved location of the same project on its destination computer", async () => {
    await mount();
    expect(state.preview).not.toHaveBeenCalled();
    await open();
    expect(state.preview).toHaveBeenCalledWith({ environmentId, input: { projectId: project.id } });
    expect(button("Save folder location").props.disabled).toBe(true);
    await change("  /work/desk  ");
    await submit();
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId: project.id, workspaceRoot: "/work/desk" },
    });
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
  });

  it("cancels without changing the project and prevents an empty location", async () => {
    await mount();
    await open();
    await change("   ");
    expect(button("Save folder location").props.disabled).toBe(true);
    await submit();
    await act(() => button("Cancel").props.onClick());
    expect(state.update).not.toHaveBeenCalled();
    await open();
    expect(renderer!.root.findByType("input").props.value).toBe(project.workspaceRoot);
  });

  it.each(["The folder does not exist.", "This folder already belongs to another project."])(
    "keeps the location editable after server validation fails: %s",
    async (message) => {
      state.update.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error(message))));
      await mount();
      await open();
      await change();
      await submit();
      expect(renderer!.root.findByProps({ role: "alert" }).children).toEqual([message]);
      expect(renderer!.root.findByType("input").props.value).toBe("/work/desk");
      await change("/work/another-folder");
      await submit();
      expect(state.update).toHaveBeenLastCalledWith({
        environmentId,
        input: { projectId: project.id, workspaceRoot: "/work/another-folder" },
      });
      expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
    },
  );

  it("disables the control when the destination denies changes or is offline", async () => {
    registry.set(state.permissions.get(environmentId)!, false);
    await mount();
    expect(button("Update folder location").props.disabled).toBe(true);
    await act(() => {
      registry.set(state.permissions.get(environmentId)!, true);
    });
    expect(button("Update folder location").props.disabled).toBe(false);
    state.connected = false;
    await act(() =>
      renderer!.update(
        <RegistryContext.Provider value={registry}>
          <ProjectFolderLocation project={project} />
        </RegistryContext.Provider>,
      ),
    );
    expect(button("Update folder location").props.disabled).toBe(true);
    expect(state.update).not.toHaveBeenCalled();
  });

  it("rechecks permission at submit and reports execution-time denial", async () => {
    await mount();
    await open();
    await change();
    const staleSubmit = form().props.onSubmit;
    await act(() => registry.set(state.permissions.get(environmentId)!, false));
    await act(() => staleSubmit({ preventDefault() {} }));
    expect(state.update).not.toHaveBeenCalled();
    await act(() => registry.set(state.permissions.get(environmentId)!, true));
    state.authorized = false;
    await submit();
    expect(state.update).not.toHaveBeenCalled();
    expect(text()).toContain("This connection cannot change threads or projects.");
  });

  it("locks duplicate saves and cancellation until the update settles", async () => {
    let finish!: (result: AsyncResult.Success<void>) => void;
    state.update.mockImplementation(
      () =>
        new Promise<AsyncResult.Success<void>>((resolve) => {
          finish = resolve;
        }),
    );
    await mount();
    await open();
    await change();
    await submit();
    expect(button("Saving…").props.disabled).toBe(true);
    expect(button("Cancel").props.disabled).toBe(true);
    await submit();
    expect(state.update).toHaveBeenCalledOnce();
    await act(() => finish(AsyncResult.success(undefined)));
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
  });

  it.each(["clone", "adopted"] as const)(
    "blocks relocation of %s checkout roots",
    async (ownershipSource) => {
      registry.set(checkoutAtom, AsyncResult.success(preview({ ownershipSource })));
      await mount();
      await open();
      expect(text()).toContain("Loom manages this folder's location and recovery.");
      expect(renderer!.root.findAllByType("input")).toHaveLength(0);
      expect(button("Save folder location").props.disabled).toBe(true);
      await submit();
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it.each(["ready", "released"] as const)(
    "protects %s managed Library roots by identity even when paths differ",
    async (copyState) => {
      state.authorityId = EnvironmentId.make("library-authority");
      registry.set(
        copiesAtom,
        AsyncResult.success([
          { ...copy, ownership: "managed", rootPath: "/different/saved/path", state: copyState },
        ]),
      );
      await mount();
      await open();
      expect(state.copies).toHaveBeenCalledWith({
        environmentId: state.authorityId,
        input: { includeReleased: true },
      });
      expect(text()).toContain("Loom manages this location and its recovery.");
      expect(button("Open Project files")).toBeDefined();
      expect(renderer!.root.findAllByType("input")).toHaveLength(0);
      await submit();
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it("lets a borrowed folder move once its project released it", async () => {
    state.authorityId = EnvironmentId.make("library-authority");
    registry.set(
      copiesAtom,
      AsyncResult.success([
        { ...copy, registered: false },
        { ...copy, id: "older-copy", state: "released" },
      ]),
    );
    await mount();
    await open();
    expect(text()).not.toContain("Loom manages this location");
    await change();
    await submit();
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId: project.id, workspaceRoot: "/work/desk" },
    });
  });

  it("checks Library component project identity and ignores copies on other computers", async () => {
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
              path: project.workspaceRoot,
              localProjectId: project.id,
              head: null,
              branch: null,
            },
          ],
        },
      ]),
    );
    await mount();
    await open();
    expect(button("Save folder location").props.disabled).toBe(true);
    await act(() =>
      registry.set(
        copiesAtom,
        AsyncResult.success([{ ...copy, environmentId: EnvironmentId.make("another-computer") }]),
      ),
    );
    await change();
    expect(button("Save folder location").props.disabled).toBe(false);
  });

  it("keeps editing blocked when Library copy linkage cannot be checked", async () => {
    state.authorityId = EnvironmentId.make("library-authority");
    registry.set(copiesAtom, AsyncResult.failure(Cause.fail(new Error("Library disconnected"))));
    await mount();
    await open();
    expect(text()).toContain("Could not check Project working copies: Library disconnected");
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    await submit();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("waits for successful management checks and supports retry after a failed check", async () => {
    registry.set(checkoutAtom, AsyncResult.initial());
    await mount();
    await open();
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    await act(() =>
      registry.set(
        checkoutAtom,
        AsyncResult.failure(Cause.fail(new Error("Computer unavailable"))),
      ),
    );
    expect(text()).toContain("Computer unavailable");
    expect(button("Save folder location").props.disabled).toBe(true);
    const refresh = vi.spyOn(registry, "refresh");
    await act(() => button("Retry checks").props.onClick());
    expect(refresh).toHaveBeenCalledWith(checkoutAtom);
    await act(() => registry.set(checkoutAtom, AsyncResult.success(preview())));
    await change();
    await submit();
    expect(state.update).toHaveBeenCalledOnce();
  });
});
