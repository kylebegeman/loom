import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ThreadId,
  RunId,
  CheckpointId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { AgentModelsMode, TurnModels } from "@t3tools/contracts/fork";
import { AsyncResult } from "effect/reactivity";
import { useRightPanelStore } from "~/rightPanelStore";
import { useAgentModelMarks } from "./agentModelMarks";

const mocks = vi.hoisted(() => ({
  route: null as { threadRef: ScopedThreadRef; isDraft: boolean } | null,
  features: ["model-preview-3d", "model-follow-agent"],
  mode: "offer" as AgentModelsMode,
  event: null as unknown,
  subscribe: vi.fn(() => ({ kind: "event" })),
  settings: vi.fn(() => ({ kind: "settings" })),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: { kind: string }) =>
    atom.kind === "event"
      ? mocks.event
      : { _tag: "Success", value: { agentModels: mocks.mode }, waiting: false },
}));
vi.mock("../routeThread", () => ({ useRouteThread: () => mocks.route }));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map(
      mocks.route
        ? [
            [
              mocks.route.threadRef.environmentId,
              { environment: { capabilities: { loomFeatures: mocks.features } } },
            ],
          ]
        : [],
    ),
}));
vi.mock("./state", () => ({
  models: { turnModelEvents: mocks.subscribe, settings: mocks.settings },
}));
import { AgentModelsHost } from "./AgentModelsHost";

const ref = scopeThreadRef(EnvironmentId.make("host-env"), ThreadId.make("host-thread"));
let renderer: ReactTestRenderer | null;
let serial = 0;
function event(): TurnModels {
  return {
    threadId: ref.threadId,
    runId: RunId.make(`run-${serial}`),
    checkpointId: CheckpointId.make(`cp-${serial}`),
    turn: serial,
    models: [{ path: "part.scad", format: "scad", reason: "written", via: null }],
    truncated: false,
  };
}
async function render() {
  await act(async () => {
    if (renderer) renderer.update(<AgentModelsHost />);
    else renderer = create(<AgentModelsHost />);
  });
}
beforeEach(() => {
  renderer = null;
  serial++;
  mocks.route = { threadRef: ref, isDraft: false };
  mocks.features = ["model-preview-3d", "model-follow-agent"];
  mocks.mode = "offer";
  mocks.event = AsyncResult.success(event());
  vi.clearAllMocks();
  useRightPanelStore.setState({
    byThreadKey: {},
    threadPanelVisibilityByThreadKey: {},
    userActionRevisionByThreadKey: {},
  });
  useAgentModelMarks.setState({ marks: {}, latest: {}, pickerTurn: {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
});

it("gates absent capabilities, older servers and unsent draft threads before creating subscriptions", async () => {
  mocks.features = ["model-preview-3d"];
  await render();
  expect(mocks.subscribe).not.toHaveBeenCalled();
  expect(mocks.settings).not.toHaveBeenCalled();
  mocks.features = ["model-preview-3d", "model-follow-agent"];
  mocks.route = { threadRef: ref, isDraft: true };
  await render();
  expect(mocks.subscribe).not.toHaveBeenCalled();
});
it("subscribes only to the active environment/thread and handles a checkpoint once for the session", async () => {
  mocks.mode = "open";
  await render();
  expect(mocks.subscribe).toHaveBeenCalledWith({
    environmentId: ref.environmentId,
    input: { threadId: ref.threadId, include: ["build123d"] },
  });
  expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(ref)]!.isOpen).toBe(true);
  useRightPanelStore.getState().closeAllSurfaces(ref);
  await render();
  expect(useRightPanelStore.getState().byThreadKey[scopedThreadKey(ref)]?.isOpen ?? false).toBe(
    false,
  );
});
it("stops following and clears dots when the environment setting becomes Do nothing", async () => {
  await render();
  const key = scopedThreadKey(ref);
  await act(async () => useAgentModelMarks.getState().mark(key, ["part.scad"], 2));
  mocks.mode = "off";
  mocks.subscribe.mockClear();
  await render();
  expect(mocks.subscribe).not.toHaveBeenCalled();
  expect(useAgentModelMarks.getState().marks[key]).toBeUndefined();
});
it("rejects the previous thread's late stream value after navigation", async () => {
  mocks.mode = "open";
  mocks.route = {
    threadRef: scopeThreadRef(EnvironmentId.make("second-host"), ThreadId.make("second-thread")),
    isDraft: false,
  };
  await render();
  expect(useRightPanelStore.getState().byThreadKey).toEqual({});
  expect(useAgentModelMarks.getState().latest).toEqual({});
});
