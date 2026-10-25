import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  authorityId: "library" as string | null,
  connected: true,
  environments: [] as unknown[],
  lookup: { run: vi.fn() },
  copies: { run: vi.fn() },
  binding: { run: vi.fn() },
  shell: vi.fn(),
  open: vi.fn(),
}));
vi.mock("./state", () => ({
  projectLibrary: {
    lookupThread: state.lookup,
    copies: state.copies,
    threadBinding: state.binding,
  },
  useLibraryAuthority: () => ({ authorityId: state.authorityId, connected: state.connected }),
}));
vi.mock("~/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: (query: { run: unknown }) => query.run,
}));
vi.mock("~/state/entities", () => ({ readThreadShell: state.shell }));
vi.mock("~/state/environments", () => ({
  useEnvironments: () => ({ environments: state.environments }),
}));
vi.mock("~/hooks/useStableCallback", () => ({
  useStableCallback: (callback: unknown) => callback,
}));
vi.mock("~/uiStateStore", () => ({ useUiStateStore: () => null }));
vi.mock("@tanstack/react-router", () => ({ useParams: () => state.params }));
vi.mock("./actions", () => ({ openLibraryAction: state.open }));
import { useLibraryNewConversation } from "./useLibraryNewConversation";

const environmentId = EnvironmentId.make("source-computer");
const source = scopeThreadRef(environmentId, ThreadId.make("source-thread"));
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "source-model",
  options: [{ id: "reasoningEffort", value: "high" }],
};
const launchSettings = {
  modelSelection,
  runtimeMode: "auto" as const,
  interactionMode: "plan" as const,
};
const binding = {
  projectId: "source-project",
  environmentId,
  workingCopyId: "source-files",
  resourceIds: ["web"],
};
const defaults = { environmentId, workingCopyId: "source-files", resourceId: "web" };

beforeEach(() => {
  vi.clearAllMocks();
  state.authorityId = "library";
  state.connected = true;
  state.params = { projectId: "viewed-project" };
  vi.stubGlobal("window", { location: { pathname: "/library/viewed-project" } });
  state.environments = [
    {
      environmentId,
      connection: { phase: "connected" },
      serverConfig: { environment: { capabilities: { loomFeatures: ["project-library"] } } },
    },
  ];
  state.shell.mockReturnValue({ projectId: ProjectId.make("local-project"), ...launchSettings });
  state.binding.run.mockResolvedValue({ _tag: "Success", value: binding });
  state.lookup.run.mockResolvedValue({ _tag: "Success", value: null });
  state.copies.run.mockResolvedValue({ _tag: "Success", value: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe("sidebar source conversation", () => {
  it("uses the hovered thread instead of the viewed Library project, without reading history", async () => {
    expect(await useLibraryNewConversation()(source, { inheritSettings: true })).toBe(true);
    expect(state.binding.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: source.threadId },
    });
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      {
        ...defaults,
        ...launchSettings,
      },
      { suggest: false },
    );
    expect(state.lookup.run).not.toHaveBeenCalled();
    expect(state.copies.run).not.toHaveBeenCalled();
  });

  it("preserves a source binding that selects multiple repositories", async () => {
    state.binding.run.mockResolvedValue({
      _tag: "Success",
      value: { ...binding, resourceIds: ["web", "api"] },
    });
    await useLibraryNewConversation()(source, { inheritSettings: true });
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      {
        environmentId,
        workingCopyId: "source-files",
        resourceIds: ["web", "api"],
        ...launchSettings,
      },
      { suggest: false },
    );
  });

  it("preserves the regular Library form without source defaults", async () => {
    await useLibraryNewConversation()();
    expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation", "viewed-project");
    expect(state.binding.run).not.toHaveBeenCalled();
    expect(state.shell).not.toHaveBeenCalled();
  });

  it("suggests the current thread's project for an ordinary New thread instead of choosing it", async () => {
    await useLibraryNewConversation()(source);
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      defaults,
      { suggest: true },
    );
  });

  it("carries launch settings when only a saved binding is available", async () => {
    state.environments = [];
    state.lookup.run.mockResolvedValue({ _tag: "Success", value: binding });
    await useLibraryNewConversation()(source, { inheritSettings: true });
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      {
        ...defaults,
        ...launchSettings,
      },
      { suggest: false },
    );
    expect(state.binding.run).not.toHaveBeenCalled();
  });

  it("recovers a legacy local project's registered files before applying settings", async () => {
    state.binding.run.mockResolvedValue({ _tag: "Success", value: null });
    state.copies.run.mockResolvedValue({
      _tag: "Success",
      value: [
        {
          id: "source-files",
          projectId: "source-project",
          environmentId,
          rootLocalProjectId: "local-project",
          repositories: [],
          state: "ready",
        },
      ],
    });
    await useLibraryNewConversation()(source, { inheritSettings: true });
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      {
        environmentId,
        workingCopyId: "source-files",
        ...launchSettings,
      },
      { suggest: false },
    );
  });

  it("uses the existing local new-thread flow when no Library is configured", async () => {
    state.authorityId = null;
    expect(await useLibraryNewConversation()(source, { inheritSettings: true })).toBe(false);
    expect(state.open).not.toHaveBeenCalled();
    expect(state.binding.run).not.toHaveBeenCalled();
  });

  it("keeps a registered source checkout in the Library flow", async () => {
    state.shell.mockReturnValue({
      projectId: ProjectId.make("local-project"),
      ...launchSettings,
      branch: "feature/current-work",
      worktreePath: "/worktrees/current-work",
    });
    expect(await useLibraryNewConversation()(source, { inheritSettings: true })).toBe(true);
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      { ...defaults, ...launchSettings },
      { suggest: false },
    );
    expect(state.binding.run).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      input: { threadId: source.threadId },
    });
  });

  it("uses the existing local flow for a folder with no Library project", async () => {
    state.binding.run.mockResolvedValue({ _tag: "Success", value: null });
    expect(await useLibraryNewConversation()(source, { inheritSettings: true })).toBe(false);
    expect(state.open).not.toHaveBeenCalled();
  });

  it("opens the blank form without carrying settings into an unknown project", async () => {
    state.binding.run.mockResolvedValue({ _tag: "Failure" });
    await useLibraryNewConversation()(source, { inheritSettings: true });
    expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation");
  });
});

it("recovers an unbound local thread's project from the host while the Library is offline", async () => {
  state.connected = false;
  state.binding.run.mockResolvedValue({ _tag: "Success", value: null });
  state.copies.run.mockResolvedValue({
    _tag: "Success",
    value: [
      {
        id: "source-files",
        projectId: "source-project",
        environmentId,
        rootLocalProjectId: "local-project",
        repositories: [],
        state: "ready",
      },
    ],
  });
  expect(await useLibraryNewConversation()(source)).toBe(true);
  expect(state.lookup.run).not.toHaveBeenCalled();
  expect(state.copies.run).toHaveBeenCalledExactlyOnceWith({ environmentId, input: {} });
  expect(state.open).toHaveBeenCalledWith(
    "new-conversation",
    "source-project",
    { environmentId, workingCopyId: "source-files" },
    { suggest: true },
  );
});
