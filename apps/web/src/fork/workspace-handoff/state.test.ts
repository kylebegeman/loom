import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { WorkspaceHandoffOffer, WorkspaceHandoffReceipt } from "@t3tools/contracts/fork";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createMemoryStorage } from "~/lib/storage";

vi.mock("~/lib/utils", () => ({ randomUUID: () => "new-request-1234" }));
vi.mock("~/connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/fork", () => ({ createWorkspaceHandoffAtoms: () => ({}) }));

const source = {
  environmentId: EnvironmentId.make("source-host"),
  threadId: ThreadId.make("source-thread"),
};
const offer = Schema.decodeUnknownSync(WorkspaceHandoffOffer)({
  requestId: "request-1234",
  sourceEnvironmentId: "source-host",
  sourceThreadId: "source-thread",
  title: "Saved work",
  remoteUrl: "https://example.test/repo.git",
  repositoryKey: "example.test/repo",
  branch: "main",
  upstreamBranch: "main",
  headSha: "a".repeat(40),
  stateKey: "b".repeat(64),
  context: "user:\nContinue work",
  contextTruncated: false,
});
const receipt = Schema.decodeUnknownSync(WorkspaceHandoffReceipt)({
  requestId: offer.requestId,
  stateKey: offer.stateKey,
  destinationEnvironmentId: "destination-host",
  projectId: "destination-project",
  threadId: "destination-thread",
  worktreePath: "/worktrees/handoff",
  branch: "handoff/request-1234",
  headSha: offer.headSha,
});
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("sessionStorage", createMemoryStorage());
});

afterEach(() => vi.unstubAllGlobals());

it("restores accepted steps after reload without retaining an in-progress phase", async () => {
  const state = await import("./state");
  state.openWorkspaceHandoff(source);
  state.useWorkspaceHandoff.setState({
    requestId: offer.requestId,
    destinationKey: "destination-host/destination-project",
    offer,
    receipt,
    sourceResult: { sourceSettled: true, reason: "settled" },
    phase: "continuing",
  });
  vi.resetModules();
  const reloaded = await import("./state");
  expect(reloaded.useWorkspaceHandoff.getState()).toMatchObject({
    source,
    offer,
    receipt,
    sourceResult: { sourceSettled: true, reason: "settled" },
    phase: "idle",
    open: false,
  });
  reloaded.openWorkspaceHandoff(source);
  expect(reloaded.useWorkspaceHandoff.getState().requestId).toBe(offer.requestId);
});

it("keeps an active attempt when another thread requests handoff", async () => {
  const state = await import("./state");
  state.openWorkspaceHandoff(source);
  const requestId = state.useWorkspaceHandoff.getState().requestId;
  state.useWorkspaceHandoff.setState({ phase: "preparing" });
  state.openWorkspaceHandoff({ ...source, threadId: ThreadId.make("other-thread") });
  expect(state.useWorkspaceHandoff.getState()).toMatchObject({
    source,
    requestId,
    phase: "preparing",
  });
});

it("ignores malformed saved handoffs", async () => {
  sessionStorage.setItem(
    "loom-workspace-handoff",
    JSON.stringify({ version: 1, state: { source: "invalid", offer: {} } }),
  );
  const state = await import("./state");
  expect(state.useWorkspaceHandoff.getState().source).toBeNull();
  state.openWorkspaceHandoff(source);
  expect(state.useWorkspaceHandoff.getState().source).toEqual(source);
});

it("reopens a completed handoff without creating a second continuation", async () => {
  const state = await import("./state");
  state.openWorkspaceHandoff(source);
  state.useWorkspaceHandoff.setState({
    requestId: offer.requestId,
    destinationKey: "destination-host/destination-project",
    offer,
    receipt,
    sourceResult: { sourceSettled: true, reason: "settled" },
    phase: "done",
    open: false,
  });
  state.openWorkspaceHandoff(source);
  expect(state.useWorkspaceHandoff.getState()).toMatchObject({
    requestId: offer.requestId,
    receipt,
    phase: "done",
    open: true,
  });
});
