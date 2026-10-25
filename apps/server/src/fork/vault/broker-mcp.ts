import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultBrokerError,
  VaultBrokerSnapshot,
  VaultBrokerBegin,
  VaultBrokerInvitation,
  VaultBrokerMutation,
  VaultBrokerMutationResult,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultBrokers from "./VaultBrokers.ts";
const failure = Schema.Union([VaultError, VaultBrokerError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultBrokerToolkit = Toolkit.make(
  Tool.make("loom_vault_brokers", {
    description:
      "Inspect enrolled Vault brokers and pending public-key invitations as a full-access administrator client. Enrollment does not authorize credential use.",
    success: VaultBrokerSnapshot,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_brokers_invite", {
    description:
      "Create a ten-minute invitation bound to a broker's public identity. Compare the fingerprint out of band before approving its claim. Private machine keys never enter this tool. Full-access administrator clients only.",
    parameters: VaultBrokerBegin,
    success: VaultBrokerInvitation,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_brokers_apply", {
    description:
      "Approve a claimed broker fingerprint, cancel an invitation, or permanently disable a host identity at an expected registry revision. Agent threads cannot enroll or approve themselves. No boot service is installed.",
    parameters: VaultBrokerMutation,
    success: VaultBrokerMutationResult,
    failure,
    dependencies,
  }),
);
export const vaultBrokerHandlers = McpToolAccess.toLayer(
  VaultBrokerToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const administrator = Effect.gen(function* () {
      const caller = yield* McpInvocationContext;
      if (caller.thread || caller.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied", detail: "admin-only" });
      return `client:${caller.client.sessionId}`;
    });
    return {
      loom_vault_brokers: McpToolAccess.writesEnvironment(() =>
        administrator.pipe(
          Effect.andThen(
            onHost(Effect.flatMap(VaultBrokers.VaultBrokers, (service) => service.snapshot)),
          ),
        ),
      ),
      loom_vault_brokers_invite: McpToolAccess.writesEnvironment((input) =>
        administrator.pipe(
          Effect.flatMap((actor) =>
            onHost(
              Effect.flatMap(VaultBrokers.VaultBrokers, (service) => service.begin(input, actor)),
            ),
          ),
        ),
      ),
      loom_vault_brokers_apply: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const actor = yield* administrator;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultBrokers.VaultBrokers, (service) =>
              service.apply(input, actor, authorize),
            ),
          );
        }),
      ),
    };
  }),
);
