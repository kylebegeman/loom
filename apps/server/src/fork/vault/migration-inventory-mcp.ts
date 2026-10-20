import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultReplacementError,
  VaultMigrationInventoryInput,
  VaultMigrationInventoryPage,
  VaultReplacementList,
  VaultReplacementPage,
  VaultReplacementResult,
  VaultReplacementVerificationStatus,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultMigrationInventory from "./VaultMigrationInventory.ts";
const failure = Schema.Union([VaultError, VaultReplacementError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultMigrationInventoryToolkit = Toolkit.make(
  Tool.make("loom_vault_migration_verification", {
    description:
      "Inspect a replacement verification receipt without contacting a provider. Administrator clients only. Freshness is bounded; provider revocations after a check and workload grants are unknown. No cutover is authorized.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultReplacementVerificationStatus,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_migration_inventory", {
    description:
      "Inspect up to ten registered projects' selected local Git metadata. Full-access administrator clients only. No authentication, network, personal stores, helpers, global config or SSH config inspection. Sanitized endpoints are hints, not verified identities or access. Follow nextCursor for coverage.",
    parameters: VaultMigrationInventoryInput,
    success: VaultMigrationInventoryPage,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_migration_replacements", {
    description:
      "List 25 safe replacement plans; source/item freshness is not checked on list. Full-access administrator clients only. Review never verifies access, grants permissions or enables cutover.",
    parameters: VaultReplacementList,
    success: VaultReplacementPage,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_migration_replacement_status", {
    description:
      "Refresh one replacement plan's local source and item freshness without network verification or configuration changes. Full-access administrator clients only. Access verification remains required before any cutover.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultReplacementResult,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
);
export const vaultMigrationInventoryHandlers = McpToolAccess.toLayer(
  VaultMigrationInventoryToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const admin = Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (scope.thread || scope.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied" });
    });
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    return {
      loom_vault_migration_verification: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigrationInventory.VaultMigrationInventory, (service) =>
                service.verification(input.id),
              ),
            ),
          ),
        ),
      ),
      loom_vault_migration_inventory: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigrationInventory.VaultMigrationInventory, (service) =>
                service.inventory(input),
              ),
            ),
          ),
        ),
      ),
      loom_vault_migration_replacements: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigrationInventory.VaultMigrationInventory, (service) =>
                service.list(input),
              ),
            ),
          ),
        ),
      ),
      loom_vault_migration_replacement_status: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigrationInventory.VaultMigrationInventory, (service) =>
                service.inspect(input.id),
              ),
            ),
          ),
        ),
      ),
    };
  }),
);
