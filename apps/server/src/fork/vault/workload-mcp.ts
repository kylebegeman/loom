import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultTerminalReadiness,
  VaultWorkloadError,
  VaultWorkloadOpen,
  VaultWorkloadSession,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultWorkloads from "./VaultWorkloads.ts";
const failure = Schema.Union([VaultError, VaultWorkloadError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultWorkloadToolkit = Toolkit.make(
  Tool.make("loom_vault_terminal_readiness", {
    description:
      "Check this authenticated terminal connection against its current provider and run, plus online broker presence. Does not prove a selected account, destination, grant or upstream login. Results expire in 60 seconds.",
    success: VaultTerminalReadiness,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_workload_open", {
    description:
      "Open a five-minute public-key-bound authorization-check session for this authenticated active thread/run, one enrolled host, one item and exact destination. Requires a current use grant and full-access/default runtime. Supply a fresh workload public identity generated outside the project. This is a channel check, not secret delivery or SSH access. Never send private keys.",
    parameters: VaultWorkloadOpen,
    success: VaultWorkloadSession,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_workloads", {
    description:
      "List this active thread/run's workload authorization-check sessions. Session JSON is public binding metadata, not a bearer credential.",
    success: Schema.Array(VaultWorkloadSession),
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_workload_close", {
    description:
      "Close one of this authenticated thread's workload sessions. Closing is idempotent and stops future channel checks; provider credential revocation is separate.",
    parameters: Schema.Struct({ sessionId: VaultItemId }),
    success: Schema.Void,
    failure,
    dependencies,
  }),
);
export const vaultWorkloadHandlers = McpToolAccess.toLayer(
  VaultWorkloadToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const caller = Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (!scope.thread) return yield* new VaultError({ reason: "denied" });
      return scope.thread.threadId;
    });
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_vault_terminal_readiness: McpToolAccess.reads(() =>
        Effect.gen(function* () {
          const scope = yield* McpInvocationContext;
          if (!scope.thread) return yield* new VaultError({ reason: "denied" });
          const { threadId, providerInstanceId } = scope.thread;
          return yield* onHost(
            Effect.flatMap(VaultWorkloads.VaultWorkloads, (service) =>
              service.terminalReadiness(threadId, providerInstanceId),
            ),
          );
        }),
      ),
      loom_vault_workload_open: McpToolAccess.writesEnvironment((input) =>
        caller.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultWorkloads.VaultWorkloads, (service) =>
                service.open(input, threadId),
              ),
            ),
          ),
        ),
      ),
      loom_vault_workloads: McpToolAccess.reads(() =>
        caller.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultWorkloads.VaultWorkloads, (service) => service.list(threadId)),
            ),
          ),
        ),
      ),
      loom_vault_workload_close: McpToolAccess.writesEnvironment((input) =>
        caller.pipe(
          Effect.flatMap((threadId) =>
            onHost(
              Effect.flatMap(VaultWorkloads.VaultWorkloads, (service) =>
                service.close(input.sessionId, threadId),
              ),
            ),
          ),
        ),
      ),
    };
  }),
);
