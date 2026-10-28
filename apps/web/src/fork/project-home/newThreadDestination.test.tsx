import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS, EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";

const state = vi.hoisted(() => {
  const router = {
    state: {
      location: { href: "/projects/shared-project" },
      matches: [{ params: {} as Record<string, string> }],
    },
    navigate: vi.fn(async (request: { params: { draftId: string } }) => {
      router.state.location.href = `/draft/${request.params.draftId}`;
      router.state.matches = [{ params: request.params }];
    }),
  };
  return { router, configs: new Map() };
});
vi.mock("@effect/atom-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@effect/atom-react")>()),
  useAtomValue: () => state.configs,
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => state.router, useParams: () => null }));
vi.mock("~/hooks/useSettings", () => ({ getClientSettings: () => ({}) }));
vi.mock("~/state/server", () => ({ environmentServerConfigsAtom: {} }));
vi.mock("~/state/presentation", () => ({
  environmentPresentations: { presentationAtom: () => ({}) },
  environmentSummaries: { connectedEnvironmentIdsAtom: {} },
}));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => state.configs } }));
vi.mock("~/state/entities", () => {
  const projects = [
    { id: "prepared-checkout", environmentId: "pi", workspaceRoot: "/ssd/project" },
  ];
  return {
    readProjects: () => projects,
    // The hook rechecks the project before opening a draft; it still exists here.
    readProject: (ref: { environmentId: string; projectId: string }) =>
      projects.find(
        (project) => project.id === ref.projectId && project.environmentId === ref.environmentId,
      ) ?? null,
    readThreadShell: () => null,
    readThreadShells: () => [],
  };
});
vi.mock("~/state/olderSettledShelf", () => ({ readUnloadedThreadCount: () => 0 }));
vi.mock("@t3tools/client-runtime/state/project-grouping", () => ({
  deriveLogicalProjectKeyFromSettings: () => "shared-project",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("~/components/Sidebar.logic", () => ({ orderItemsByPreferredIds: () => [] }));
vi.mock("~/lib/t3ProjectFileDefaults", () => ({ readT3ProjectFile: async () => null }));
vi.mock("~/uiStateStore", () => ({
  useUiStateStore: () => [],
  legacyProjectCwdPreferenceKey: () => "",
}));

const destination = scopeProjectRef(EnvironmentId.make("pi"), ProjectId.make("prepared-checkout"));
const previousComputer = scopeProjectRef(EnvironmentId.make("mac"), ProjectId.make("mac-checkout"));
const reusableId = DraftId.make("existing-draft");
let renderer: ReactTestRenderer | null = null;
let openThread: ReturnType<typeof useNewThreadHandler>;
function Handler() {
  const handler = useNewThreadHandler();
  useLayoutEffect(() => {
    openThread = handler;
  });
  return null;
}
function seedAutomaticDraft(projectRef = previousComputer) {
  useComposerDraftStore
    .getState()
    .setLogicalProjectDraftThreadId("shared-project", projectRef, reusableId, {
      threadId: ThreadId.make("existing-thread"),
      environmentSelection: "auto",
      loadBalancedEnvironmentId: projectRef.environmentId,
      branch: "stale-branch",
      worktreePath: "/stale/worktree",
      envMode: "worktree",
    });
}
function viewDraft() {
  state.router.state.location.href = `/draft/${reusableId}`;
  state.router.state.matches = [{ params: { draftId: reusableId } }];
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useComposerDraftStore.setState({
    draftsByThreadKey: {},
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
    stickyModelSelectionByProvider: {},
    stickyOptionsByModelByProvider: {},
    stickyActiveProvider: null,
  });
  state.configs = new Map([
    ["pi", { settings: { ...DEFAULT_SERVER_SETTINGS, defaultThreadEnvMode: "local" } }],
  ]);
  state.router.state.location.href = "/projects/shared-project";
  state.router.state.matches = [{ params: {} }];
  state.router.navigate.mockClear();
  await act(async () => {
    renderer = create(<Handler />);
  });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("explicit Project home computer selection", () => {
  it.each(["fresh", "stored", "already-open", "unmapped-current"] as const)(
    "pins the exact checkout and clears old balancing when opening a %s draft",
    async (kind) => {
      if (kind !== "fresh") seedAutomaticDraft();
      if (kind === "already-open" || kind === "unmapped-current") viewDraft();
      if (kind === "unmapped-current") {
        useComposerDraftStore.setState({ logicalProjectDraftThreadKeyByLogicalProjectKey: {} });
      }
      const opened = await openThread(destination, { environmentSelection: "manual" });
      expect(opened).not.toBeNull();
      const draft = useComposerDraftStore.getState().getDraftSession(opened!.draftId);
      expect(draft).toMatchObject({
        environmentId: destination.environmentId,
        projectId: destination.projectId,
        environmentSelection: "manual",
        loadBalancedEnvironmentId: null,
      });
      if (kind !== "fresh") expect(opened?.draftId).toBe(reusableId);
      if (kind === "stored") {
        expect(draft).toMatchObject({ branch: null, worktreePath: null, envMode: "local" });
      }
    },
  );
  it("clears balancing even when reusing the same physical checkout", async () => {
    seedAutomaticDraft(destination);
    viewDraft();
    const opened = await openThread(destination, { environmentSelection: "manual" });
    expect(useComposerDraftStore.getState().getDraftSession(opened!.draftId)).toMatchObject({
      environmentId: destination.environmentId,
      projectId: destination.projectId,
      environmentSelection: "manual",
      loadBalancedEnvironmentId: null,
    });
  });
  it("pins the chosen checkout when a concurrent invocation creates the reusable draft", async () => {
    const pending = openThread(destination, { environmentSelection: "manual" });
    seedAutomaticDraft();
    const opened = await pending;
    expect(opened?.draftId).toBe(reusableId);
    expect(useComposerDraftStore.getState().getDraftSession(reusableId)).toMatchObject({
      environmentId: destination.environmentId,
      projectId: destination.projectId,
      environmentSelection: "manual",
      loadBalancedEnvironmentId: null,
    });
  });
  it.each([false, true])(
    "keeps ordinary new-thread routing unchanged with existing draft %s",
    async (existing) => {
      if (existing) seedAutomaticDraft(destination);
      const opened = await openThread(destination);
      const draft = useComposerDraftStore.getState().getDraftSession(opened!.draftId);
      expect(draft?.environmentSelection).toBe(existing ? "auto" : undefined);
      expect(draft?.loadBalancedEnvironmentId).toBe(
        existing ? destination.environmentId : undefined,
      );
    },
  );
});
