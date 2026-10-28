import { OrchestratorMcpFailure, SecretRequestError } from "@t3tools/contracts";
import {
  VaultError,
  VaultItemList,
  VaultItemPage,
  VaultCoreStatus,
  VaultPrivateSave,
  VaultItemChange,
  VaultItemSummary,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as VaultPrivateInput from "./VaultPrivateInput.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultAccess from "./VaultAccess.ts";
import * as VaultCore from "./VaultCore.ts";
const failure = Schema.Union([VaultError, SecretRequestError, OrchestratorMcpFailure]);
export const VaultCoreToolkit = Toolkit.make(
  Tool.make("loom_vault_status", {
    description:
      "Read this environment's Loom Vault connection status. tokenTtlSeconds, when present, is how long the service token has left unless renewed; under 72 hours left means its renewal job has stopped. Does not return credentials or attempt to unlock OpenBao.",
    success: VaultCoreStatus,
    failure,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_items", {
    description:
      "Search safe Vault item metadata with query (name, kind, item ID or Vault reference) and kind before paging. Values are never searched or returned. Use sort:label for names or sort:updated for newest changes; pass nextCursor unchanged with the same filters. includeArchived also includes archived items. Threads see only metadata allowed by owner access or inspect grants; a blocked turn fails with its repair. Full-access clients retain administrator visibility.",
    parameters: VaultItemList,
    success: VaultItemPage,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_store", {
    description:
      "Store or replace a Vault item using a secretRef from request_secret. Never ask for or pass a raw secret in chat. Retain id and operationId for retries. expectedVersion:0 creates; replacement requires the current version. Requires a full-access/default Loom thread and a matching manage grant for the item ID.",
    parameters: VaultPrivateSave,
    success: VaultItemSummary,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
  Tool.make("loom_vault_change", {
    description:
      "Archive, restore or delete a Vault item with its current version. Delete removes the current value and leaves a tombstone; encrypted prior versions remain subject to backend retention. Values are never returned. Requires a full-access/default caller.",
    parameters: VaultItemChange,
    success: VaultItemSummary,
    failure,
    dependencies: [McpInvocationContext, ThreadManagementService],
  }),
);
export const vaultCoreHandlers = McpToolAccess.toLayer(
  VaultCoreToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_vault_status: McpToolAccess.reads(() =>
        onHost(Effect.flatMap(VaultCore.VaultCore, (service) => service.status)),
      ),
      loom_vault_items: McpToolAccess.reads((input) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (caller.thread)
            return yield* onHost(
              Effect.flatMap(VaultAccess.VaultAccess, (service) =>
                service.listForThread(input, caller.thread!.threadId),
              ),
            );
          if (caller.client?.access !== "full-access")
            return yield* new VaultError({ reason: "denied" });
          return yield* onHost(
            Effect.flatMap(VaultCore.VaultCore, (service) => service.list(input)),
          );
        }),
      ),
      loom_vault_store: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          if (caller.thread === undefined)
            return yield* new OrchestratorMcpFailure({
              code: "thread_credential_required",
              message: "Private Vault input needs a Loom thread's secret request.",
            });
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(context),
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultPrivateInput.VaultPrivateInput, (service) =>
              service.store(input, caller.thread!.threadId, authorize),
            ),
          );
        }),
      ),
      loom_vault_change: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const caller = yield* McpInvocationContext;
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.asVoid,
            Effect.provide(context),
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          const actor = caller.thread
            ? `thread:${caller.thread.threadId}`
            : `client:${caller.client?.sessionId ?? "unknown"}`;
          return yield* onHost(
            Effect.gen(function* () {
              const service = yield* VaultCore.VaultCore;
              const access = yield* VaultAccess.VaultAccess;
              return yield* service.change(
                input,
                actor,
                caller.thread
                  ? authorize.pipe(
                      Effect.andThen(
                        access.require(caller.thread.threadId, input.id, "manage", null),
                      ),
                    )
                  : authorize,
              );
            }),
          );
        }),
      ),
    };
  }),
);
