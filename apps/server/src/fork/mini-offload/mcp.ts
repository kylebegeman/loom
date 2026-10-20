import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  MiniSubmit,
  MiniReceipt,
  MiniDetail,
  MiniPatch,
  MiniAgentArtifacts,
  MiniWorkerSummary,
  MiniWorkerRef,
  MiniWorkerConnection,
  MiniWorkerReadiness,
  MiniOffloadError,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import { McpInvocationContext, requireThreadScope } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { loadCaller, assertFullAccess } from "../../mcp/threadAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as Mini from "./MiniOffloadService.ts";
const Ref = Schema.Struct({ requestId: MiniSubmit.fields.requestId });
const failure = Schema.Union([MiniOffloadError, OrchestratorMcpFailure]);
export const MiniOffloadToolkit = Toolkit.make(
  Tool.make("loom_mini_workers", {
    description:
      "List registered LoomOS Mini destinations. Registering workers is administrator controlled; with full access, loom_mini_worker_update and loom_mini_worker_remove change or remove one. These jobs run trusted repository commands, not a new Loom conversation.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(MiniWorkerSummary),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_mini_worker_check", {
    description:
      "Check a registered worker's connection, queue capacity and project-tool prerequisites. Does not install packages, change credentials or scan the network. A running Loom server does not prove provider authentication.",
    parameters: MiniWorkerRef,
    success: MiniWorkerReadiness,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_mini_worker_update", {
    description:
      "Point a registered worker at a new SSH host alias, with an optional absolute SSH config path on this computer, after the same worker moved or its connection broke. Its ID, name and enabled state stay, and its earlier jobs use the new connection. Register a different computer as a new worker instead. Requires full access.",
    parameters: MiniWorkerConnection,
    success: MiniWorkerSummary,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  })
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false),
  Tool.make("loom_mini_worker_remove", {
    description:
      "Remove a registered worker from this computer so it gets no new jobs. Its earlier jobs stay listed and keep reaching its last connection, and its ID can only be registered again at that connection. Requires full access.",
    parameters: MiniWorkerRef,
    success: MiniWorkerSummary,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Destructive, true),
  Tool.make("loom_mini_submit", {
    description:
      "Offload this thread's committed repository snapshot, up to 1 GiB, to a registered Mini worker. Supply a stable 32-character lowercase hex requestId. Save it before calling. Local changes need a commit or explicit committedOnly. Use recover after uncertain acceptance, never a different worker or request ID. SDKs and provider credentials must already exist on the worker. Optional outputs lists up to 32 exact repository-relative files to retain, including ignored build files, up to 60 MiB total.",
    parameters: Schema.Struct({
      workerId: MiniSubmit.fields.workerId,
      requestId: MiniSubmit.fields.requestId,
      label: MiniSubmit.fields.label,
      argv: MiniSubmit.fields.argv,
      memoryMiB: MiniSubmit.fields.memoryMiB,
      cpuPercent: MiniSubmit.fields.cpuPercent,
      timeoutSeconds: MiniSubmit.fields.timeoutSeconds,
      committedOnly: MiniSubmit.fields.committedOnly,
      outputs: MiniSubmit.fields.outputs,
    }),
    success: MiniReceipt,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Destructive, false),
  Tool.make("loom_mini_recover", {
    description:
      "Recover a saved offload on its original worker and immutable snapshot. Replaying the same request cannot create a second job.",
    parameters: Ref,
    success: MiniReceipt,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Destructive, false),
  Tool.make("loom_mini_list", {
    description: "List offload receipts owned by this thread. Inspect to refresh remote state.",
    parameters: Tool.EmptyParams,
    success: Schema.Array(MiniReceipt),
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_mini_inspect", {
    description:
      "Read an offload's current job state and last 1 MiB of logs. This does not wait for completion.",
    parameters: Ref,
    success: MiniDetail,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_mini_cancel", {
    description:
      "Cancel this thread's queued or active Mini job. Recover a pending transfer first to determine whether it was accepted.",
    parameters: Ref,
    success: MiniReceipt,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Destructive, true),
  Tool.make("loom_mini_artifacts", {
    description:
      "Collect this thread's declared output files from a finished Mini job, including failed jobs. Returns a checksum-verified file manifest and missing-file warnings. Binary content is omitted by default to preserve conversation context; use includeBundle=true only when you need base64 content. Maximum 64 MiB bundle. The user can download it from Command jobs. Does not extract or apply files; results follow worker retention even after workspace cleanup.",
    parameters: Schema.Struct({ ...Ref.fields, includeBundle: Schema.optional(Schema.Boolean) }),
    success: MiniAgentArtifacts,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_mini_patch", {
    description:
      "Retrieve a terminal job's checksum-verified binary Git patch against its submitted source revision. Returns base64; does not apply it. Maximum 64 MiB.",
    parameters: Ref,
    success: MiniPatch,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
);
const callerThread = Effect.gen(function* () {
  const scope = yield* McpInvocationContext;
  return (yield* requireThreadScope(scope, "Mini offload")).thread.threadId;
});
// Offload executes arbitrary commands without a provider approval round on the worker.
const requireDispatchAccess = loadCaller().pipe(
  Effect.flatMap((caller) =>
    assertFullAccess(
      caller,
      "Mini submission and recovery need a full-access/default calling thread.",
    ),
  ),
);
export const miniOffloadHandlers = McpToolAccess.toLayer(
  MiniOffloadToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const call = <A, E>(
      action: (
        service: Mini.MiniOffloadService["Service"],
        threadId: typeof MiniSubmit.Type.threadId,
      ) => Effect.Effect<A, E>,
    ) =>
      withForkRuntime(
        Effect.gen(function* () {
          const threadId = yield* callerThread;
          const service = yield* Mini.MiniOffloadService;
          return yield* action(service, threadId);
        }),
      ).pipe(Effect.provideService(ForkRuntime, runtime));
    // Registry changes act on this computer, not a thread, so a full-access client may make them too.
    const onHost = <A, E>(
      action: (service: Mini.MiniOffloadService["Service"]) => Effect.Effect<A, E>,
    ) =>
      withForkRuntime(Effect.flatMap(Mini.MiniOffloadService, action)).pipe(
        Effect.provideService(ForkRuntime, runtime),
      );
    return {
      loom_mini_workers: McpToolAccess.readsAsCaller(() => call((service) => service.workers)),
      loom_mini_worker_check: McpToolAccess.readsAsCaller((input) =>
        call((service) => service.check(input)),
      ),
      loom_mini_worker_update: McpToolAccess.writesEnvironment((input) =>
        onHost((service) => service.updateWorker(input)),
      ),
      loom_mini_worker_remove: McpToolAccess.writesEnvironment((input) =>
        onHost((service) => service.removeWorker(input)),
      ),
      loom_mini_submit: McpToolAccess.actsAsCaller((input) =>
        requireDispatchAccess.pipe(
          Effect.andThen(call((service, threadId) => service.submit({ ...input, threadId }))),
        ),
      ),
      loom_mini_recover: McpToolAccess.actsAsCaller((input) =>
        requireDispatchAccess.pipe(
          Effect.andThen(call((service, threadId) => service.recover({ ...input, threadId }))),
        ),
      ),
      loom_mini_list: McpToolAccess.readsAsCaller(() =>
        call((service, threadId) => service.list(threadId)),
      ),
      loom_mini_inspect: McpToolAccess.readsAsCaller((input) =>
        call((service, threadId) => service.inspect({ ...input, threadId })),
      ),
      loom_mini_cancel: McpToolAccess.actsAsCaller((input) =>
        call((service, threadId) => service.cancel({ ...input, threadId })),
      ),
      loom_mini_artifacts: McpToolAccess.readsAsCaller((input) =>
        call((service, threadId) => service.agentArtifacts({ ...input, threadId })),
      ),
      loom_mini_patch: McpToolAccess.readsAsCaller((input) =>
        call((service, threadId) => service.patch({ ...input, threadId })),
      ),
    };
  }),
);
