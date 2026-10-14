import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { ProjectCheckoutPreview } from "@t3tools/contracts/fork";
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
  permissions: null as Atom.Writable<boolean> | null,
  adoptCommand: { permissionAtom: () => state.permissions! },
  retentionCommand: { permissionAtom: () => state.permissions! },
  connected: true,
  supported: true,
  readable: true,
}));
vi.mock("./state", () => ({
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
    label: "Work computer",
    connection: { phase: state.connected ? "connected" : "disconnected" },
    serverConfig: {
      environment: {
        capabilities: {
          loom: { features: state.supported ? ["project-checkout-management"] : [] },
        },
      },
    },
  }),
}));
vi.mock("~/state/session", () => ({ useEnvironmentScope: () => state.readable }));
vi.mock("@t3tools/client-runtime/fork", () => ({
  supportsLoomFeature: () => state.supported,
}));
vi.mock("~/components/settings/settingsLayout", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingsRow: ({
    title,
    description,
    status,
    control,
    children,
  }: {
    title: ReactNode;
    description?: ReactNode;
    status?: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <article>
      <h3>{title}</h3>
      <p>{description}</p>
      <p>{status}</p>
      {control}
      {children}
    </article>
  ),
}));
vi.mock("~/components/ui/button", () => ({ Button: "button" }));
vi.mock("~/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? children : null),
  DialogPopup: "dialog",
  DialogHeader: "header",
  DialogTitle: "h2",
  DialogDescription: "p",
  DialogPanel: "section",
  DialogFooter: "footer",
}));
vi.mock("~/components/ui/select", () => ({
  Select: "select",
  SelectTrigger: "button",
  SelectValue: "span",
  SelectPopup: "div",
  SelectItem: "option",
}));
vi.mock("~/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TooltipPopup: () => null,
}));

import { ProjectCheckoutSettings } from "./ProjectCheckoutSettings";

const environmentId = EnvironmentId.make("computer");
const projectId = ProjectId.make("project-a");
const otherProjectId = ProjectId.make("project-b");
const project = (id = projectId) => ({ id, environmentId, workspaceRoot: `/work/${id}` });
const preview = (patch: Partial<ProjectCheckoutPreview> = {}): ProjectCheckoutPreview => ({
  projectId,
  workspaceRoot: "/canonical/project-a",
  state: "external",
  ownershipSource: null,
  retention: "inherit",
  head: "e40231972736e4d4386e5d6ba96eeb7d059fa55d",
  branch: "main",
  localFiles: { trackedChanges: 2, untrackedFiles: 1, ignoredFiles: 3, truncated: false },
  blockers: ["Local changes keep this folder protected."],
  reviewToken: "fresh-review",
  repositoryIdentity: null,
  ...patch,
});

let registry: AtomRegistry.AtomRegistry;
let queries: Map<ProjectId, Atom.Writable<PreviewResult>>;
let renderer: ReactTestRenderer | undefined;
let refreshed: PreviewResult | undefined;
const queryFor = (id = projectId) => queries.get(id)!;
function button(label: string) {
  return renderer!.root.findAllByType("button").find((node) => node.children.includes(label))!;
}
async function mount(id = projectId) {
  await act(() => {
    renderer = create(
      <RegistryContext.Provider value={registry}>
        <ProjectCheckoutSettings projects={[project(id)]} />
      </RegistryContext.Provider>,
    );
  });
}
async function openReview() {
  await act(() => button("Review storage").props.onClick());
}
function changeRetention(value: ProjectCheckoutPreview["retention"]) {
  renderer!.root
    .findByProps({ "aria-label": "Project folder retention" })
    .parent!.props.onValueChange(value);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.adopt.mockReset();
  state.setRetention.mockReset();
  state.query.mockReset();
  state.connected = true;
  state.supported = true;
  state.readable = true;
  registry = AtomRegistry.make();
  state.permissions = Atom.make(true);
  queries = new Map(
    [projectId, otherProjectId].map((id) => [
      id,
      Atom.make<PreviewResult>(
        AsyncResult.success(preview({ projectId: id, workspaceRoot: `/canonical/${id}` })),
      ),
    ]),
  );
  state.query.mockImplementation(({ input }: { input: { projectId: ProjectId } }) =>
    queryFor(input.projectId),
  );
  state.adopt.mockResolvedValue(
    AsyncResult.success(
      preview({ state: "managed", ownershipSource: "adopted", retention: "keep" }),
    ),
  );
  state.setRetention.mockResolvedValue(
    AsyncResult.success(preview({ state: "managed", ownershipSource: "clone", retention: "keep" })),
  );
  refreshed = undefined;
  vi.spyOn(registry, "refresh").mockImplementation((atom) => {
    if (refreshed) registry.set(atom as Atom.Writable<PreviewResult>, refreshed);
  });
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  registry.dispose();
  vi.unstubAllGlobals();
});

describe("reviewed project checkout storage", () => {
  it("reviews without adopting and cancellation leaves project ownership unchanged", async () => {
    await mount();
    await openReview();
    expect(registry.refresh).toHaveBeenCalledWith(queryFor());
    expect(state.adopt).not.toHaveBeenCalled();
    expect(state.setRetention).not.toHaveBeenCalled();
    const oldConfirm = button("Manage this folder").props.onClick;
    await act(() => button("Cancel").props.onClick());
    await act(() => oldConfirm());
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
    expect(state.adopt).not.toHaveBeenCalled();
  });

  it("confirms only the selected folder with the freshly reviewed policy and token", async () => {
    await mount();
    refreshed = AsyncResult.success(
      preview({ reviewToken: "review-on-open", workspaceRoot: "/canonical/updated-project" }),
    );
    await openReview();
    await act(() => changeRetention("release-on-settle"));
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "review-on-open", retention: "release-on-settle" },
    });
    expect(state.setRetention).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
  });

  it("requires refreshed details after a stale review rather than automatically retrying a mutation", async () => {
    await mount();
    await openReview();
    state.adopt.mockResolvedValueOnce(
      AsyncResult.failure(
        Cause.fail(Object.assign(new Error("Stale review"), { reason: "stale-review" })),
      ),
    );
    refreshed = AsyncResult.success(
      preview({
        reviewToken: "new-review",
        localFiles: { trackedChanges: 3, untrackedFiles: 2, ignoredFiles: 0, truncated: false },
      }),
    );
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt).toHaveBeenCalledOnce();
    expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "folder changed",
    );
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt.mock.calls[1]![0].input.reviewToken).toBe("new-review");
  });

  it("does not save an old review while the refresh is pending", async () => {
    await mount();
    refreshed = AsyncResult.waiting(AsyncResult.success(preview()));
    await openReview();
    expect(button("Manage this folder").props.disabled).toBe(true);
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt).not.toHaveBeenCalled();
  });

  it("refuses a stale confirmation handler after switching projects", async () => {
    await mount();
    await openReview();
    const oldConfirm = button("Manage this folder").props.onClick;
    await act(() =>
      renderer!.update(
        <RegistryContext.Provider value={registry}>
          <ProjectCheckoutSettings projects={[project(otherProjectId)]} />
        </RegistryContext.Provider>,
      ),
    );
    await act(() => oldConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
    expect(renderer!.root.findAllByType("dialog")).toHaveLength(0);
  });

  it("refuses a token superseded by an intervening preview", async () => {
    await mount();
    await openReview();
    const oldConfirm = button("Manage this folder").props.onClick;
    await act(() =>
      registry.set(queryFor(), AsyncResult.success(preview({ reviewToken: "replacement" }))),
    );
    await act(() => oldConfirm());
    expect(state.adopt).not.toHaveBeenCalled();
  });

  it("changes a managed clone back to Keep using retention rather than adoption", async () => {
    registry.set(
      queryFor(),
      AsyncResult.success(
        preview({ state: "managed", ownershipSource: "clone", retention: "release-on-settle" }),
      ),
    );
    await mount();
    await openReview();
    await act(() => changeRetention("keep"));
    await act(() => button("Save storage choice").props.onClick());
    expect(state.adopt).not.toHaveBeenCalled();
    expect(state.setRetention).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "fresh-review", retention: "keep" },
    });
  });

  it("restores a released primary folder only after an explicit Keep confirmation", async () => {
    registry.set(
      queryFor(),
      AsyncResult.success(
        preview({ state: "released", ownershipSource: "adopted", retention: "release-on-settle" }),
      ),
    );
    await mount();
    await openReview();
    expect(state.setRetention).not.toHaveBeenCalled();
    await act(() => changeRetention("keep"));
    await act(() => button("Restore and keep folder").props.onClick());
    expect(state.setRetention).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { projectId, reviewToken: "fresh-review", retention: "keep" },
    });
  });

  it("keeps failed review requests retryable without adopting a folder", async () => {
    registry.set(queryFor(), AsyncResult.failure(Cause.fail(new Error("Offline review"))));
    await mount();
    refreshed = AsyncResult.success(preview({ reviewToken: "retry-review" }));
    await act(() => button("Retry review").props.onClick());
    expect(state.adopt).not.toHaveBeenCalled();
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt.mock.calls[0]![0].input.reviewToken).toBe("retry-review");
  });

  it("keeps blocked unsafe folders and permission-restricted connections from mutating", async () => {
    registry.set(
      queryFor(),
      AsyncResult.success(
        preview({
          state: "blocked",
          reviewToken: null,
          blockers: ["This folder is not a supported checkout."],
        }),
      ),
    );
    await mount();
    await openReview();
    expect(button("Manage this folder").props.disabled).toBe(true);
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt).not.toHaveBeenCalled();
    await act(() => registry.set(queryFor(), AsyncResult.success(preview())));
    await act(() => registry.set(state.permissions!, false));
    expect(button("Manage this folder").props.disabled).toBe(true);
    await act(() => button("Manage this folder").props.onClick());
    expect(state.adopt).not.toHaveBeenCalled();
  });

  it.each(["unsupported", "disconnected", "unreadable"] as const)(
    "does not call checkout RPCs for an %s computer",
    async (condition) => {
      if (condition === "unsupported") state.supported = false;
      if (condition === "disconnected") state.connected = false;
      if (condition === "unreadable") state.readable = false;
      await mount();
      expect(state.query).not.toHaveBeenCalled();
      expect(renderer!.root.findAllByType("button")).toHaveLength(0);
    },
  );
});
