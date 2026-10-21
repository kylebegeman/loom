import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { LibraryWorkingCopy, ProjectCheckoutPreview } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type PreviewResult = AsyncResult.AsyncResult<ProjectCheckoutPreview, Error>;
const state = vi.hoisted(() => ({
  adopt: vi.fn(),
  setRetention: vi.fn(),
  query: vi.fn(),
  adoptPermission: null as Atom.Writable<boolean> | null,
  retentionPermission: null as Atom.Writable<boolean> | null,
  adoptCommand: { permissionAtom: () => state.adoptPermission! },
  retentionCommand: { permissionAtom: () => state.retentionPermission! },
  connected: true,
  supported: true,
  readable: true,
}));
vi.mock("../project-checkout/state", () => ({
  PROJECT_CHECKOUT_FEATURE: "project-checkout-management",
  projectCheckouts: {
    preview: (input: unknown) => state.query(input),
    adopt: state.adoptCommand,
    setRetention: state.retentionCommand,
  },
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === state.adoptCommand ? state.adopt : state.setRetention,
}));
vi.mock("~/state/environments", () => ({
  useEnvironment: () => ({
    connection: { phase: state.connected ? "connected" : "disconnected" },
    serverConfig: {
      environment: {
        capabilities: {
          loomFeatures: state.supported ? ["project-checkout-management"] : [],
        },
      },
    },
  }),
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => state.readable }));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/switch", () => ({ Switch: "input" }));
vi.mock("./LibraryControls", () => ({
  LibraryDialog: ({
    open,
    title,
    description,
    children,
    actions,
  }: {
    open: boolean;
    title: string;
    description: string;
    children: ReactNode;
    actions: ReactNode;
  }) =>
    open ? (
      <dialog>
        <h2>{title}</h2>
        <p>{description}</p>
        {children}
        {actions}
      </dialog>
    ) : null,
  LibraryErrorNotice: ({ error }: { error: string | null }) =>
    error ? <p role="alert">{error}</p> : null,
}));

import { ExistingFolderStorage } from "./ExistingFolderStorage";

const environmentId = EnvironmentId.make("computer");
const projectId = ProjectId.make("root");
const componentId = ProjectId.make("component");
const copy: LibraryWorkingCopy = {
  id: "files",
  projectId: "library-project",
  projectRevision: 1,
  environmentId,
  rootPath: "/project",
  rootLocalProjectId: projectId,
  repositories: [
    {
      resourceId: "component",
      path: "/project/component",
      localProjectId: componentId,
      head: null,
      branch: null,
    },
  ],
  ownership: "borrowed",
  state: "ready",
  createdAt: "2026-10-15T12:00:00.000Z",
  updatedAt: "2026-10-15T12:00:00.000Z",
};
const preview = (patch: Partial<ProjectCheckoutPreview> = {}): ProjectCheckoutPreview => ({
  projectId,
  workspaceRoot: copy.rootPath,
  state: "external",
  ownershipSource: null,
  retention: "inherit",
  head: "abc123",
  branch: "main",
  repositoryIdentity: null,
  localFiles: { trackedChanges: 1, untrackedFiles: 2, ignoredFiles: 3, truncated: false },
  blockers: [],
  reviewToken: "initial-review",
  ...patch,
});
let registry: AtomRegistry.AtomRegistry;
let query: Atom.Writable<PreviewResult>;
let renderer: ReactTestRenderer | undefined;
let refreshed: PreviewResult | undefined;
const onChanged = vi.fn();
type Props = Parameters<typeof ExistingFolderStorage>[0];
const props = (patch: Partial<Props> = {}): Props => ({
  copy,
  online: true,
  canAct: true,
  onChanged,
  ...patch,
});
function view(input: Props) {
  return (
    <RegistryContext.Provider value={registry}>
      <ExistingFolderStorage {...input} />
    </RegistryContext.Provider>
  );
}
async function mount(patch: Partial<Props> = {}) {
  await act(() => {
    renderer = create(view(props(patch)));
  });
}
function button(label: string) {
  return renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
}
function toggle() {
  return renderer!.root.findByType("input");
}
async function turnOff() {
  await act(() => toggle().props.onCheckedChange(false));
}
async function confirm() {
  await act(() => button("Allow Loom to manage files").props.onClick());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.adopt.mockReset();
  state.setRetention.mockReset();
  state.query.mockReset();
  onChanged.mockReset();
  state.connected = true;
  state.supported = true;
  state.readable = true;
  registry = AtomRegistry.make();
  state.adoptPermission = Atom.make(true);
  state.retentionPermission = Atom.make(true);
  query = Atom.make<PreviewResult>(AsyncResult.success(preview()));
  state.query.mockReturnValue(query);
  state.adopt.mockResolvedValue(
    AsyncResult.success(
      preview({ state: "managed", ownershipSource: "adopted", retention: "release-on-settle" }),
    ),
  );
  state.setRetention.mockResolvedValue(
    AsyncResult.success(
      preview({ state: "managed", ownershipSource: "adopted", retention: "keep" }),
    ),
  );
  refreshed = undefined;
  vi.spyOn(registry, "refresh").mockImplementation(() => {
    if (refreshed) registry.set(query, refreshed);
  });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("existing folder storage", () => {
  it("leaves legacy folders untouched until an explicit fresh confirmation", async () => {
    await mount();
    expect(toggle().props.checked).toBe(true);
    expect(state.adopt).not.toHaveBeenCalled();
    expect(state.setRetention).not.toHaveBeenCalled();
    refreshed = AsyncResult.success(preview({ reviewToken: "fresh-review" }));
    await turnOff();
    expect(registry.refresh).toHaveBeenCalledWith(query);
    expect(state.adopt).not.toHaveBeenCalled();
    await confirm();
    expect(state.adopt).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "fresh-review", retention: "release-on-settle" },
    });
    expect(state.setRetention).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("cancels consent without changing files and rejects an old confirmation handler", async () => {
    await mount();
    await turnOff();
    const oldConfirm = button("Allow Loom to manage files").props.onClick;
    await act(() => button("Cancel").props.onClick());
    await act(() => oldConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
    expect(toggle().props.checked).toBe(true);
  });

  it("waits for a refreshed review and rejects superseded tokens", async () => {
    await mount();
    refreshed = AsyncResult.waiting(AsyncResult.success(preview()));
    await turnOff();
    expect(button("Allow Loom to manage files").props.disabled).toBe(true);
    await confirm();
    expect(state.adopt).not.toHaveBeenCalled();
    await act(() =>
      registry.set(query, AsyncResult.success(preview({ reviewToken: "new-review" }))),
    );
    const oldConfirm = button("Allow Loom to manage files").props.onClick;
    await act(() =>
      registry.set(query, AsyncResult.success(preview({ reviewToken: "newer-review" }))),
    );
    await act(() => oldConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
    refreshed = undefined;
    await confirm();
    expect(state.adopt.mock.calls[0]![0].input.reviewToken).toBe("newer-review");
  });

  it("refreshes stale reviews without retrying a mutation automatically", async () => {
    await mount();
    await turnOff();
    state.adopt.mockResolvedValueOnce(
      AsyncResult.failure(
        Cause.fail(Object.assign(new Error("Stale review"), { reason: "stale-review" })),
      ),
    );
    refreshed = AsyncResult.success(preview({ reviewToken: "replacement-review" }));
    await confirm();
    expect(state.adopt).toHaveBeenCalledOnce();
    expect(renderer!.root.findAllByProps({ role: "alert" })[0]!.children.join("")).toContain(
      "folder changed",
    );
    await confirm();
    expect(state.adopt.mock.calls[1]![0].input.reviewToken).toBe("replacement-review");
  });

  it("rechecks mutation permission even for an older confirmation callback", async () => {
    await mount();
    await turnOff();
    const oldConfirm = button("Allow Loom to manage files").props.onClick;
    await act(() => registry.set(state.adoptPermission!, false));
    await act(() => oldConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
    expect(button("Allow Loom to manage files").props.disabled).toBe(true);
  });

  it.each(["managed", "released"] as const)(
    "keeps or restores %s files through the checkout's retention setting",
    async (checkoutState) => {
      registry.set(
        query,
        AsyncResult.success(
          preview({
            state: checkoutState,
            ownershipSource: "adopted",
            retention: "release-on-settle",
          }),
        ),
      );
      await mount({ copy: { ...copy, keepOnComputer: true, state: "ready" } });
      if (checkoutState === "released") {
        expect(renderer!.root.findAllByType("input")).toHaveLength(0);
        await act(() => button("Restore files").props.onClick());
      } else {
        expect(toggle().props.checked).toBe(false);
        await act(() => toggle().props.onCheckedChange(true));
      }
      expect(state.setRetention).toHaveBeenCalledExactlyOnceWith({
        environmentId,
        input: { projectId, reviewToken: "initial-review", retention: "keep" },
      });
      expect(state.adopt).not.toHaveBeenCalled();
      expect(onChanged).toHaveBeenCalledOnce();
    },
  );

  it("changes an already managed folder to temporary without adopting again", async () => {
    registry.set(
      query,
      AsyncResult.success(
        preview({ state: "managed", ownershipSource: "clone", retention: "keep" }),
      ),
    );
    await mount();
    await turnOff();
    expect(state.setRetention).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "initial-review", retention: "release-on-settle" },
    });
    expect(state.adopt).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
  });

  it("shows an inherited policy as mixed until the user explicitly keeps files", async () => {
    registry.set(
      query,
      AsyncResult.success(
        preview({ state: "managed", ownershipSource: "adopted", retention: "inherit" }),
      ),
    );
    await mount();
    expect(toggle().props.mixed).toBe(true);
    expect(state.setRetention).not.toHaveBeenCalled();
    await act(() => toggle().props.onCheckedChange(true));
    expect(state.setRetention.mock.calls[0]![0].input.retention).toBe("keep");
  });

  it("uses the project root identity instead of a component and only falls back to an exact root repository", async () => {
    await mount();
    expect(state.query).toHaveBeenLastCalledWith({ environmentId, input: { projectId } });
    state.query.mockClear();
    await act(() => renderer!.update(view(props({ copy: { ...copy, rootLocalProjectId: null } }))));
    expect(state.query).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    await act(() =>
      renderer!.update(
        view(
          props({
            copy: {
              ...copy,
              rootLocalProjectId: null,
              repositories: [
                { ...copy.repositories[0]!, path: copy.rootPath, localProjectId: projectId },
              ],
            },
          }),
        ),
      ),
    );
    expect(state.query).toHaveBeenLastCalledWith({ environmentId, input: { projectId } });
  });

  it.each([{ workspaceRoot: "/another-folder" }, { projectId: componentId }])(
    "refuses to change a project whose preview points at another target: %j",
    async (target) => {
      registry.set(query, AsyncResult.success(preview(target)));
      await mount();
      expect(renderer!.root.findAllByType("input")).toHaveLength(0);
      expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain(
        "file location changed",
      );
      expect(state.adopt).not.toHaveBeenCalled();
      expect(state.setRetention).not.toHaveBeenCalled();
    },
  );

  it("invalidates consent when the parent changes targets or removes its action permission", async () => {
    await mount();
    await turnOff();
    const oldConfirm = button("Allow Loom to manage files").props.onClick;
    await act(() => renderer!.update(view(props({ canAct: false }))));
    await act(() => oldConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
    expect(toggle().props.disabled).toBe(true);
    await act(() => renderer!.update(view(props())));
    await turnOff();
    const previousTargetConfirm = button("Allow Loom to manage files").props.onClick;
    await act(() =>
      renderer!.update(
        view(
          props({ copy: { ...copy, rootPath: "/other-root", rootLocalProjectId: componentId } }),
        ),
      ),
    );
    await act(() => previousTargetConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
  });

  it.each(["offline", "disconnected", "unsupported", "unreadable"] as const)(
    "does not query or change files when %s",
    async (condition) => {
      state.connected = condition !== "disconnected";
      state.supported = condition !== "unsupported";
      state.readable = condition !== "unreadable";
      await mount({ online: condition !== "offline" });
      expect(state.query).not.toHaveBeenCalled();
      expect(state.adopt).not.toHaveBeenCalled();
      expect(state.setRetention).not.toHaveBeenCalled();
    },
  );

  it("keeps blocked folders safe while allowing their status to be checked again", async () => {
    registry.set(
      query,
      AsyncResult.success(
        preview({
          state: "blocked",
          reviewToken: null,
          blockers: ["This folder is missing and has no safe recovery."],
        }),
      ),
    );
    await mount();
    expect(toggle().props.disabled).toBe(true);
    expect(toggle().props.checked).toBe(true);
    await turnOff();
    expect(state.adopt).not.toHaveBeenCalled();
    refreshed = AsyncResult.success(preview());
    await act(() => button("Check files").props.onClick());
    expect(toggle().props.disabled).toBe(false);
  });

  it("shows the restore route if files disappear during confirmation", async () => {
    await mount();
    refreshed = AsyncResult.success(
      preview({
        state: "released",
        ownershipSource: "adopted",
        retention: "release-on-settle",
        reviewToken: "released-review",
      }),
    );
    await turnOff();
    expect(button("Allow Loom to manage files").props.disabled).toBe(true);
    expect(
      renderer!.root.findByType("dialog").findByProps({ role: "status" }).children.join(""),
    ).toContain("choose Restore files");
    await act(() => button("Cancel").props.onClick());
    await act(() => button("Restore files").props.onClick());
    expect(state.setRetention).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "released-review", retention: "keep" },
    });
    expect(state.adopt).not.toHaveBeenCalled();
  });

  it("rejects duplicate submissions while a file change is in flight", async () => {
    await mount();
    await turnOff();
    let resolveSave!: (result: PreviewResult) => void;
    state.adopt.mockImplementationOnce(
      () =>
        new Promise<PreviewResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const submit = button("Allow Loom to manage files").props.onClick;
    await act(() => {
      submit();
      submit();
    });
    expect(state.adopt).toHaveBeenCalledOnce();
    expect(button("Saving...").props.disabled).toBe(true);
    await act(() =>
      resolveSave(
        AsyncResult.success(
          preview({ state: "managed", ownershipSource: "adopted", retention: "release-on-settle" }),
        ),
      ),
    );
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("allows a failed status read to be retried without changing files", async () => {
    registry.set(query, AsyncResult.failure(Cause.fail(new Error("Could not read files"))));
    await mount();
    expect(renderer!.root.findByProps({ role: "alert" }).children).toContain(
      "Could not read files",
    );
    refreshed = AsyncResult.success(preview());
    await act(() => button("Check files").props.onClick());
    expect(toggle().props.checked).toBe(true);
    expect(state.adopt).not.toHaveBeenCalled();
  });
});
