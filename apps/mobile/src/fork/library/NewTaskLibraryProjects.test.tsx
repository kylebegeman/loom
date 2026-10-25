// @vitest-environment jsdom
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { LibraryProject } from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { makeThreadShellFixture } from "../../test-fixtures";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  dispatch: vi.fn(),
  alert: vi.fn(),
  binding: vi.fn(),
  lookup: vi.fn(),
  copies: vi.fn(),
  project: vi.fn(),
  readRefs: vi.fn(),
  switchRef: vi.fn(),
  create: vi.fn(),
  online: true,
  projects: [] as LibraryProject[],
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: state.navigate,
    getParent: () => ({ dispatch: state.dispatch }),
  }),
  StackActions: { replace: (name: string, params: unknown) => ({ name, params }) },
}));
vi.mock("./libraryState", () => ({
  useLibraryAuthority: () => ({ environmentId: "library", computers: [] }),
  library: {
    projects: () => "projects",
    threadIndex: () => "thread-index",
    threadBinding: state.binding,
    lookupThread: state.lookup,
    copies: state.copies,
    project: state.project,
  },
}));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({
    environments: [
      {
        environmentId: "computer",
        label: "Computer",
        entry: { enabled: true },
        connection: { phase: state.online ? "connected" : "offline" },
        serverConfig: { environment: { capabilities: { loomFeatures: ["project-library"] } } },
      },
    ],
  }),
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [{ environmentId: "computer", id: "local-project", workspaceRoot: "/repo" }],
  useServerConfigs: () => new Map(),
  useThreadShells: () => [],
}));
vi.mock("../../state/session", () => ({ useEnvironmentsWithScope: () => new Set() }));
vi.mock("../../state/use-composer-drafts", () => ({
  useStickyComposerModelSelection: () => null,
}));
vi.mock("../../components/ui/IconButton", () => ({ IconButton: () => null }));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (query: unknown) => ({
    data: query === "projects" ? state.projects : [],
    error: null,
  }),
}));
vi.mock("../../state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (query: unknown) => query,
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: unknown) => command,
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { readRefs: state.readRefs, switchRef: state.switchRef },
}));
vi.mock("../../state/threads", () => ({ threadEnvironment: { create: state.create } }));
vi.mock("../../lib/uuid", () => ({ uuidv4: () => crypto.randomUUID() }));
vi.mock("../../components/ui/Dialog", () => ({ alert: state.alert }));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("../../components/ui/NavigationRow", () => ({
  NavigationRow: ({ title, onPress }: { title: string; onPress: () => void }) => (
    <button onClick={onPress}>{title}</button>
  ),
}));

import {
  NewTaskLibraryProjectChoices,
  useNewTaskFromSource,
  useNewTaskLibraryProjects,
} from "./NewTaskLibraryProjects";

const source = makeThreadShellFixture({
  id: ThreadId.make("source-thread"),
  environmentId: EnvironmentId.make("computer"),
  projectId: ProjectId.make("local-project"),
  branch: null,
  worktreePath: null,
  modelSelection: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "custom-model",
    options: [
      { id: "reasoningEffort", value: "max" },
      { id: "serviceTier", value: "priority" },
    ],
  },
  runtimeMode: "approval-required",
  interactionMode: "plan",
  itemCount: 42,
});
const project: LibraryProject = {
  id: "library-project",
  title: "Project",
  brief: "",
  revision: 1,
  archived: false,
  createdAt: "2026-10-21T00:00:00Z",
  updatedAt: "2026-10-21T00:00:00Z",
  resources: ["app", "server"].map((id) => ({
    id,
    title: id,
    relativePath: id,
    remoteUrl: null,
    defaultBranch: null,
  })),
};
const binding = {
  projectId: project.id,
  environmentId: source.environmentId,
  workingCopyId: "source-files",
  resourceIds: ["app"],
};
const settings = {
  modelSelection: source.modelSelection,
  runtimeMode: source.runtimeMode,
  interactionMode: source.interactionMode,
};
let root: Root;
let container: HTMLDivElement;
let launch: ReturnType<typeof useNewTaskFromSource>;
function Probe() {
  const action = useNewTaskFromSource();
  useEffect(() => {
    launch = action;
  }, [action]);
  return null;
}
async function mount() {
  await act(() => root.render(<Probe />));
}
function expectFreshConversation(branch: string | null, worktreePath: string | null) {
  expect(state.create).toHaveBeenCalledExactlyOnceWith({
    environmentId: source.environmentId,
    input: {
      commandId: expect.any(String),
      threadId: expect.any(String),
      projectId: source.projectId,
      title: "New conversation",
      ...settings,
      branch,
      worktreePath,
    },
  });
  const threadId = state.create.mock.calls[0]![0].input.threadId;
  expect(threadId).not.toBe(source.id);
  expect(state.navigate).toHaveBeenCalledExactlyOnceWith("Thread", {
    environmentId: source.environmentId,
    threadId,
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state.online = true;
  state.binding.mockResolvedValue(AsyncResult.success(binding));
  state.lookup.mockResolvedValue(AsyncResult.success(null));
  state.copies.mockResolvedValue(AsyncResult.success([]));
  state.project.mockResolvedValue(AsyncResult.success(project));
  state.create.mockResolvedValue(AsyncResult.success({}));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("mobile source launch actions", () => {
  it("opens the editable Library form with source computer, files, scope and complete settings", async () => {
    await mount();
    await act(() => launch(source));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith("LibraryStart", {
      projectId: project.id,
      reuseEnvironmentId: source.environmentId,
      initialCopyId: binding.workingCopyId,
      initialResourceId: "app",
      sourceThreadId: source.id,
      launchSettings: settings,
    });
    expect(state.create).not.toHaveBeenCalled();
    expect(state.readRefs).not.toHaveBeenCalled();
  });

  it("ignores duplicate pending launches and allows another launch after Library navigation", async () => {
    const pending = Promise.withResolvers<AsyncResult.Success<typeof binding>>();
    state.binding.mockReturnValueOnce(pending.promise);
    await mount();
    await act(async () => {
      const first = launch(source);
      await launch(source);
      expect(state.binding).toHaveBeenCalledTimes(1);
      expect(state.navigate).not.toHaveBeenCalled();
      pending.resolve(AsyncResult.success(binding));
      await first;
    });
    await act(() => launch(source));
    expect(state.binding).toHaveBeenCalledTimes(2);
    expect(state.navigate).toHaveBeenCalledTimes(2);
    expect(state.navigate).toHaveBeenLastCalledWith(
      "LibraryStart",
      expect.objectContaining({ sourceThreadId: source.id }),
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each([new Error("Connection failed"), "Connection failed"])(
    "reports rejected source lookups and allows retry for %s",
    async (cause) => {
      state.binding.mockRejectedValueOnce(cause);
      await mount();
      await act(() => launch(source));
      expect(state.alert).toHaveBeenCalledExactlyOnceWith(
        "Could not start a conversation",
        cause instanceof Error
          ? cause.message
          : "The source settings could not be loaded. Try again.",
      );
      expect(state.navigate).not.toHaveBeenCalled();
      expect(state.create).not.toHaveBeenCalled();
      await act(() => launch(source));
      expect(state.binding).toHaveBeenCalledTimes(2);
      expect(state.navigate).toHaveBeenCalledExactlyOnceWith(
        "LibraryStart",
        expect.objectContaining({ sourceThreadId: source.id }),
      );
    },
  );

  it("recovers the saved Library binding when the source computer is offline", async () => {
    state.online = false;
    state.lookup.mockResolvedValue(AsyncResult.success(binding));
    await mount();
    await act(() => launch(source));
    expect(state.binding).not.toHaveBeenCalled();
    expect(state.lookup).toHaveBeenCalledWith({
      environmentId: "library",
      input: { sourceEnvironmentId: source.environmentId, threadId: source.id },
    });
    expect(state.navigate).toHaveBeenCalledWith(
      "LibraryStart",
      expect.objectContaining({
        reuseEnvironmentId: source.environmentId,
        initialCopyId: binding.workingCopyId,
        launchSettings: settings,
      }),
    );
    expect(state.create).not.toHaveBeenCalled();
  });

  it("starts fresh history for a branchless source outside the Library", async () => {
    state.binding.mockResolvedValue(AsyncResult.success(null));
    await mount();
    await act(() => launch(source));
    expectFreshConversation(null, null);
  });

  it("opens the Library form for a Library conversation that ran in its own worktree", async () => {
    await mount();
    await act(() => launch({ ...source, branch: "feature/source", worktreePath: "/lanes/source" }));
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith(
      "LibraryStart",
      expect.objectContaining({ sourceThreadId: source.id, initialCopyId: binding.workingCopyId }),
    );
    expect(state.create).not.toHaveBeenCalled();
    expect(state.switchRef).not.toHaveBeenCalled();
  });

  it.each(["feature/source", null])(
    "preserves an explicit worktree with branch %s outside the Library",
    async (branch) => {
      state.binding.mockResolvedValue(AsyncResult.success(null));
      await mount();
      await act(() => launch({ ...source, branch, worktreePath: "/lanes/source" }));
      expectFreshConversation(branch, "/lanes/source");
      expect(state.readRefs).not.toHaveBeenCalled();
      expect(state.switchRef).not.toHaveBeenCalled();
    },
  );

  it("reuses the occupied worktree for an explicit source branch before creating fresh history", async () => {
    state.binding.mockResolvedValue(AsyncResult.success(null));
    state.readRefs.mockResolvedValue(
      AsyncResult.success({
        refs: [
          {
            name: "feature/source",
            current: false,
            isDefault: false,
            worktreePath: "/lanes/source",
          },
        ],
        nextCursor: null,
        isAtRepositoryRoot: true,
      }),
    );
    await mount();
    await act(() => launch({ ...source, branch: "feature/source" }));
    expectFreshConversation("feature/source", "/lanes/source");
    expect(state.switchRef).not.toHaveBeenCalled();
  });

  it("does not create a conversation after a source branch checkout fails", async () => {
    state.binding.mockResolvedValue(AsyncResult.success(null));
    state.readRefs.mockResolvedValue(AsyncResult.success({ refs: [], nextCursor: null }));
    state.switchRef.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new Error("Checkout failed"))),
    );
    await mount();
    await act(() => launch({ ...source, branch: "feature/source" }));
    expect(state.alert).toHaveBeenCalledWith("Could not start a conversation", "Checkout failed");
    expect(state.create).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
    state.switchRef.mockResolvedValue(AsyncResult.success({ refName: "feature/source" }));
    await act(() => launch({ ...source, branch: "feature/source" }));
    expectFreshConversation("feature/source", null);
  });

  it("keeps ordinary New task project selection independent of source settings", async () => {
    await act(() =>
      root.render(
        <NewTaskLibraryProjectChoices choices={[{ project, start: null }]} error={null} />,
      ),
    );
    await act(() => container.querySelector("button")!.click());
    expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
      name: "LibraryStart",
      params: { projectId: project.id },
    });
    expect(state.binding).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe("mobile New task Library choices", () => {
  it("leads with the project in view and still offers every other project once", async () => {
    const other = (id: string, updatedAt: string) => ({ ...project, id, title: id, updatedAt });
    state.projects = [
      other("older", "2026-10-20T00:00:00Z"),
      project,
      other("newer", "2026-10-23T00:00:00Z"),
    ];
    let shown: ReturnType<typeof useNewTaskLibraryProjects> | null = null;
    function Choices(props: { readonly searchText: string }) {
      const result = useNewTaskLibraryProjects({ ...props, suggestedProjectId: project.id });
      useEffect(() => {
        shown = result;
      });
      return null;
    }
    const ids = (rows: ReturnType<typeof useNewTaskLibraryProjects>["choices"]) =>
      rows.map((row) => row.project.id);
    await act(() => root.render(<Choices searchText="" />));
    expect(ids(shown!.suggested)).toEqual([project.id]);
    expect(ids(shown!.choices)).toEqual(["newer", "older"]);
    // A search that leaves the project in view out leaves out its lead too.
    await act(() => root.render(<Choices searchText="newer" />));
    expect(ids(shown!.suggested)).toEqual([]);
    expect(ids(shown!.choices)).toEqual(["newer"]);
  });
});
