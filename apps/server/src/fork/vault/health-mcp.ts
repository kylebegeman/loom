import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultHealthSnapshot,
  VaultHealthRecheckResult,
  VaultHealthMutation,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultHealth from "./VaultHealth.ts";
import * as VaultHealthChecks from "./VaultHealthChecks.ts";
const failure = Schema.Union([VaultError, OrchestratorMcpFailure]),
  dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultHealthToolkit = Toolkit.make(
  Tool.make("loom_vault_health", {
    description:
      "Inspect the administrator maintenance inbox and declared expiry rules. Full-access administrator clients only, not agent threads. Does not contact providers or return credentials.",
    success: VaultHealthSnapshot,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_health_apply", {
    description:
      "Configure explicitly opted-in expiry/GitHub checks, remove a rule, snooze/unsnooze, dismiss or reopen an issue. Administrator client only. Retain operationId for retries; requires expectedRevision. No provider revocation or personal credential repair.",
    parameters: VaultHealthMutation,
    success: VaultHealthSnapshot,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_health_recheck", {
    description:
      "Explicitly recheck a configured item. Administrator clients only; probes are bounded and rate limited. Does not retry a credential write.",
    parameters: Schema.Struct({ itemId: VaultItemId }),
    success: VaultHealthRecheckResult,
    failure,
    dependencies,
  }),
);
export const vaultHealthHandlers = McpToolAccess.toLayer(
  VaultHealthToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const admin = Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (scope.thread || scope.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied" });
      return `client:${scope.client.sessionId}`;
    });
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_vault_health: McpToolAccess.reads(() =>
        admin.pipe(
          Effect.andThen(onHost(Effect.flatMap(VaultHealth.VaultHealth, (s) => s.snapshot))),
        ),
      ),
      loom_vault_health_apply: McpToolAccess.writesEnvironment((input) =>
        admin.pipe(
          Effect.flatMap((actor) =>
            onHost(Effect.flatMap(VaultHealth.VaultHealth, (s) => s.apply(input, actor))),
          ),
        ),
      ),
      loom_vault_health_recheck: McpToolAccess.writesEnvironment((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultHealthChecks.VaultHealthChecks, (s) => s.recheck(input.itemId)),
            ),
          ),
        ),
      ),
    };
  }),
);
