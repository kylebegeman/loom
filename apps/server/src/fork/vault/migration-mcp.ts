import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultMigrationError,
  VaultMigrationResult,
  VaultTypedMigrationResult,
  VaultTypedMigrationPage,
  VaultMigrationList,
  VaultMigrationPage,
  VaultItemId,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultMigration from "./VaultMigration.ts";
const failure = Schema.Union([VaultError, VaultMigrationError, OrchestratorMcpFailure]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultMigrationToolkit = Toolkit.make(
  Tool.make("loom_vault_migration_typed_plans", {
    description:
      "List safe reviewed development-only SSH/GitHub imports. Administrator clients only. No credentials, provider contact, grants or configuration changes. Private ingress is only in Loom's human review form.",
    parameters: VaultMigrationList,
    success: VaultTypedMigrationPage,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_migration_typed_status", {
    description:
      "Inspect a typed development import receipt without importing credentials or contacting providers. Administrator clients only. Imported credentials are unverified and all configuration execution stays unavailable.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultTypedMigrationResult,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_migration_plans", {
    description:
      "List safe development import reviews, 25 per page. Full-access administrator clients only. No personal store access, credential values or automatic import. Private prepare/apply happen in Loom's reviewed form.",
    parameters: VaultMigrationList,
    success: VaultMigrationPage,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_migration_status", {
    description:
      "Inspect a development import receipt, including a committed save after an interrupted response. Full-access administrator clients only. Does not return or import credentials or change repository configuration.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: VaultMigrationResult,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
);
export const vaultMigrationHandlers = McpToolAccess.toLayer(
  VaultMigrationToolkit,
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
      loom_vault_migration_typed_plans: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigration.VaultMigration, (service) => service.typedList(input)),
            ),
          ),
        ),
      ),
      loom_vault_migration_typed_status: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigration.VaultMigration, (service) =>
                service.typedInspect(input.id),
              ),
            ),
          ),
        ),
      ),
      loom_vault_migration_plans: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(Effect.flatMap(VaultMigration.VaultMigration, (service) => service.list(input))),
          ),
        ),
      ),
      loom_vault_migration_status: McpToolAccess.reads((input) =>
        admin.pipe(
          Effect.andThen(
            onHost(
              Effect.flatMap(VaultMigration.VaultMigration, (service) => service.inspect(input.id)),
            ),
          ),
        ),
      ),
    };
  }),
);
