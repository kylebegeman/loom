import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";

const state = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  authorityId: "library" as string | null,
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
  useLibraryAuthority: () => ({ authorityId: state.authorityId }),
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
    expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation", "source-project", {
      ...defaults,
      ...launchSettings,
    });
    expect(state.lookup.run).not.toHaveBeenCalled();
    expect(state.copies.run).not.toHaveBeenCalled();
  });

  it("preserves the regular Library form without source defaults", async () => {
    await useLibraryNewConversation()();
    expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation", "viewed-project");
    expect(state.binding.run).not.toHaveBeenCalled();
    expect(state.shell).not.toHaveBeenCalled();
  });

  it("keeps ordinary New thread using project defaults", async () => {
    await useLibraryNewConversation()(source);
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "new-conversation",
      "source-project",
      defaults,
    );
  });

  it("carries launch settings when only a saved binding is available", async () => {
    state.environments = [];
    state.lookup.run.mockResolvedValue({ _tag: "Success", value: binding });
    await useLibraryNewConversation()(source, { inheritSettings: true });
    expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation", "source-project", {
      ...defaults,
      ...launchSettings,
    });
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
    expect(state.open).toHaveBeenCalledExactlyOnceWith("new-conversation", "source-project", {
      environmentId,
      workingCopyId: "source-files",
      ...launchSettings,
    });
  });

  it("uses the existing local new-thread flow when no Library is configured", async () => {
    state.authorityId = null;
    expect(await useLibraryNewConversation()(source, { inheritSettings: true })).toBe(false);
    expect(state.open).not.toHaveBeenCalled();
    expect(state.binding.run).not.toHaveBeenCalled();
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
