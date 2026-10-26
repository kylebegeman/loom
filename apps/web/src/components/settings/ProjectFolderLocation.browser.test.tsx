import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";

type PreviewResult = AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>;
type CopiesResult = AsyncResult.AsyncResult<readonly LibraryWorkingCopy[], Error>;
type FolderTarget = Parameters<typeof ProjectFolderLocation>[0]["project"];
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

function setup() {
  const registry = AtomRegistry.make();
  const permission = Atom.make(true).pipe(Atom.keepAlive);
  const checkout = Atom.make<PreviewResult>(AsyncResult.success(preview())).pipe(Atom.keepAlive);
  const copies = Atom.make<CopiesResult>(AsyncResult.success([])).pipe(Atom.keepAlive);
  state.update.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  state.preview.mockReset().mockReturnValue(checkout);
  state.copies.mockReset().mockReturnValue(copies);
  state.permissions.clear();
  state.permissions.set(environmentId, permission);
  state.authorityId = null;
  state.connected = true;
  state.readable = true;
  state.authorized = true;
  return { registry, permission, checkout, copies, [Symbol.dispose]: () => registry.dispose() };
}

const tree = (registry: AtomRegistry.AtomRegistry, target: FolderTarget = project) => (
  <RegistryContext.Provider value={registry}>
    <ProjectFolderLocation project={target} />
  </RegistryContext.Provider>
);
const updateButton = () =>
  page.getByRole("button", { name: /^Update folder location on Work computer at / });
const dialog = () => page.getByRole("dialog", { name: "Update folder location" });
const locationInput = () =>
  dialog().getByRole("textbox", { name: "Folder location on Work computer" });
const anyTextbox = () => dialog().getByRole("textbox");
const saveButton = () => dialog().getByRole("button", { name: "Save folder location" });
const cancelButton = () => dialog().getByRole("button", { name: "Cancel" });

async function mount(registry: AtomRegistry.AtomRegistry) {
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await render(tree(registry)));
  await expect.element(updateButton()).toBeInTheDocument();
  stack.move();
  return screen;
}
async function open() {
  await userEvent.click(updateButton());
  await expect.element(dialog()).toBeInTheDocument();
}
// Submits past a disabled or missing Save button, to prove the component's own guard holds.
const forceSubmit = () => act(() => dialog().element().querySelector("form")!.requestSubmit());

describe("updating an existing project folder location", () => {
  it("hides relocation for the environment's Scratch folder", async () => {
    using fixture = setup();
    await using screen = await render(
      <>
        <p>Scratch project</p>
        {tree(fixture.registry, { ...project, isScratch: true })}
      </>,
    );
    // The sibling shows the tree rendered, so a missing button is not just a pending render.
    await expect.element(screen.getByText("Scratch project")).toBeInTheDocument();
    await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
    expect(state.preview).not.toHaveBeenCalled();
  });

  it("updates only the saved location of the same project on its destination computer", async () => {
    using fixture = setup();
    await using _screen = await mount(fixture.registry);
    expect(state.preview).not.toHaveBeenCalled();
    await open();
    expect(state.preview).toHaveBeenCalledWith({ environmentId, input: { projectId: project.id } });
    await expect.element(saveButton()).toBeDisabled();
    await userEvent.fill(locationInput(), "  /work/desk  ");
    await userEvent.click(saveButton());
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId: project.id, workspaceRoot: "/work/desk" },
    });
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it("cancels without changing the project and prevents an empty location", async () => {
    using fixture = setup();
    await using _screen = await mount(fixture.registry);
    await open();
    await userEvent.fill(locationInput(), "   ");
    await expect.element(saveButton()).toBeDisabled();
    await forceSubmit();
    await userEvent.click(cancelButton());
    await expect.element(dialog()).not.toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
    await open();
    await expect.element(locationInput()).toHaveValue(project.workspaceRoot);
  });

  it.each(["The folder does not exist.", "This folder already belongs to another project."])(
    "keeps the location editable after server validation fails: %s",
    async (message) => {
      using fixture = setup();
      state.update.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error(message))));
      await using _screen = await mount(fixture.registry);
      await open();
      await userEvent.fill(locationInput(), "/work/desk");
      await userEvent.click(saveButton());
      await expect.element(dialog().getByRole("alert")).toHaveTextContent(message);
      await expect.element(locationInput()).toHaveValue("/work/desk");
      await userEvent.fill(locationInput(), "/work/another-folder");
      await userEvent.click(saveButton());
      expect(state.update).toHaveBeenLastCalledWith({
        environmentId,
        input: { projectId: project.id, workspaceRoot: "/work/another-folder" },
      });
      await expect.element(dialog()).not.toBeInTheDocument();
    },
  );

  it("disables the control when the destination denies changes or is offline", async () => {
    using fixture = setup();
    fixture.registry.set(fixture.permission, false);
    await using screen = await mount(fixture.registry);
    await expect.element(updateButton()).toBeDisabled();
    await act(() => fixture.registry.set(fixture.permission, true));
    await expect.element(updateButton()).toBeEnabled();
    state.connected = false;
    await screen.rerender(tree(fixture.registry));
    await expect.element(updateButton()).toBeDisabled();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("rechecks permission at submit and reports execution-time denial", async () => {
    using fixture = setup();
    await using _screen = await mount(fixture.registry);
    await open();
    await userEvent.fill(locationInput(), "/work/desk");
    // Inside one act the submit reaches the last render, which still allowed saving.
    await act(() => {
      fixture.registry.set(fixture.permission, false);
      dialog().element().querySelector("form")!.requestSubmit();
    });
    expect(state.update).not.toHaveBeenCalled();
    await act(() => fixture.registry.set(fixture.permission, true));
    state.authorized = false;
    await userEvent.click(saveButton());
    expect(state.update).not.toHaveBeenCalled();
    await expect
      .element(dialog())
      .toMatchTextContent("This connection cannot change threads or projects.");
  });

  it("locks duplicate saves and cancellation until the update settles", async () => {
    using fixture = setup();
    let finish!: (result: AsyncResult.Success<void>) => void;
    state.update.mockImplementation(
      () =>
        new Promise<AsyncResult.Success<void>>((resolve) => {
          finish = resolve;
        }),
    );
    await using _screen = await mount(fixture.registry);
    await open();
    await userEvent.fill(locationInput(), "/work/desk");
    await userEvent.click(saveButton());
    await expect.element(dialog().getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect.element(cancelButton()).toBeDisabled();
    await forceSubmit();
    expect(state.update).toHaveBeenCalledOnce();
    await act(() => finish(AsyncResult.success(undefined)));
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  it.each(["clone", "adopted"] as const)(
    "blocks relocation of %s checkout roots",
    async (ownershipSource) => {
      using fixture = setup();
      fixture.registry.set(fixture.checkout, AsyncResult.success(preview({ ownershipSource })));
      await using _screen = await mount(fixture.registry);
      await open();
      await expect
        .element(dialog())
        .toMatchTextContent("Loom manages this folder's location and recovery.");
      await expect.element(anyTextbox()).not.toBeInTheDocument();
      await expect.element(saveButton()).toBeDisabled();
      await forceSubmit();
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it.each(["ready", "released"] as const)(
    "protects %s managed Library roots by identity even when paths differ",
    async (copyState) => {
      using fixture = setup();
      state.authorityId = EnvironmentId.make("library-authority");
      fixture.registry.set(
        fixture.copies,
        AsyncResult.success([
          { ...copy, ownership: "managed", rootPath: "/different/saved/path", state: copyState },
        ]),
      );
      await using _screen = await mount(fixture.registry);
      await open();
      expect(state.copies).toHaveBeenCalledWith({
        environmentId: state.authorityId,
        input: { includeReleased: true },
      });
      await expect
        .element(dialog())
        .toMatchTextContent("Loom manages this location and its recovery.");
      await expect
        .element(dialog().getByRole("link", { name: "Open Project files" }))
        .toBeVisible();
      await expect.element(anyTextbox()).not.toBeInTheDocument();
      await forceSubmit();
      expect(state.update).not.toHaveBeenCalled();
    },
  );

  it("lets a borrowed folder move once its project released it", async () => {
    using fixture = setup();
    state.authorityId = EnvironmentId.make("library-authority");
    fixture.registry.set(
      fixture.copies,
      AsyncResult.success([
        { ...copy, registered: false },
        { ...copy, id: "older-copy", state: "released" },
      ]),
    );
    await using _screen = await mount(fixture.registry);
    await open();
    await expect.element(dialog()).not.toMatchTextContent("Loom manages this location");
    await userEvent.fill(locationInput(), "/work/desk");
    await userEvent.click(saveButton());
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId: project.id, workspaceRoot: "/work/desk" },
    });
  });

  it("checks Library component project identity and ignores copies on other computers", async () => {
    using fixture = setup();
    state.authorityId = EnvironmentId.make("library-authority");
    fixture.registry.set(
      fixture.copies,
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
    await using _screen = await mount(fixture.registry);
    await open();
    await expect.element(dialog()).toMatchTextContent("Loom manages this location");
    await expect.element(saveButton()).toBeDisabled();
    await act(() =>
      fixture.registry.set(
        fixture.copies,
        AsyncResult.success([{ ...copy, environmentId: EnvironmentId.make("another-computer") }]),
      ),
    );
    await userEvent.fill(locationInput(), "/work/desk");
    await expect.element(saveButton()).toBeEnabled();
  });

  it("keeps editing blocked when Library copy linkage cannot be checked", async () => {
    using fixture = setup();
    state.authorityId = EnvironmentId.make("library-authority");
    fixture.registry.set(
      fixture.copies,
      AsyncResult.failure(Cause.fail(new Error("Library disconnected"))),
    );
    await using _screen = await mount(fixture.registry);
    await open();
    await expect
      .element(dialog())
      .toMatchTextContent("Could not check Project working copies: Library disconnected");
    await expect.element(anyTextbox()).not.toBeInTheDocument();
    await forceSubmit();
    expect(state.update).not.toHaveBeenCalled();
  });

  it("waits for successful management checks and supports retry after a failed check", async () => {
    using fixture = setup();
    fixture.registry.set(fixture.checkout, AsyncResult.initial());
    await using _screen = await mount(fixture.registry);
    await open();
    await expect.element(anyTextbox()).not.toBeInTheDocument();
    await act(() =>
      fixture.registry.set(
        fixture.checkout,
        AsyncResult.failure(Cause.fail(new Error("Computer unavailable"))),
      ),
    );
    await expect.element(dialog()).toMatchTextContent("Computer unavailable");
    await expect.element(saveButton()).toBeDisabled();
    using refresh = vi.spyOn(fixture.registry, "refresh");
    await userEvent.click(dialog().getByRole("button", { name: "Retry checks" }));
    expect(refresh).toHaveBeenCalledWith(fixture.checkout);
    await act(() => fixture.registry.set(fixture.checkout, AsyncResult.success(preview())));
    await userEvent.fill(locationInput(), "/work/desk");
    await userEvent.click(saveButton());
    expect(state.update).toHaveBeenCalledOnce();
  });
});
