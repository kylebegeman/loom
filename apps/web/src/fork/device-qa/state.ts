import { createDeviceQaAtoms } from "@t3tools/client-runtime/fork";
import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type {
  DeviceQaActiveRecording,
  DeviceQaEvidence,
  DeviceQaLocalDevice,
  DeviceQaRun,
  DeviceQaTarget,
} from "@t3tools/contracts/fork";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { create } from "zustand";
import { toastManager } from "~/components/ui/toast";
import { connectionAtomRuntime } from "~/connection/runtime";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { deviceEnvironment } from "~/state/device";
import { forkPanelSurface } from "../panels/registry";
import { attachEvidence } from "./attach";

export const deviceQa = createDeviceQaAtoms(connectionAtomRuntime);

export const FEATURE = "device-qa";
export const PANEL_ID = "device-qa";

export async function runCommand<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await command.run(appAtomRegistry, input);
  if (result._tag === "Failure") throw Cause.squash(result.cause);
  return result.value;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);

export const sameTarget = (a: DeviceQaTarget, b: DeviceQaTarget) =>
  a.hostId === b.hostId && a.deviceId === b.deviceId;

const threadKey = (threadRef: ScopedThreadRef) =>
  `${threadRef.environmentId}:${threadRef.threadId}`;

/** The device each thread's panel works with, chosen in the panel or handed over by the Device panel. */
export const useDeviceQaTargetStore = create<{
  readonly byThread: Readonly<Record<string, DeviceQaTarget>>;
  readonly select: (threadRef: ScopedThreadRef, target: DeviceQaTarget) => void;
}>()((set) => ({
  byThread: {},
  select: (threadRef, target) =>
    set((state) => ({ byThread: { ...state.byThread, [threadKey(threadRef)]: target } })),
}));

export const selectedTargetOf = (
  byThread: Readonly<Record<string, DeviceQaTarget>>,
  threadRef: ScopedThreadRef,
) => byThread[threadKey(threadRef)] ?? null;

/**
 * What the panel last saw, so the pure palette and the shortcuts can act without their own
 * subscriptions: the host's booted devices and recording, and the thread's latest run.
 */
const seenLocalDevices = new Map<EnvironmentId, ReadonlyArray<DeviceQaLocalDevice>>();
const seenRecordings = new Map<EnvironmentId, DeviceQaActiveRecording>();
const seenRuns = new Map<string, DeviceQaRun>();

export function noteLocalDevices(
  environmentId: EnvironmentId,
  devices: ReadonlyArray<DeviceQaLocalDevice>,
) {
  seenLocalDevices.set(environmentId, devices);
}

export function noteRecording(
  environmentId: EnvironmentId,
  recording: DeviceQaActiveRecording | null,
) {
  if (recording) seenRecordings.set(environmentId, recording);
  else seenRecordings.delete(environmentId);
}

/** Notes the thread's newest run; `runs` is newest first. */
export function noteRuns(threadRef: ScopedThreadRef, runs: ReadonlyArray<DeviceQaRun>) {
  const latest = runs.find((run) => run.threadId === threadRef.threadId);
  if (latest) seenRuns.set(threadKey(threadRef), latest);
}

export const recordingOf = (environmentId: EnvironmentId) =>
  seenRecordings.get(environmentId) ?? null;
export const lastRunOf = (threadRef: ScopedThreadRef) => seenRuns.get(threadKey(threadRef)) ?? null;

/**
 * The device a shortcut acts on: the panel's choice, else the device the thread has open in
 * the Device panel, else the host's only booted simulator or emulator.
 */
export function targetFor(threadRef: ScopedThreadRef): DeviceQaTarget | null {
  const selected = selectedTargetOf(useDeviceQaTargetStore.getState().byThread, threadRef);
  if (selected) return selected;
  const devices = Option.getOrNull(
    AsyncResult.value(
      appAtomRegistry.get(
        deviceEnvironment.state({ environmentId: threadRef.environmentId, input: {} }),
      ),
    ),
  );
  const session = devices?.sessions.find((entry) => entry.threadId === threadRef.threadId);
  if (session)
    return { hostId: session.hostId, deviceId: session.deviceId, platform: session.platform };
  const local = seenLocalDevices.get(threadRef.environmentId) ?? [];
  return local.length === 1 ? local[0]!.target : null;
}

export function openPanel(threadRef: ScopedThreadRef, target?: DeviceQaTarget) {
  if (target) useDeviceQaTargetStore.getState().select(threadRef, target);
  useRightPanelStore.getState().openSurface(threadRef, forkPanelSurface(PANEL_ID));
}

export function togglePanel(threadRef: ScopedThreadRef) {
  const panels = useRightPanelStore.getState();
  const active = selectActiveRightPanelSurface(panels.byThreadKey, threadRef);
  if (active?.kind === "fork" && active.panelId === PANEL_ID)
    panels.closeSurface(threadRef, active.id);
  else panels.openSurface(threadRef, forkPanelSurface(PANEL_ID));
}

const noDevice = (threadRef: ScopedThreadRef) => {
  openPanel(threadRef);
  toastManager.add({
    type: "info",
    title: "Device QA",
    description: "Choose a booted simulator or emulator in the Device QA panel first.",
  });
};

/** Saves a screenshot as thread evidence and offers to attach it. */
export async function captureScreenshot(threadRef: ScopedThreadRef, target?: DeviceQaTarget) {
  const device = target ?? targetFor(threadRef);
  if (!device) return noDevice(threadRef);
  try {
    const item = await runCommand(deviceQa.capture, {
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, target: device, kind: "screenshot" },
    });
    const toastId = toastManager.add({
      type: "success",
      title: "Screenshot saved",
      description: "It is in this thread's Device QA evidence.",
      actionProps: {
        children: "Attach",
        onClick: () => {
          toastManager.close(toastId);
          void attachOrToast(threadRef, item);
        },
      },
    });
  } catch (error) {
    toastManager.add({ type: "error", title: "Screenshot failed", description: errorText(error) });
  }
}

export async function attachOrToast(threadRef: ScopedThreadRef, item: DeviceQaEvidence) {
  try {
    await attachEvidence(threadRef, item);
  } catch (error) {
    toastManager.add({ type: "error", title: "Could not attach", description: errorText(error) });
  }
}

/** Runs the thread's last flow run again on the same device. */
export async function runLastFlow(threadRef: ScopedThreadRef) {
  const last = lastRunOf(threadRef);
  if (!last) {
    openPanel(threadRef);
    toastManager.add({
      type: "info",
      title: "Device QA",
      description: "Run a flow from the Device QA panel first.",
    });
    return;
  }
  openPanel(threadRef, last.target);
  try {
    const run = await runCommand(deviceQa.runFlows, {
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        target: last.target,
        paths: last.flows.map((flow) => flow.path),
      },
    });
    seenRuns.set(threadKey(threadRef), run);
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Flow run did not start",
      description: errorText(error),
    });
  }
}

export async function cancelLastRun(threadRef: ScopedThreadRef) {
  const last = lastRunOf(threadRef);
  if (last?.status !== "running") return;
  try {
    await runCommand(deviceQa.cancelRun, {
      environmentId: threadRef.environmentId,
      input: { runId: last.id },
    });
  } catch (error) {
    toastManager.add({ type: "error", title: "Cancel failed", description: errorText(error) });
  }
}

export async function stopRecording(environmentId: EnvironmentId, evidenceId: string) {
  try {
    await runCommand(deviceQa.stopRecording, { environmentId, input: { evidenceId } });
  } catch (error) {
    toastManager.add({
      type: "error",
      title: "Stop recording failed",
      description: errorText(error),
    });
  }
}
