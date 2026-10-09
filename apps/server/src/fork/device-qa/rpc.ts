import type { ThreadId } from "@t3tools/contracts";
import {
  DEVICE_QA_WS_METHODS as Q,
  type DeviceQaCaptureInput,
  type DeviceQaInstallInput,
  type DeviceQaRunFlowsInput,
  type DeviceQaSettingsPatch,
  type DeviceQaTarget,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import type { ForkRpcAuth } from "../rpcAuthorization.ts";
import { DeviceQaService } from "./DeviceQaService.ts";

export const makeDeviceQaRpcHandlers = (auth: ForkRpcAuth) =>
  Effect.gen(function* () {
    const service = yield* DeviceQaService;
    return {
      [Q.status]: (input: { threadId: ThreadId }) =>
        auth.effect(Q.status, service.status(input.threadId)),
      [Q.listFlows]: (input: { threadId: ThreadId }) =>
        auth.effect(Q.listFlows, service.listFlows(input.threadId)),
      [Q.readFlow]: (input: { threadId: ThreadId; path: string }) =>
        auth.effect(Q.readFlow, service.readFlow(input.threadId, input.path)),
      [Q.runFlows]: (input: DeviceQaRunFlowsInput) =>
        auth.effect(Q.runFlows, service.runFlows(input, "user")),
      [Q.cancelRun]: (input: { runId: string }) =>
        auth.effect(Q.cancelRun, service.cancelRun(input.runId)),
      [Q.getRun]: (input: { runId: string }) => auth.effect(Q.getRun, service.getRun(input.runId)),
      [Q.watchRuns]: (input: { threadId: ThreadId }) =>
        auth.stream(Q.watchRuns, service.watchRuns(input.threadId)),
      [Q.runEvents]: (input: { runId: string }) =>
        auth.stream(Q.runEvents, service.runEvents(input.runId)),
      [Q.capture]: (input: DeviceQaCaptureInput) =>
        auth.effect(Q.capture, service.capture(input, "user")),
      [Q.stopRecording]: (input: { evidenceId: string }) =>
        auth.effect(Q.stopRecording, service.stopRecording(input.evidenceId)),
      [Q.watchEvidence]: (input: { threadId: ThreadId }) =>
        auth.stream(Q.watchEvidence, service.watchEvidence(input.threadId)),
      [Q.deleteEvidence]: (input: { evidenceId: string }) =>
        auth.effect(Q.deleteEvidence, service.deleteEvidence(input.evidenceId)),
      [Q.deleteAllEvidence]: (input: { threadId: ThreadId }) =>
        auth.effect(Q.deleteAllEvidence, service.deleteAllEvidence(input.threadId)),
      [Q.installApp]: (input: DeviceQaInstallInput) =>
        auth.effect(Q.installApp, service.installApp(input, "user")),
      [Q.statusBar]: (input: { target: DeviceQaTarget; mode: "clean" | "clear" }) =>
        auth.effect(Q.statusBar, service.statusBar(input.target, input.mode)),
      [Q.disableArgentTelemetry]: () =>
        auth.effect(Q.disableArgentTelemetry, service.disableArgentTelemetry),
      [Q.getSettings]: () => auth.effect(Q.getSettings, service.getSettings),
      [Q.updateSettings]: (input: DeviceQaSettingsPatch) =>
        auth.effect(Q.updateSettings, service.updateSettings(input)),
    };
  });
