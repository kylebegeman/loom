import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  VaultReferenceSearch,
  VaultReferencePage,
  VaultReference,
  VaultItemId,
  VaultProfileSnapshot,
  VaultProfileMutation,
  VaultProfileRun,
  VaultProfileRunResult,
  VaultProfileResolution,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import { McpInvocationContext } from "../../mcp/McpInvocationContext.ts";
import { ThreadManagementService } from "../../orchestration-v2/ThreadManagementService.ts";
import * as McpToolAccess from "../../mcp/McpToolAccess.ts";
import { ForkRuntime, withForkRuntime } from "../ForkRuntime.ts";
import * as VaultProfiles from "./VaultProfiles.ts";
import * as VaultReferences from "./VaultReferences.ts";
import * as VaultLaunch from "./VaultLaunch.ts";
const failure = Schema.Union([
  VaultError,
  VaultSshError,
  VaultWorkloadError,
  OrchestratorMcpFailure,
]);
const dependencies = [McpInvocationContext, ThreadManagementService];
export const VaultProfileToolkit = Toolkit.make(
  Tool.make("loom_vault_references_search", {
    description:
      "Search safe Vault references by label or item ID in this environment. Threads see only inspect-granted items; values are never returned. Results scan bounded pages; continue with nextCursor even if a page has no matches. Set kind:null for any kind, includeArchived:false and cursor:null to start.",
    parameters: VaultReferenceSearch,
    success: VaultReferencePage,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_references_describe", {
    description:
      "Describe an inspect-granted item reference without its value. Missing and forbidden IDs both return null; item renames retain the stable environment/item reference.",
    parameters: Schema.Struct({ id: VaultItemId }),
    success: Schema.NullOr(VaultReference),
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_profiles", {
    description:
      "List this authenticated thread's project profiles and named SSH/Git requirements, including the default for new runs. Profiles contain references, not values, and grant no access. Administrator clients must supply projectId; threads cannot select another project.",
    parameters: Schema.Struct({
      projectId: Schema.optional(VaultProfileMutation.fields.projectId),
    }),
    success: VaultProfileSnapshot,
    failure,
    dependencies,
  }).annotate(Tool.Readonly, true),
  Tool.make("loom_vault_profiles_apply", {
    description:
      "Create/edit, archive/restore or select/deactivate a project profile as a human full-access administrator. Uses a registry revision and stable operationId for retries. Agents cannot change their profile bindings or grants. All bindings are required for resolution. No secret values, credentials or private keys belong in a profile.",
    parameters: VaultProfileMutation,
    success: VaultProfileSnapshot,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_profile_resolve", {
    description:
      "Resolve this active full-access/default run's selected project profile. profileId:null chooses the project default on first use. All requirements need current use grants and trusted active SSH keys. Persist a run-bound snapshot of profile revision and key versions, never secret values. Later edits/default switches apply to future runs; changing profile or rotating a key requires a new run. Archive/revocation blocks new use. This resolution is not an access token.",
    parameters: Schema.Struct({ profileId: Schema.NullOr(VaultItemId) }),
    success: VaultProfileResolution,
    failure,
    dependencies,
  }),
  Tool.make("loom_vault_profile_run", {
    description:
      "Execute a named SSH/Git binding using this run's pinned project profile, without repeating item IDs or destinations. profileId:null uses the existing run selection or project default. SSH operation accepts kind:ssh, argv, timeoutMs; Git accepts kind:git, action:ls-remote|fetch, timeoutMs. Workload setup and release are automatic through the configured server broker. Current grants, host trust, key version and profile archive state are rechecked. No raw secrets, global SSH config, clone/push or terminal socket setup.",
    parameters: VaultProfileRun,
    success: VaultProfileRunResult,
    failure,
    dependencies,
  }),
);
export const vaultProfileHandlers = McpToolAccess.toLayer(
  VaultProfileToolkit,
  Effect.gen(function* () {
    const runtime = yield* ForkRuntime;
    const onHost = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      withForkRuntime(effect).pipe(Effect.provideService(ForkRuntime, runtime));
    const caller = Effect.gen(function* () {
      const scope = yield* McpInvocationContext;
      if (!scope.thread && scope.client?.access !== "full-access")
        return yield* new VaultError({ reason: "denied" });
      return scope;
    });
    const thread = caller.pipe(
      Effect.flatMap((scope) =>
        scope.thread
          ? Effect.succeed(scope.thread.threadId)
          : Effect.fail(new VaultError({ reason: "denied" })),
      ),
    );
    return {
      loom_vault_references_search: McpToolAccess.reads((input) =>
        caller.pipe(
          Effect.flatMap((scope) =>
            onHost(
              Effect.flatMap(VaultReferences.VaultReferences, (r) =>
                r.search(input, scope.thread?.threadId),
              ),
            ),
          ),
        ),
      ),
      loom_vault_references_describe: McpToolAccess.reads((input) =>
        caller.pipe(
          Effect.flatMap((scope) =>
            onHost(
              Effect.flatMap(VaultReferences.VaultReferences, (r) =>
                r.describe(input.id, scope.thread?.threadId),
              ),
            ),
          ),
        ),
      ),
      loom_vault_profiles: McpToolAccess.reads((input) =>
        caller.pipe(
          Effect.flatMap((scope) =>
            onHost(
              Effect.flatMap(VaultProfiles.VaultProfiles, (p) =>
                scope.thread
                  ? p.listForThread(scope.thread.threadId)
                  : input.projectId
                    ? p.list(input.projectId)
                    : Effect.fail(new VaultError({ reason: "invalid-input" })),
              ),
            ),
          ),
        ),
      ),
      loom_vault_profiles_apply: McpToolAccess.writesEnvironment((input, check) =>
        Effect.gen(function* () {
          const scope = yield* caller;
          if (scope.thread) return yield* new VaultError({ reason: "denied" });
          const context = yield* Effect.context<Effect.Services<typeof check>>();
          const authorize = check.pipe(
            Effect.provide(context),
            Effect.asVoid,
            Effect.mapError(() => new VaultError({ reason: "denied" })),
          );
          return yield* onHost(
            Effect.flatMap(VaultProfiles.VaultProfiles, (p) =>
              p.apply(input, `client:${scope.client!.sessionId}`, authorize),
            ),
          );
        }),
      ),
      loom_vault_profile_resolve: McpToolAccess.writesEnvironment((input) =>
        thread.pipe(
          Effect.flatMap((id) =>
            onHost(
              Effect.flatMap(VaultProfiles.VaultProfiles, (p) => p.resolve(id, input.profileId)),
            ),
          ),
        ),
      ),
      loom_vault_profile_run: McpToolAccess.writesEnvironment((input) =>
        thread.pipe(
          Effect.flatMap((id) =>
            onHost(Effect.flatMap(VaultLaunch.VaultLaunch, (launch) => launch.profile(input, id))),
          ),
        ),
      ),
    };
  }),
);
