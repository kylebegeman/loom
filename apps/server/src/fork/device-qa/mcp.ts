import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import {
  DEVICE_QA_FLOWS_DIR,
  DeviceQaError,
  DeviceQaFlowKind,
  DeviceQaFlowRunStatus,
  DeviceQaRunStatus,
  DeviceQaSnapshotArtifacts,
  DeviceQaStepStatus,
  type DeviceQaFlow,
  type DeviceQaLocalDevice,
  type DeviceQaStep,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpInvocationContext from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import { DeviceQaService } from "./DeviceQaService.ts";

/** The flow tool returns `running` with the run id after this; the run keeps going. */
export const AGENT_FLOW_WAIT_MS = 20 * 60 * 1000;
const AGENT_STEPS_PER_FLOW = 50;

const failure = Schema.Union([DeviceQaError, OrchestratorMcpFailure]);

const FlowToolResult = Schema.Struct({
  flows: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        kind: DeviceQaFlowKind,
        stepCount: Schema.Int,
        snapshotSteps: Schema.Int,
        prerequisite: Schema.NullOr(Schema.String),
        parseError: Schema.NullOr(Schema.String),
      }),
    ),
  ),
  truncated: Schema.optional(Schema.Boolean),
  run: Schema.optional(
    Schema.Struct({
      runId: Schema.String,
      status: DeviceQaRunStatus,
      device: Schema.String,
      flows: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          status: DeviceQaFlowRunStatus,
          passed: Schema.Int,
          failed: Schema.Int,
          skipped: Schema.Int,
          errored: Schema.Int,
          error: Schema.NullOr(Schema.String),
          steps: Schema.Array(
            Schema.Struct({
              index: Schema.Int,
              kind: Schema.String,
              status: DeviceQaStepStatus,
              target: Schema.optional(Schema.String),
              reason: Schema.optional(Schema.String),
              artifacts: Schema.optional(DeviceQaSnapshotArtifacts),
            }),
          ),
          stepsOmitted: Schema.Int,
        }),
      ),
    }),
  ),
});

const CaptureToolResult = Schema.Struct({
  evidenceId: Schema.String,
  path: Schema.String,
  width: Schema.NullOr(Schema.Int),
  height: Schema.NullOr(Schema.Int),
});

export const DeviceQaToolkit = Toolkit.make(
  Tool.make("loom_device_qa_flow", {
    description:
      "List or run the project's recorded argent UI flows (.argent/flows) on a simulator or emulator without an LLM in the loop. Returns per-step pass/fail and snapshot diff image paths. Runs wait up to 20 minutes; a longer run returns status running with its run id.",
    parameters: Schema.Struct({
      mode: Schema.Literals(["list", "run"]),
      flow: Schema.optional(
        Schema.String.annotate({
          description:
            "Flow name or path under .argent/flows. A folder runs every e2e flow in it. Required to run.",
        }),
      ),
      device_id: Schema.optional(
        Schema.String.annotate({
          description:
            "Simulator UDID or emulator serial. Defaults to the device this thread has open, else the only booted one.",
        }),
      ),
      update_baselines: Schema.optional(
        Schema.Boolean.annotate({
          description: "Rewrite snapshot baselines in the repository instead of comparing.",
        }),
      ),
    }),
    success: FlowToolResult,
    failure,
    dependencies: [McpInvocationContext.McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Device QA flows")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_device_qa_capture", {
    description:
      "Save a screenshot of a simulator or emulator as evidence in this thread's Device QA panel. Returns the PNG path on this machine.",
    parameters: Schema.Struct({
      device_id: Schema.optional(Schema.String),
      label: Schema.optional(Schema.String),
      clean_status_bar: Schema.optional(
        Schema.Boolean.annotate({
          description: "iOS simulators: show 9:41 and full bars while capturing.",
        }),
      ),
    }),
    success: CaptureToolResult,
    failure,
    dependencies: [McpInvocationContext.McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Title, "Capture device evidence")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
);

const invalid = (message: string) => new DeviceQaError({ reason: "invalid-path", message });

/** Device QA acts on the thread's devices, so it follows the thread's Agent device access. */
const callerThread = McpInvocationContext.requireThreadMcpCapability("device").pipe(
  Effect.map((scope) => scope.thread.threadId),
  Effect.mapError(
    () =>
      new OrchestratorMcpFailure({
        code: "capability_denied",
        message:
          "Device QA tools need Agent device access, which is turned off for this thread's project.",
      }),
  ),
);

const normalizeFlowRef = (value: string) =>
  value
    .trim()
    .replace(/^\.\//, "")
    .replace(new RegExp(`^${DEVICE_QA_FLOWS_DIR.replace(".", "\\.")}/`), "")
    .replace(/\/+$/, "");

/** The flows a `flow` argument names: one file by path or name, or a folder's e2e flows. */
export const selectFlows = (flows: ReadonlyArray<DeviceQaFlow>, value: string) => {
  const ref = normalizeFlowRef(value);
  const relative = (flow: DeviceQaFlow) => flow.path.slice(DEVICE_QA_FLOWS_DIR.length + 1);
  const exact = flows.find((flow) => relative(flow) === ref || relative(flow) === `${ref}.yaml`);
  const byName = flows.filter((flow) => flow.name === ref);
  const single = exact ?? (byName.length === 1 ? byName[0] : undefined);
  if (single !== undefined)
    return single.kind === "invalid"
      ? invalid(`${single.path} cannot run: ${single.parseError ?? "invalid flow"}`)
      : [single];
  if (byName.length > 1)
    return invalid(
      `Several flows are named "${ref}": ${byName.map((flow) => flow.path).join(", ")}.`,
    );
  const inFolder = flows.filter(
    (flow) => ref === "" || flow.folder === ref || flow.folder.startsWith(`${ref}/`),
  );
  const runnable = inFolder.filter((flow) => flow.kind === "e2e");
  if (runnable.length > 0) return runnable;
  return inFolder.length > 0
    ? invalid(`The folder "${ref}" has no e2e flows (flows that start with launch).`)
    : new DeviceQaError({
        reason: "flow-not-found",
        message: `No flow or folder "${ref}" was found.`,
      });
};

/** The named device, else the one this thread watches, else the only booted one. */
export const selectDevice = (
  local: ReadonlyArray<DeviceQaLocalDevice>,
  watched: ReadonlyArray<string>,
  deviceId: string | undefined,
) => {
  const unavailable = (message: string) =>
    new DeviceQaError({ reason: "device-unavailable", message });
  const listed = local.map((device) => `${device.name} (${device.target.deviceId})`).join(", ");
  if (deviceId !== undefined)
    return (
      local.find((device) => device.target.deviceId === deviceId) ??
      unavailable(
        `${deviceId} is not a booted simulator or running emulator here. Available: ${listed || "none"}.`,
      )
    );
  const fromThread = local.find((device) => watched.includes(device.target.deviceId));
  if (fromThread !== undefined) return fromThread;
  if (local.length === 1) return local[0]!;
  return local.length === 0
    ? unavailable("No simulator is booted and no emulator is running.")
    : unavailable(`Pass device_id; several devices are running: ${listed}.`);
};

const isError = Schema.is(DeviceQaError);
const orFail = <A>(value: A | DeviceQaError) =>
  isError(value) ? Effect.fail(value) : Effect.succeed(value as A);

const agentStep = (step: DeviceQaStep) => {
  const failing = step.status === "fail" || step.status === "error";
  return {
    index: step.index,
    kind: step.kind,
    status: step.status,
    ...(step.target === undefined ? {} : { target: step.target }),
    ...(failing && step.reason !== undefined ? { reason: step.reason } : {}),
    ...(failing && step.artifacts !== undefined ? { artifacts: step.artifacts } : {}),
  };
};

const pickDevice = (threadId: ThreadId, deviceId: string | undefined) =>
  Effect.gen(function* () {
    const service = yield* DeviceQaService;
    const [local, watched] = yield* Effect.all([
      service.localDevices,
      service.threadDeviceIds(threadId),
    ]);
    return yield* orFail(selectDevice(local, watched, deviceId));
  });

export const flowTool = (
  threadId: ThreadId,
  input: typeof DeviceQaToolkit.tools.loom_device_qa_flow.parametersSchema.Type,
) =>
  withForkRuntime(
    Effect.gen(function* () {
      const service = yield* DeviceQaService;
      const listing = yield* service.listFlows(threadId);
      if (input.mode === "list")
        return {
          flows: listing.flows.map((flow) => ({
            path: flow.path,
            kind: flow.kind,
            stepCount: flow.stepCount,
            snapshotSteps: flow.snapshotSteps,
            prerequisite: flow.prerequisite,
            parseError: flow.parseError,
          })),
          truncated: listing.truncated,
        };
      if (input.flow === undefined) return yield* invalid("Pass flow to run.");
      const flows = yield* orFail(selectFlows(listing.flows, input.flow));
      const device = yield* pickDevice(threadId, input.device_id);
      const run = yield* service.runFlows(
        {
          threadId,
          target: device.target,
          paths: flows.map((flow) => flow.path),
          updateBaselines: input.update_baselines ?? false,
        },
        "agent",
      );
      yield* service.waitForRun(run.id, AGENT_FLOW_WAIT_MS);
      const detail = yield* service.getRun(run.id);
      return {
        run: {
          runId: run.id,
          status: detail.run.status,
          device: `${device.name} (${device.version})`,
          flows: detail.run.flows.map((flow) => {
            const steps = detail.steps[flow.path] ?? [];
            return {
              path: flow.path,
              status: flow.status,
              passed: flow.passed,
              failed: flow.failed,
              skipped: flow.skipped,
              errored: flow.errored,
              error: flow.error,
              steps: steps.slice(0, AGENT_STEPS_PER_FLOW).map(agentStep),
              stepsOmitted: Math.max(0, steps.length - AGENT_STEPS_PER_FLOW),
            };
          }),
        },
      };
    }),
  );

export const captureTool = (
  threadId: ThreadId,
  input: typeof DeviceQaToolkit.tools.loom_device_qa_capture.parametersSchema.Type,
) =>
  withForkRuntime(
    Effect.gen(function* () {
      const service = yield* DeviceQaService;
      const device = yield* pickDevice(threadId, input.device_id);
      const item = yield* service.capture(
        {
          threadId,
          target: device.target,
          kind: "screenshot",
          ...(input.label === undefined ? {} : { label: input.label.slice(0, 200) }),
          ...(input.clean_status_bar === undefined
            ? {}
            : { cleanStatusBar: input.clean_status_bar }),
        },
        "agent",
      );
      return { evidenceId: item.id, path: item.path ?? "", width: item.width, height: item.height };
    }),
  );

export const deviceQaHandlers = McpToolAccess.toLayer(
  DeviceQaToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const withRuntime = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_device_qa_flow: McpToolAccess.actsAsCaller((input) =>
        withRuntime(callerThread.pipe(Effect.flatMap((threadId) => flowTool(threadId, input)))),
      ),
      loom_device_qa_capture: McpToolAccess.actsAsCaller((input) =>
        withRuntime(callerThread.pipe(Effect.flatMap((threadId) => captureTool(threadId, input)))),
      ),
    };
  }),
);
