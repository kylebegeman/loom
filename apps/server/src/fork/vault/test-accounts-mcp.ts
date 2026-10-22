import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultTestAccountAgentMutation,
  VaultTestAccountDiscovery,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultTestAccountWorkloads from "./VaultTestAccountWorkloads.ts";

const failure = Schema.Union([VaultError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultTestAccountToolkit = Toolkit.make(
  Tool.make("loom_vault_test_accounts_discover", {
    description:
      "Discover only available dedicated development accounts and your own run's reservations, filtered by current inspect and use policy for loom:test-accounts:<collectionId>. Owner-trusted environments need no individual grants. Requires an authenticated live full-access/default thread. Returns safe references, never logins or other owners. Empty results can mean no eligible accounts. Discovery is an observation, not a reservation or delivery token.",
    parameters: Tool.EmptyParams,
    success: VaultTestAccountDiscovery,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_test_accounts_apply", {
    description:
      "Reserve, renew or release a dedicated development account for this authenticated active run only. Supply the discovery revision and a stable operationId. Reserve lasts 5 or 15 minutes; renewal is bounded to 15 minutes from now and one hour total. Reserve/renew require current inspect and use policy permission for loom:test-accounts:<collectionId>; release needs the exact owned lease and remains possible after access withdrawal. Expiry, release and stopped/replaced runs quarantine the account pending human clean review. No self-clean, provisioning, login delivery, automatic continuation or allow-once consumption. After conflict or a lost reply, inspect discovery and retry only the identical operation.",
    parameters: VaultTestAccountAgentMutation,
    success: VaultTestAccountDiscovery,
    failure,
    dependencies,
  }),
);
export const vaultTestAccountHandlers = McpToolAccess.toLayer(
  VaultTestAccountToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const caller = Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (!scope.thread) return yield* new VaultError({ reason: "denied" });
      return {
        environmentId: scope.environmentId,
        threadId: scope.thread.threadId,
        providerInstanceId: scope.thread.providerInstanceId,
      };
    });
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_vault_test_accounts_discover: McpToolAccess.readsAsCaller(() =>
        caller.pipe(
          Effect.flatMap((identity) =>
            onHost(
              Effect.flatMap(VaultTestAccountWorkloads.VaultTestAccountWorkloads, (s) =>
                s.discover(identity),
              ),
            ),
          ),
        ),
      ),
      loom_vault_test_accounts_apply: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const identity = yield* caller;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provideContext(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultTestAccountWorkloads.VaultTestAccountWorkloads, (s) =>
              s.apply(input, identity, authorize),
            ),
          );
        }),
      ),
    };
  }),
);
