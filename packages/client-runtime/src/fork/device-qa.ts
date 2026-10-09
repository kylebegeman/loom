import type { EnvironmentId } from "@t3tools/contracts";
import {
  DEVICE_QA_WS_METHODS as Q,
  type DeviceQaFlowRunStatus,
  type DeviceQaRun,
  type DeviceQaRunEvent,
  type DeviceQaStep,
} from "@t3tools/contracts/fork";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { runStream } from "../rpc/client.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  runStreamInEnvironment,
} from "../state/runtime.ts";

export interface DeviceQaFlowView {
  readonly path: string;
  readonly status: DeviceQaFlowRunStatus;
  readonly steps: ReadonlyArray<DeviceQaStep>;
}

/** A run as its event stream has described it so far. */
export interface DeviceQaRunView {
  readonly flows: ReadonlyArray<DeviceQaFlowView>;
  /** The final record, once `runFinished` arrived. */
  readonly finished: DeviceQaRun | null;
}

export const EMPTY_DEVICE_QA_RUN_VIEW: DeviceQaRunView = { flows: [], finished: null };

const updateFlow = (
  view: DeviceQaRunView,
  path: string,
  update: (flow: DeviceQaFlowView) => DeviceQaFlowView,
): DeviceQaRunView => {
  const index = view.flows.findIndex((flow) => flow.path === path);
  if (index === -1)
    return {
      ...view,
      flows: [...view.flows, update({ path, status: "running", steps: [] })],
    };
  const flows = view.flows.slice();
  flows[index] = update(flows[index]!);
  return { ...view, flows };
};

/** Folds one `runEvents` event; the server replays past events first, so this starts empty. */
export function applyDeviceQaRunEvent(
  view: DeviceQaRunView,
  event: DeviceQaRunEvent,
): DeviceQaRunView {
  switch (event._tag) {
    case "flowStarted":
      return updateFlow(view, event.path, (flow) => ({ ...flow, status: "running" }));
    case "step":
      return updateFlow(view, event.path, (flow) => ({
        ...flow,
        steps: [...flow.steps, event.step],
      }));
    case "flowFinished":
      return updateFlow(view, event.path, (flow) => ({ ...flow, status: event.status }));
    case "runFinished": {
      // Flows the run never reached are listed with their final status.
      const seen = new Set(view.flows.map((flow) => flow.path));
      const final = new Map(event.run.flows.map((flow) => [flow.path, flow.status]));
      return {
        flows: [
          ...view.flows.map((flow) => ({ ...flow, status: final.get(flow.path) ?? flow.status })),
          ...event.run.flows
            .filter((flow) => !seen.has(flow.path))
            .map((flow) => ({ path: flow.path, status: flow.status, steps: [] })),
        ],
        finished: event.run,
      };
    }
  }
}

/** Device QA flows, runs, evidence and settings for one environment. */
export function createDeviceQaAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  /** Replays the run's events, follows it live and ends with the run. */
  const runViewFamily = Atom.family((key: string) => {
    const [environmentId, runId] = JSON.parse(key) as [EnvironmentId, string];
    return runtime
      .atom(
        runStreamInEnvironment(environmentId, runStream(Q.runEvents, { runId })).pipe(
          Stream.scan(() => EMPTY_DEVICE_QA_RUN_VIEW, applyDeviceQaRunEvent),
        ),
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`loom:device-qa-run-view:${key}`));
  });
  return {
    runView: (target: { readonly environmentId: EnvironmentId; readonly runId: string }) =>
      runViewFamily(JSON.stringify([target.environmentId, target.runId])),
    status: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:device-qa-status",
      tag: Q.status,
      staleTimeMs: 0,
    }),
    flows: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:device-qa-flows",
      tag: Q.listFlows,
      staleTimeMs: 0,
    }),
    flowText: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:device-qa-flow-text",
      tag: Q.readFlow,
      staleTimeMs: 0,
    }),
    run: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:device-qa-run",
      tag: Q.getRun,
      staleTimeMs: 0,
    }),
    settings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "loom:device-qa-settings",
      tag: Q.getSettings,
      staleTimeMs: 0,
    }),
    runs: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:device-qa-runs",
      tag: Q.watchRuns,
    }),
    evidence: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "loom:device-qa-evidence",
      tag: Q.watchEvidence,
    }),
    runFlows: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-run-flows",
      tag: Q.runFlows,
    }),
    cancelRun: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-cancel-run",
      tag: Q.cancelRun,
    }),
    capture: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-capture",
      tag: Q.capture,
    }),
    stopRecording: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-stop-recording",
      tag: Q.stopRecording,
    }),
    deleteEvidence: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-delete-evidence",
      tag: Q.deleteEvidence,
    }),
    deleteAllEvidence: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-delete-all-evidence",
      tag: Q.deleteAllEvidence,
    }),
    installApp: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-install-app",
      tag: Q.installApp,
    }),
    statusBar: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-status-bar",
      tag: Q.statusBar,
    }),
    disableTelemetry: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-disable-telemetry",
      tag: Q.disableArgentTelemetry,
    }),
    updateSettings: createEnvironmentRpcCommand(runtime, {
      label: "loom:device-qa-settings-update",
      tag: Q.updateSettings,
    }),
  };
}
