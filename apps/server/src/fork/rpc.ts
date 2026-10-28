import { SkillRegistryRpcGroup, SKILL_REGISTRY_WS_METHODS } from "@t3tools/contracts/fork";
import { makeSkillRegistryRpcHandlers } from "./skill-registry/rpc.ts";
import { PROJECT_WORKFLOW_WS_METHODS, ProjectWorkflowsRpcGroup } from "@t3tools/contracts/fork";
import { DATABASE_COMPACTION_WS_METHODS } from "@t3tools/contracts/fork";
import { makeProjectWorkflowRpcHandlers } from "./project-library/workflow-rpc.ts";
import { ProjectProfilesRpcGroup, PROJECT_PROFILES_WS_METHODS } from "@t3tools/contracts/fork";
import { makeProjectProfilesRpcHandlers } from "./project-profiles/rpc.ts";
import { VAULT_TEST_ACCOUNT_WS_METHODS, VaultTestAccountRpcGroup } from "@t3tools/contracts/fork";
import { makeVaultTestAccountRpcHandlers } from "./vault/test-accounts-rpc.ts";
import {
  VAULT_MIGRATION_INVENTORY_WS_METHODS,
  VaultMigrationInventoryRpcGroup,
} from "@t3tools/contracts/fork";
import { makeVaultMigrationInventoryRpcHandlers } from "./vault/migration-inventory-rpc.ts";
import { VAULT_MIGRATION_WS_METHODS, VaultMigrationRpcGroup } from "@t3tools/contracts/fork";
import { makeVaultMigrationRpcHandlers } from "./vault/migration-rpc.ts";
import { makeVaultHealthRpcHandlers } from "./vault/health-rpc.ts";
import { VAULT_HEALTH_WS_METHODS, VaultHealthRpcGroup } from "@t3tools/contracts/fork";
import { makeVaultGitHubRpcHandlers } from "./vault/github-rpc.ts";
import { VAULT_GITHUB_WS_METHODS, VaultGitHubRpcGroup } from "@t3tools/contracts/fork";
import { makeVaultProfileRpcHandlers, makeVaultReferenceRpcHandlers } from "./vault/profile-rpc.ts";
import type * as Rpc from "effect/rpc/Rpc";
import type * as RpcGroup from "effect/rpc/RpcGroup";
import * as Layer from "effect/Layer";
import { makeVaultSshRpcHandlers } from "./vault/ssh-rpc.ts";
import { makeVaultBrokerRpcHandlers } from "./vault/broker-rpc.ts";
import { makeVaultAccessRpcHandlers } from "./vault/access-rpc.ts";
import { makeVaultCoreRpcHandlers } from "./vault/rpc.ts";
import { VaultSecretRpcGroup, VAULT_SECRET_WS_METHODS } from "@t3tools/contracts/fork";
import { makeVaultSecretRpcHandlers } from "./vault/secret-rpc.ts";
import { SITES_WS_METHODS as S } from "@t3tools/contracts/fork";
import * as SitesService from "./sites/SitesService.ts";
import { makeProjectLibraryRpcHandlers } from "./project-library/rpc.ts";
import { makeProjectCheckoutRpcHandlers } from "./project-checkout/rpc.ts";
import { COMPUTER_NAMING_WS_METHODS as N } from "@t3tools/contracts/fork";
import * as ComputerNaming from "./computer-naming/ComputerNaming.ts";
import { GITHUB_HOST_SETUP_WS_METHODS as GH } from "@t3tools/contracts/fork";
import * as GitHubSetupFlow from "../sourceControl/GitHubSetupFlow.ts";
import { makeWorkspaceHandoffRpcHandlers } from "./workspace-handoff/rpc.ts";
import { makeMiniOffloadRpcHandlers } from "./mini-offload/rpc.ts";
import { makePcbPreviewRpcHandlers } from "./pcb-preview/rpc.ts";
import { makeModelPreviewRpcHandlers } from "./model-preview-3d/rpc.ts";
import { makeProjectLifecycleRpcHandlers } from "./project-lifecycle/rpc.ts";
import { makeAppleBuildToolingRpcHandlers } from "./apple-build-tooling/rpc.ts";
import { makeDeviceQaRpcHandlers } from "./device-qa/rpc.ts";
import {
  makeBotBatchesRpcHandlers,
  makeBotsAnywhereRpcHandlers,
  makeBotDraftsRpcHandlers,
  makeBotPipelinesRpcHandlers,
  makeBotsRpcHandlers,
  makeBotTriggersRpcHandlers,
  makeBotVersionsRpcHandlers,
} from "./bots/rpc.ts";
import {
  BOTS_BATCH_WS_METHODS,
  BOTS_ANYWHERE_WS_METHODS,
  BOTS_DRAFT_WS_METHODS,
  BOTS_PIPELINE_WS_METHODS,
  BOTS_TRIGGER_WS_METHODS,
  BOTS_VERSION_WS_METHODS,
  BOTS_WS_METHODS,
  BotBatchesRpcGroup,
  BotsAnywhereRpcGroup,
  BotDraftsRpcGroup,
  BotPipelinesRpcGroup,
  BotsRpcGroup,
  BotTriggersRpcGroup,
  BotVersionsRpcGroup,
} from "@t3tools/contracts/fork";
import { makeCodeGraphRpcHandlers } from "./code-graph/rpc.ts";
import { makeAgentReceiptsRpcHandlers } from "./agent-receipts/rpc.ts";
import { makePreviewLinksRpcHandlers } from "./preview-links/rpc.ts";
import { makeDirectoryRpcHandlers } from "./directory/rpc.ts";
import { makeReachRpcHandlers } from "./reach/rpc.ts";
import { makeReachLibraryRpcHandlers } from "./reach/library/rpc.ts";
import { makeLibraryPushRpcHandlers } from "./library-push/rpc.ts";
import { withForkRuntime } from "./ForkRuntime.ts";
import {
  VaultCoreRpcGroup,
  VAULT_CORE_WS_METHODS,
  VaultAccessRpcGroup,
  VAULT_ACCESS_WS_METHODS,
  VaultBrokerRpcGroup,
  VAULT_BROKER_WS_METHODS,
  PreviewLinksRpcGroup,
  PREVIEW_LINKS_WS_METHODS,
  VaultProfileRpcGroup,
  VaultReferenceRpcGroup,
  VAULT_PROFILE_WS_METHODS,
  VAULT_REFERENCE_WS_METHODS,
  FORK_WS_METHODS,
  ForkRpcGroup,
  VaultSshRpcGroup,
  VAULT_SSH_WS_METHODS,
  ReachRpcGroup,
  REACH_WS_METHODS,
  LibraryPushRpcGroup,
  LIBRARY_PUSH_WS_METHODS,
  PcbPreviewRpcGroup,
  PCB_PREVIEW_WS_METHODS,
  ProjectLifecycleRpcGroup,
  PROJECT_LIFECYCLE_WS_METHODS,
  AgentReceiptsRpcGroup,
  AGENT_RECEIPTS_WS_METHODS,
} from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";

import packageJson from "../../package.json" with { type: "json" };
import type { AuthenticatedSession } from "../auth/EnvironmentAuth.ts";
import * as StorageCleanup from "../storageCleanup.ts";
import { LOOM_SERVER_FEATURES } from "./features.ts";
import { makeForkRpcAuth } from "./rpcAuthorization.ts";
import * as SwitchboardStatus from "./switchboard/SwitchboardStatus.ts";

// Separate handler inference keeps large RPC unions below TypeScript's recursion limit.
const otherForkRpcGroup = ForkRpcGroup.omit(
  ...Object.values(SKILL_REGISTRY_WS_METHODS),
  ...Object.values(PROJECT_WORKFLOW_WS_METHODS),
  ...Object.values(PROJECT_PROFILES_WS_METHODS),
  ...Object.values(VAULT_TEST_ACCOUNT_WS_METHODS),
  ...Object.values(VAULT_MIGRATION_INVENTORY_WS_METHODS),
  ...Object.values(VAULT_MIGRATION_WS_METHODS),
  ...Object.values(VAULT_HEALTH_WS_METHODS),
  ...Object.values(VAULT_BROKER_WS_METHODS),
  ...Object.values(VAULT_ACCESS_WS_METHODS),
  ...Object.values(VAULT_CORE_WS_METHODS),
  ...Object.values(VAULT_SECRET_WS_METHODS),
  ...Object.values(PREVIEW_LINKS_WS_METHODS),
  ...Object.values(VAULT_GITHUB_WS_METHODS),
  ...Object.values(VAULT_SSH_WS_METHODS),
  ...Object.values(VAULT_PROFILE_WS_METHODS),
  ...Object.values(VAULT_REFERENCE_WS_METHODS),
  ...Object.values(BOTS_WS_METHODS),
  ...Object.values(BOTS_BATCH_WS_METHODS),
  ...Object.values(BOTS_DRAFT_WS_METHODS),
  ...Object.values(BOTS_TRIGGER_WS_METHODS),
  ...Object.values(BOTS_VERSION_WS_METHODS),
  ...Object.values(BOTS_PIPELINE_WS_METHODS),
  ...Object.values(BOTS_ANYWHERE_WS_METHODS),
  ...Object.values(REACH_WS_METHODS),
  ...Object.values(LIBRARY_PUSH_WS_METHODS),
  ...Object.values(PCB_PREVIEW_WS_METHODS),
  ...Object.values(PROJECT_LIFECYCLE_WS_METHODS),
  ...Object.values(AGENT_RECEIPTS_WS_METHODS),
  // Served by makeDatabaseCompactionRpcLayer, which needs DatabaseStorage.
  ...Object.values(DATABASE_COMPACTION_WS_METHODS),
);

/** Fork RPC handlers for one connection, merged next to makeWsRpcLayer (ws.ts, fork: ext-core). */
export const makeForkRpcLayer = (
  session: AuthenticatedSession,
): Layer.Layer<
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof ProjectWorkflowsRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof SkillRegistryRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof ProjectProfilesRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultMigrationInventoryRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultMigrationRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultTestAccountRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultCoreRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultSecretRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultAccessRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultHealthRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultBrokerRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof PreviewLinksRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultGitHubRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof otherForkRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultSshRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultProfileRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof VaultReferenceRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotsRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotBatchesRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotDraftsRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotTriggersRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotVersionsRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotPipelinesRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof BotsAnywhereRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof ReachRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof LibraryPushRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof PcbPreviewRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof ProjectLifecycleRpcGroup>>
  | Rpc.ToHandler<RpcGroup.Rpcs<typeof AgentReceiptsRpcGroup>>,
  never,
  // Checkout release belongs to the server's StorageCleanup, provided beside layerWsRpc.
  StorageCleanup.StorageCleanup
> =>
  Layer.mergeAll(
    ProjectWorkflowsRpcGroup.toLayer(
      withForkRuntime(makeProjectWorkflowRpcHandlers(makeForkRpcAuth(session), session)),
    ),
    VaultTestAccountRpcGroup.toLayer(
      withForkRuntime(
        makeVaultTestAccountRpcHandlers(makeForkRpcAuth(session), `client:${session.sessionId}`),
      ),
    ),
    VaultMigrationInventoryRpcGroup.toLayer(
      withForkRuntime(
        makeVaultMigrationInventoryRpcHandlers(makeForkRpcAuth(session), session.subject),
      ),
    ),
    VaultMigrationRpcGroup.toLayer(
      withForkRuntime(makeVaultMigrationRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    VaultHealthRpcGroup.toLayer(
      withForkRuntime(makeVaultHealthRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    VaultBrokerRpcGroup.toLayer(
      withForkRuntime(makeVaultBrokerRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    VaultAccessRpcGroup.toLayer(
      withForkRuntime(
        makeVaultAccessRpcHandlers(makeForkRpcAuth(session), session.subject, session),
      ),
    ),
    VaultSecretRpcGroup.toLayer(
      withForkRuntime(makeVaultSecretRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    VaultCoreRpcGroup.toLayer(
      withForkRuntime(makeVaultCoreRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    SkillRegistryRpcGroup.toLayer(
      withForkRuntime(makeSkillRegistryRpcHandlers(makeForkRpcAuth(session))),
    ),
    ProjectProfilesRpcGroup.toLayer(
      withForkRuntime(makeProjectProfilesRpcHandlers(makeForkRpcAuth(session))),
    ),
    PreviewLinksRpcGroup.toLayer(
      withForkRuntime(makePreviewLinksRpcHandlers(makeForkRpcAuth(session), session)),
    ),
    VaultGitHubRpcGroup.toLayer(
      withForkRuntime(makeVaultGitHubRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    VaultProfileRpcGroup.toLayer(
      withForkRuntime(makeVaultProfileRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    VaultReferenceRpcGroup.toLayer(
      withForkRuntime(makeVaultReferenceRpcHandlers(makeForkRpcAuth(session))),
    ),
    BotsRpcGroup.toLayer(withForkRuntime(makeBotsRpcHandlers(makeForkRpcAuth(session)))),
    BotBatchesRpcGroup.toLayer(
      withForkRuntime(makeBotBatchesRpcHandlers(makeForkRpcAuth(session))),
    ),
    BotDraftsRpcGroup.toLayer(withForkRuntime(makeBotDraftsRpcHandlers(makeForkRpcAuth(session)))),
    BotTriggersRpcGroup.toLayer(
      withForkRuntime(makeBotTriggersRpcHandlers(makeForkRpcAuth(session))),
    ),
    BotVersionsRpcGroup.toLayer(
      withForkRuntime(makeBotVersionsRpcHandlers(makeForkRpcAuth(session))),
    ),
    BotPipelinesRpcGroup.toLayer(
      withForkRuntime(makeBotPipelinesRpcHandlers(makeForkRpcAuth(session))),
    ),
    BotsAnywhereRpcGroup.toLayer(
      withForkRuntime(makeBotsAnywhereRpcHandlers(makeForkRpcAuth(session))),
    ),
    VaultSshRpcGroup.toLayer(
      withForkRuntime(makeVaultSshRpcHandlers(makeForkRpcAuth(session), session.subject)),
    ),
    ReachRpcGroup.toLayer(
      withForkRuntime(
        Effect.gen(function* () {
          const auth = makeForkRpcAuth(session);
          return ReachRpcGroup.of({
            ...(yield* makeReachRpcHandlers(auth)),
            ...(yield* makeReachLibraryRpcHandlers(auth)),
          });
        }),
      ),
    ),
    LibraryPushRpcGroup.toLayer(
      withForkRuntime(makeLibraryPushRpcHandlers(makeForkRpcAuth(session), session)),
    ),
    PcbPreviewRpcGroup.toLayer(
      withForkRuntime(makePcbPreviewRpcHandlers(makeForkRpcAuth(session))),
    ),
    ProjectLifecycleRpcGroup.toLayer(
      withForkRuntime(makeProjectLifecycleRpcHandlers(makeForkRpcAuth(session))),
    ),
    AgentReceiptsRpcGroup.toLayer(
      withForkRuntime(makeAgentReceiptsRpcHandlers(makeForkRpcAuth(session))),
    ),
    otherForkRpcGroup.toLayer(
      Effect.gen(function* () {
        const auth = makeForkRpcAuth(session);
        const sites = yield* withForkRuntime(SitesService.SitesService);
        const naming = yield* withForkRuntime(ComputerNaming.ComputerNaming);
        const github = yield* withForkRuntime(GitHubSetupFlow.GitHubSetupFlow);
        const switchboard = yield* withForkRuntime(SwitchboardStatus.SwitchboardStatus);
        return otherForkRpcGroup.of({
          [S.saveSite]: (input) => auth.effect(S.saveSite, sites.saveSite(input)),
          [S.saveService]: (input) => auth.effect(S.saveService, sites.saveService(input)),
          [S.saveCheck]: (input) => auth.effect(S.saveCheck, sites.saveCheck(input)),
          [S.runChecks]: () => auth.effect(S.runChecks, sites.runChecks()),
          [S.snapshot]: () => auth.effect(S.snapshot, sites.snapshot),
          [S.analytics]: (input) => auth.effect(S.analytics, sites.analytics(input)),
          [N.get]: () => auth.effect(N.get, naming.current),
          [N.rename]: (input) => auth.effect(N.rename, naming.rename(input)),
          [GH.start]: (input) => auth.effect(GH.start, github.start(input)),
          [GH.cancel]: (input) => auth.effect(GH.cancel, github.cancel(input)),
          [GH.watch]: () => auth.stream(GH.watch, github.changes),
          [FORK_WS_METHODS.coreInfo]: () =>
            auth.effect(
              FORK_WS_METHODS.coreInfo,
              Effect.succeed({
                features: LOOM_SERVER_FEATURES,
                serverVersion: packageJson.version,
              }),
            ),
          [FORK_WS_METHODS.limits]: () =>
            auth.effect(FORK_WS_METHODS.limits, switchboard.readLimits),
          ...(yield* withForkRuntime(makeProjectLibraryRpcHandlers(auth, session))),
          ...(yield* withForkRuntime(makeProjectCheckoutRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeMiniOffloadRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeModelPreviewRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeWorkspaceHandoffRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeAppleBuildToolingRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeDeviceQaRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeCodeGraphRpcHandlers(auth))),
          ...(yield* withForkRuntime(makeDirectoryRpcHandlers(auth))),
        });
      }),
    ),
  );
