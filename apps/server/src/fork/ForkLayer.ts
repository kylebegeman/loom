import * as VaultOwnerLink from "./vault/VaultOwnerLink.ts";
import { VaultOwnerLinkHttpRoutes } from "./vault/owner-link-http.ts";
import * as VaultProfileRecords from "./vault/VaultProfileRecords.ts";
import * as AccountVaultMachineAuthority from "./vault/AccountVaultMachineAuthority.ts";
import * as AccountWorkloads from "./account-access/AccountWorkloads.ts";
import * as AccountVaultAuthority from "./vault/AccountVaultAuthority.ts";
import * as AccountVaultClient from "./vault/AccountVaultClient.ts";
import * as AccountVaultSsh from "./vault/AccountVaultSsh.ts";
import { AccountVaultHttpRoutes } from "./vault/account-http.ts";
import * as AccountEnrollment from "./account-access/AccountEnrollment.ts";
import * as AccountJoin from "./account-access/AccountJoin.ts";
import * as ComputerJoin from "./account-access/ComputerJoin.ts";
import * as AccountAccess from "./account-access/AccountAccess.ts";
import * as AccountHost from "./account-access/AccountHost.ts";
import * as AccountGateway from "./account-access/AccountGateway.ts";
import { AccountAccessRoutes } from "./account-access/http.ts";
import * as DevApiCredentials from "./browser-dev-tools/DevApiCredentials.ts";
import * as DevApiLibrary from "./browser-dev-tools/DevApiLibrary.ts";
import * as DevApi from "./browser-dev-tools/DevApiService.ts";
import * as DevRequests from "./browser-dev-tools/DevRequestsService.ts";
import * as DevDiagnostics from "./browser-dev-tools/DevDiagnosticsService.ts";
import * as DevEnvironment from "./browser-dev-tools/DevEnvironmentService.ts";
import * as DevContainers from "./browser-dev-tools/DevContainersService.ts";
import * as UpstreamSupervisor from "./upstream-supervisor/UpstreamSupervisor.ts";
import * as SessionToolPolicy from "./mcp/SessionToolPolicy.ts";
import { SessionToolContextRoutes } from "./mcp/toolContextHttp.ts";
import * as AttentionRetry from "./attention/AttentionRetry.ts";
import * as ProjectStorageInventory from "./project-lifecycle/ProjectStorageInventory.ts";
import * as StorageAccounting from "./project-lifecycle/StorageCleanupAccounting.ts";
import * as UpdatePlans from "./machine-updates/UpdatePlans.ts";
import * as UpdateRuntime from "./machine-updates/UpdateRuntime.ts";
import * as UpdatePlanStore from "./machine-updates/UpdatePlanStore.ts";
import * as UpdateHandoff from "./machine-updates/UpdateHandoff.ts";
import * as UpdateFence from "./machine-updates/UpdateFence.ts";
import { UpdateHttpRoutes } from "./machine-updates/http.ts";
import * as SkillRegistry from "./skill-registry/SkillRegistryService.ts";
import * as SkillStore from "./skill-registry/SkillStore.ts";
import * as LibraryPublishingCredential from "../auth/LibraryPublishingCredential.ts";
import * as LibraryMaintenance from "./project-library/LibraryMaintenance.ts";
import * as ProjectWorkflows from "./project-library/ProjectWorkflows.ts";
import * as ProjectOperations from "./project-library/ProjectOperations.ts";
import * as ProjectProfiles from "./project-profiles/ProjectProfileService.ts";
import * as ProfileEnvInspector from "./project-profiles/EnvInspectorLive.ts";
import * as ProfileVarlock from "./project-profiles/VarlockRunner.ts";
import * as ProfileBudgets from "./project-profiles/BudgetReactor.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import * as VaultConnections from "./vault/VaultConnections.ts";
import * as VaultAccessInspector from "./vault/VaultAccessInspector.ts";
import * as VaultReadiness from "./vault/VaultReadiness.ts";
import * as VaultTestAccountWorkloads from "./vault/VaultTestAccountWorkloads.ts";
import * as VaultTestAccounts from "./vault/VaultTestAccounts.ts";
import * as OperationAdmission from "./vault/OperationAdmission.ts";
import * as OperationJournal from "./vault/OperationJournal.ts";
import * as ApprovalNotifications from "./vault/ApprovalNotifications.ts";
import * as ApprovalCards from "./vault/ApprovalCards.ts";
import * as VaultMigrationInventory from "./vault/VaultMigrationInventory.ts";
import * as MigrationGitMetadata from "./vault/MigrationGitMetadata.ts";
import * as VaultMigration from "./vault/VaultMigration.ts";
import * as VaultHealthContext from "./vault/VaultHealthContext.ts";
import * as VaultHealth from "./vault/VaultHealth.ts";
import * as VaultHealthChecks from "./vault/VaultHealthChecks.ts";
import * as GitHubRepositoryTransport from "./vault/GitHubRepositoryTransport.ts";
import * as GitHubTerminal from "./vault/GitHubTerminal.ts";
import * as VaultGitHub from "./vault/VaultGitHub.ts";
import * as GitHubTransport from "./vault/GitHubTransport.ts";
import * as GitHubCli from "./vault/GitHubCli.ts";
import * as VaultPromptContext from "./vault/VaultPromptContext.ts";
import * as VaultProfiles from "./vault/VaultProfiles.ts";
import * as VaultReferences from "./vault/VaultReferences.ts";
import * as VaultLaunch from "./vault/VaultLaunch.ts";
import * as BrokerIdentity from "./vault/BrokerIdentity.ts";
import * as VaultSsh from "./vault/VaultSsh.ts";
import * as SshCrypto from "./vault/SshCrypto.ts";
import * as SshTransport from "./vault/SshTransport.ts";
import * as VaultWorkloads from "./vault/VaultWorkloads.ts";
import { VaultWorkloadHttpRoutes } from "./vault/workload-http.ts";
import { VaultBrokerHttpRoutes } from "./vault/broker-http.ts";
import * as VaultBrokers from "./vault/VaultBrokers.ts";
import * as BrokerCrypto from "./vault/BrokerCrypto.ts";
import * as VaultAccess from "./vault/VaultAccess.ts";
import * as VaultPrivateInput from "./vault/VaultPrivateInput.ts";
import {
  layerCore as layerVaultCore,
  layerStore as layerVaultStore,
  layerProviderCredentials,
  layerMachineClient,
} from "./vault/layers.ts";
import * as VaultSecretRequests from "./vault/VaultSecretRequests.ts";
import * as SitesService from "./sites/SitesService.ts";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as LibraryRecoveryPublisher from "./project-library/LibraryRecoveryPublisher.ts";
import * as LibraryRecoveryStore from "./project-library/assets/LibraryRecoveryStore.ts";
import { LibraryRecoveryHttpRoutes } from "./project-library/assets/recoveryHttp.ts";
import * as LibraryDocumentPublication from "./project-library/LibraryDocumentPublication.ts";
import * as LibraryApis from "./project-library/LibraryApiWorkspaces.ts";
import * as LibraryManagement from "./project-library/LibraryManagement.ts";
import * as LibraryPublisher from "./project-library/LibraryPublisher.ts";
import * as LibraryStore from "./project-library/LibraryStore.ts";
import * as LibraryBriefSuggestions from "./project-library/LibraryBriefSuggestions.ts";
import * as LibraryReplication from "./project-library/LibraryReplication.ts";
import * as LibraryActivityPublication from "./project-library/LibraryActivityPublication.ts";
import * as LibraryCopyHealthPublication from "./project-library/LibraryCopyHealthPublication.ts";
import { LibraryHttpRoutes } from "./project-library/http.ts";
import * as LibraryHistorySource from "./project-library/LibraryHistorySource.ts";
import * as StaleConnectLink from "./connect-off/staleConnectLink.ts";
import * as DeletedThreadHistory from "./deleted-history/DeletedThreadHistory.ts";
import * as LibraryAssetService from "./project-library/assets/LibraryAssetService.ts";
import { LibraryAssetHttpRoutes } from "./project-library/assets/http.ts";
import * as LibraryService from "./project-library/LibraryService.ts";
import * as LibraryLocalCatalog from "./project-library/LibraryLocalCatalog.ts";
import * as LibraryTimeline from "./project-library/LibraryTimeline.ts";
import * as LibraryLaunchCandidates from "./project-library/LibraryLaunchCandidates.ts";
import * as LibraryWorkspace from "./project-library/LibraryWorkspace.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as LibraryWorkspaceStore from "./project-library/LibraryWorkspaceStore.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as ProjectCheckoutManagement from "../project/ProjectCheckoutManagement.ts";
import * as StorageCleanup from "../storageCleanup.ts";
import * as GitHubSetupFlow from "../sourceControl/GitHubSetupFlow.ts";
import * as GitHubHostSetup from "../sourceControl/GitHubHostSetup.ts";
import { FetchHttpClient } from "effect/http";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as WorkspaceHandoff from "./workspace-handoff/WorkspaceHandoffService.ts";
import * as MiniSsh from "./mini-offload/MiniSshTransport.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as MiniOffload from "./mini-offload/MiniOffloadService.ts";
import { PcbPreviewHttpRoutes } from "./pcb-preview/http.ts";
import * as PcbPreview from "./pcb-preview/PcbPreviewService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ModelPreview from "./model-preview-3d/ModelPreviewService.ts";
import { ModelPreviewHttpRoutes } from "./model-preview-3d/http.ts";
import * as ProjectLifecycle from "./project-lifecycle/ProjectLifecycleService.ts";
import * as AppleBuild from "./apple-build-tooling/AppleBuildService.ts";
import * as DeviceQa from "./device-qa/DeviceQaService.ts";
import { DeviceQaCleanupLive } from "./device-qa/reactor.ts";
import * as CodeGraph from "./code-graph/CodeGraphService.ts";
import { CodeGraphReactorLive } from "./code-graph/reactor.ts";
import * as AgentReceipts from "./agent-receipts/AgentReceipts.ts";
import {
  AgentReceiptsLive,
  reactorLayer as AgentReceiptsReactor,
} from "./agent-receipts/reactor.ts";
import * as BotOperations from "./bots/BotOperations.ts";
import * as BotCompletions from "./bots/BotCompletions.ts";
import * as BotBatches from "./bots/BotBatches.ts";
import * as Bots from "./bots/BotsService.ts";
import * as BotLibraryClient from "./bots/BotLibraryClient.ts";
import { BotLibraryHttpRoutes } from "./bots/botLibraryHttp.ts";
import * as BotLibraryService from "./bots/BotLibraryService.ts";
import * as BotSharing from "./bots/BotSharing.ts";
import * as BotDrafts from "./bots/fromThread/BotDrafts.ts";
import * as BotTriggers from "./bots/triggers/BotTriggers.ts";
import * as BotPipelines from "./bots/pipelines/BotPipelines.ts";
import * as BotVersions from "./bots/versions/BotVersions.ts";
import { BotTriggerReactorLive } from "./bots/triggers/BotTriggerReactor.ts";
import { BotTriggerScheduleLive } from "./bots/triggers/BotTriggerSchedule.ts";
import * as PreviewLinks from "./preview-links/PreviewLinksService.ts";
import * as PreviewAccess from "./preview-access/PreviewAccessService.ts";
import { PreviewAccessHttpRoutes } from "./preview-access/http.ts";
import * as PageLibrary from "./preview-pages/PageLibraryService.ts";
import { PagesHostLive } from "./preview-pages/host.ts";
import { PageLibraryHttpRoutes } from "./preview-pages/libraryHttp.ts";
import * as PreviewPages from "./preview-pages/PreviewPagesService.ts";
import * as Directory from "./directory/DirectoryService.ts";
import * as DirectoryReporter from "./directory/DirectoryReporter.ts";
import { DirectoryHttpRoutes } from "./directory/http.ts";
import { CloudflaredExtraPorts } from "./cloudflared/connector.ts";
import * as ReachService from "./reach/ReachService.ts";
import { ReachGuardLayer } from "./reach/guard.ts";
import * as CloudflareAccess from "./cloudflare-access/CloudflareAccess.ts";
import * as ReachStore from "./reach/library/ReachStore.ts";
import * as ReachCloudflare from "./reach/library/ReachCloudflare.ts";
import * as ReachPocketId from "./reach/library/ReachPocketId.ts";
import * as ReachProvisioner from "./reach/library/ReachProvisioner.ts";
import { ReachHttpRoutes } from "./reach/library/http.ts";
import { LibraryPushLive } from "./library-push/LibraryPushService.ts";
import { AgentAlertsLive } from "./library-push/AgentAlerts.ts";
import { ScheduledFailureAlertsLive } from "./library-push/ScheduledFailureAlerts.ts";
import * as LibraryPushReadiness from "./library-push/LibraryPushReadiness.ts";
import * as UnheardAlertNotices from "./library-push/UnheardAlertNotices.ts";
import * as VaultApprovalAlerts from "./library-push/VaultApprovalAlerts.ts";
import * as LibraryConnection from "./project-library/LibraryConnection.ts";
import { LibraryPushHttpRoutes } from "./library-push/http.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ForkRuntime, type ForkServices } from "./ForkRuntime.ts";
import { ForkMigrationsLive } from "./persistence/migrations.ts";
import { SwitchboardLive } from "./switchboard/switchboard.ts";
import * as SwitchboardStatus from "./switchboard/SwitchboardStatus.ts";

const layerVaultTestAccounts = VaultTestAccounts.layer.pipe(
  Layer.provide(Layer.merge(layerVaultCore, layerVaultStore)),
);
// Agent and Vault alerts the Library accepted for no iPhone say so in their thread.
const layerUnheardAlertNotices = UnheardAlertNotices.layer.pipe(
  Layer.provide(
    Layer.mergeAll(RuntimeLayer.layerEventSink, ProjectionStore.layer, ThreadCommandExecutor.layer),
  ),
);
// New approval requests alert the owner's iPhones through the one Library push instance.
const layerApprovalNotifications = ApprovalNotifications.layer.pipe(
  Layer.provide(
    VaultApprovalAlerts.layer.pipe(
      Layer.provide(
        Layer.mergeAll(LibraryPushLive, LibraryConnection.layer, layerUnheardAlertNotices),
      ),
      Layer.provide(FetchHttpClient.layer),
    ),
  ),
);
const layerVaultAccess = VaultAccess.layer.pipe(
  Layer.provide(Layer.suspend(() => layerAccountVaultClient)),
  Layer.provide(layerApprovalNotifications),
  Layer.provide(Layer.mergeAll(layerVaultCore, layerVaultStore, ProjectStore.layer)),
);
const layerApprovalCards = ApprovalCards.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerVaultCore,
      RuntimeLayer.layerEventSink,
      ProjectionStore.layer,
      ThreadCommandExecutor.layer,
    ),
  ),
);

const layerVaultTestAccountWorkloads = VaultTestAccountWorkloads.layer.pipe(
  Layer.provide(
    Layer.mergeAll(layerVaultTestAccounts, layerVaultCore, layerVaultAccess, ProjectStore.layer),
  ),
);

const layerVaultConnections = VaultConnections.layer.pipe(
  Layer.provide(Layer.suspend(() => layerAccountVaultClient)),
  Layer.provide(Layer.mergeAll(layerVaultCore, layerVaultAccess, layerVaultStore)),
);
const layerVaultBrokers = VaultBrokers.layer.pipe(
  Layer.provide(Layer.merge(layerVaultStore, BrokerCrypto.layer)),
);
const layerVaultWorkloads = VaultWorkloads.layer.pipe(
  Layer.provide(Layer.mergeAll(layerVaultBrokers, layerVaultAccess, BrokerCrypto.layer)),
);

const layerVaultSsh = VaultSsh.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerVaultCore,
      layerVaultWorkloads,
      SshCrypto.layer,
      SshTransport.layer.pipe(Layer.provide(SshCrypto.layer)),
      Layer.suspend(() => layerAccountVaultSsh),
    ),
  ),
);

const layerVaultHealth = VaultHealth.layer.pipe(
  Layer.provide(Layer.merge(layerVaultStore, layerVaultCore)),
);

const layerVaultGitHub = VaultGitHub.layer.pipe(
  Layer.provide(Layer.suspend(() => layerAccountVaultClient)),
  Layer.provide(
    Layer.mergeAll(
      layerVaultCore,
      layerVaultHealth,
      layerVaultAccess,
      layerVaultConnections,
      GitHubTransport.layer.pipe(Layer.provide(FetchHttpClient.layer)),
      FetchHttpClient.layer,
      GitHubCli.layer,
      GitHubTerminal.layer,
      GitHubRepositoryTransport.layer,
      ProjectStore.layer,
    ),
  ),
);

const layerVaultProfileRecords = VaultProfileRecords.layer.pipe(
  Layer.provide(Layer.merge(layerVaultStore, layerMachineClient)),
);
const layerVaultProfiles = VaultProfiles.layer.pipe(
  Layer.provide(layerMachineClient),
  Layer.provide(Layer.suspend(() => layerAccountVaultClient)),
  Layer.provide(
    Layer.mergeAll(
      layerVaultStore,
      layerVaultAccess,
      layerVaultSsh,
      layerVaultGitHub,
      ProjectStore.layer,
    ),
  ),
);
const layerVaultHealthContext = VaultHealthContext.layer.pipe(
  Layer.provide(
    Layer.mergeAll(layerVaultCore, layerVaultProfiles, layerVaultAccess, ProjectStore.layer),
  ),
);
const layerVaultAccessInspector = VaultAccessInspector.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerVaultAccess,
      layerVaultCore,
      layerVaultProfiles,
      layerVaultWorkloads,
      layerVaultBrokers,
    ),
  ),
);
const layerVaultReadiness = VaultReadiness.layer.pipe(
  Layer.provide(Layer.mergeAll(layerVaultAccess, layerVaultWorkloads, layerVaultProfiles)),
);
const layerVaultReferences = VaultReferences.layer.pipe(
  Layer.provide(Layer.merge(layerVaultCore, layerVaultAccess)),
);

const layerLibraryRecovery = LibraryRecoveryStore.layer.pipe(
  Layer.provide(NodeHttpClient.layerNodeHttp),
);
const layerLibraryAssets = LibraryAssetService.layer.pipe(Layer.provide(FetchHttpClient.layer));
const layerLibraryService = LibraryService.layer.pipe(
  Layer.provide(LibraryLocalCatalog.layer.pipe(Layer.provide(LibraryWorkspaceStore.layer))),
  Layer.provide(layerLibraryAssets),
  Layer.provide(layerLibraryRecovery),
);

const layerProjectWorkflows = ProjectWorkflows.layer.pipe(Layer.provide(layerLibraryService));
const layerLibraryPublisher = LibraryPublisher.layer.pipe(
  Layer.provide(layerProjectWorkflows),
  Layer.provide(LibraryTimeline.layer),
  Layer.provide(LibraryLaunchCandidates.layer.pipe(Layer.provide(layerLibraryService))),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(layerLibraryService),
  Layer.provide(layerLibraryAssets),
  Layer.provide(PreviewAccess.layer),
);
export const layerProjectLifecycle = ProjectLifecycle.layer.pipe(
  Layer.provide(RuntimeLayer.layerProjectSetupScriptRunner),
  Layer.provide(WorktreeSetupTracker.layer),
  Layer.provide(ProjectionStore.layer),
  Layer.provide(RuntimeLayer.layerThreadSettlement),
  Layer.provide(ProjectStore.layer),
  Layer.provide(RuntimeLayer.layerThreadManagementProvided),
  Layer.provide(RuntimeLayer.layerProjectService),
  // Runtime callers acquire this shared layer before ForkLayer's migration boundary.
  Layer.provide(ForkMigrationsLive),
);

export const layerLibraryWorkspace = LibraryWorkspace.layer.pipe(
  Layer.provide(StorageAccounting.layer),
  Layer.provide(
    LibraryRecoveryPublisher.layer.pipe(
      Layer.provide(NodeHttpClient.layerNodeHttp),
      Layer.provide(layerLibraryRecovery),
    ),
  ),
  Layer.provide(LibraryWorkspaceStore.layer),
  Layer.provide(RuntimeLayer.layerProjectService),
  Layer.provide(ProjectionStore.layer),
  Layer.provide(ProcessRunner.layer),
  Layer.provide(layerLibraryPublisher),
  // The same layers as storage cleanup and the setup card, so mirror locks and progress are shared.
  Layer.provide(RuntimeLayer.layerLibraryGitFetch),
  Layer.provide(WorktreeSetupTracker.layer),
);
const layerLibraryHistorySource = LibraryHistorySource.layer.pipe(
  Layer.provide(LibraryWorkspaceStore.layer),
  Layer.provide(ProjectionStore.layer),
);
// One reach store, so the directory refuses to forget a computer the provisioner still serves (F2).
const layerReachStore = ReachStore.layer;
const layerDirectory = Directory.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(layerReachStore),
);
const layerAccountWorkloads = AccountWorkloads.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerLibraryPublisher,
      layerDirectory,
      layerReachStore,
      LibraryConnection.layer,
      RuntimeLayer.layerThreadManagementProvided,
    ),
  ),
);
const layerAccountAccess = AccountAccess.layer.pipe(
  Layer.provide(Layer.mergeAll(layerDirectory, layerReachStore, LibraryStore.layer)),
);
const layerAccountVaultMachineAuthority = AccountVaultMachineAuthority.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerAccountWorkloads,
      layerProviderCredentials,
      layerVaultProfileRecords,
      layerVaultProfiles,
    ),
  ),
);
const layerAccountVaultAuthority = AccountVaultAuthority.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerAccountWorkloads,
      layerVaultStore,
      layerVaultAccess,
      layerVaultCore,
      layerVaultConnections,
      SshCrypto.layer,
      layerVaultGitHub,
    ),
  ),
);
const layerAccountVaultClient = AccountVaultClient.layer.pipe(
  Layer.provide(Layer.mergeAll(layerAccountWorkloads, LibraryConnection.layer)),
  Layer.provide(FetchHttpClient.layer),
);
const layerAccountVaultSsh = AccountVaultSsh.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerAccountVaultClient,
      SshTransport.layer.pipe(Layer.provide(SshCrypto.layer)),
      RuntimeLayer.layerThreadManagementProvided,
      ProjectStore.layer,
    ),
  ),
);
const layerAccountGateway = AccountGateway.layer.pipe(
  Layer.provideMerge(layerAccountAccess),
  Layer.provide(NodeHttpClient.layerUndici),
);
const layerAccountHost = AccountHost.layer.pipe(
  Layer.provide(LibraryConnection.layer),
  Layer.provide(NodeHttpClient.layerUndici),
);

export const layerReachLibrary = ReachProvisioner.layer.pipe(
  Layer.provide(
    Layer.merge(ReachCloudflare.layer, ReachPocketId.layer).pipe(
      Layer.provide(FetchHttpClient.layer),
    ),
  ),
  Layer.provideMerge(Layer.merge(layerDirectory, layerReachStore)),
);

const layerSites = SitesService.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(layerLibraryService),
  Layer.provide(LibraryConnection.layer),
);
const layerLibraryManagement = LibraryManagement.layer.pipe(
  Layer.provide(layerSites),
  Layer.provide(LibraryApis.layer.pipe(Layer.provide(layerLibraryService))),
  Layer.provide(layerProjectWorkflows),
  Layer.provide(layerLibraryService),
  Layer.provide(layerLibraryPublisher),
  Layer.provide(layerDirectory),
  Layer.provide(LibraryConnection.layer),
  Layer.provide(RuntimeLayer.layerThreadManagementProvided),
);

const layerMiniOffload = MiniOffload.layer.pipe(
  Layer.provide(
    Layer.mergeAll(ProjectionStore.layer, ProjectStore.layer, MiniSsh.layer, ProcessRunner.layer),
  ),
);

const layerDirectoryReporter = DirectoryReporter.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(layerMiniOffload),
);

const layerVaultOwnerLink = VaultOwnerLink.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerVaultAccess,
      layerLibraryManagement,
      layerLibraryService,
      layerLibraryPublisher,
      layerDirectory,
      layerDirectoryReporter,
      LibraryConnection.layer,
    ),
  ),
);

const layerVaultHealthChecks = VaultHealthChecks.layer.pipe(
  Layer.provide(Layer.mergeAll(layerVaultHealth, layerVaultGitHub, layerVaultSsh)),
);

const layerVaultJournal = OperationJournal.layer.pipe(
  Layer.provide(Layer.merge(layerVaultAccess, layerVaultStore)),
);
const layerVaultLaunch = VaultLaunch.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerVaultProfiles,
      layerVaultGitHub,
      layerVaultSsh,
      layerVaultConnections,
      layerVaultWorkloads,
      BrokerCrypto.layer,
      layerAccountVaultSsh,
      BrokerIdentity.layer.pipe(Layer.provide(BrokerCrypto.layer)),
      ProjectStore.layer,
    ),
  ),
);
const layerOperationAdmission = OperationAdmission.layer.pipe(
  Layer.provide(
    Layer.mergeAll(layerVaultJournal, layerVaultAccess, layerVaultLaunch, layerVaultGitHub),
  ),
);

const layerProjectProfiles = ProjectProfiles.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      ProjectStore.layer,
      ProjectionStore.layer,
      ProfileEnvInspector.layer,
      ProfileVarlock.layer.pipe(Layer.provide(ProcessRunner.layer)),
    ),
  ),
);
const layerDevEnvironment = DevEnvironment.layer.pipe(
  Layer.provide(Layer.mergeAll(ProjectStore.layer, ProjectionStore.layer, layerProjectProfiles)),
);
const layerDevRequests = DevRequests.layer.pipe(
  Layer.provide(layerDevEnvironment),
  Layer.provide(FetchHttpClient.layer),
);
const layerDevApi = DevApi.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerDevEnvironment,
      layerDevRequests,
      ProcessRunner.layer,
      DevApiCredentials.layer.pipe(Layer.provide(Layer.mergeAll(layerVaultCore, layerVaultAccess))),
    ),
  ),
);
const layerDevContainers = DevContainers.layer.pipe(
  Layer.provide(layerDevEnvironment),
  Layer.provide(ProcessRunner.layer),
);
// Credential preparation runs before the full fork runtime; share these exact layer instances.
export const layerSessionToolPolicy = SessionToolPolicy.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerProjectProfiles,
      layerSites,
      layerDirectory,
      LibraryConnection.layer,
      LibraryWorkspaceStore.layer,
      ProjectStore.layer,
      ProjectionStore.layer,
    ),
  ),
  Layer.provide(ForkMigrationsLive),
);

const layerAccountEnrollment = AccountEnrollment.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      layerLibraryManagement,
      layerDirectory,
      layerLibraryPublisher,
      layerDirectoryReporter,
      layerReachLibrary,
      LibraryPublishingCredential.layer,
      LibraryConnection.layer,
      ReachService.layer,
    ),
  ),
);
const layerAccountJoin = AccountJoin.layer.pipe(
  Layer.provide(Layer.merge(layerAccountEnrollment, layerLibraryManagement)),
);
const layerComputerJoin = ComputerJoin.layer.pipe(
  Layer.provide(Layer.merge(layerAccountEnrollment, LibraryConnection.layer)),
  Layer.provide(FetchHttpClient.layer),
);

/** Packet service layers, one line each. Keep `Layer.empty` first. */
const ForkServicesLive = Layer.mergeAll(
  layerDevApi,
  DevApiLibrary.layer.pipe(
    Layer.provide(layerDevApi),
    Layer.provide(layerLibraryManagement),
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(layerDevEnvironment),
    Layer.provide(RuntimeLayer.layerThreadManagementProvided),
  ),
  layerDevRequests,
  DevDiagnostics.layer.pipe(Layer.provide(layerDevEnvironment)),
  layerDevEnvironment,
  layerDevContainers,
  ProjectStorageInventory.layer.pipe(
    Layer.provide(RuntimeLayer.layerStorageCleanup),
    Layer.provide(layerProjectLifecycle),
    Layer.provide(RuntimeLayer.layerLibraryGitFetch),
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(StorageAccounting.layer),
    Layer.provide(ProjectionStore.layer),
    Layer.provide(ProjectStore.layer),
  ),
  UpdatePlans.layer.pipe(
    Layer.provideMerge(
      UpdateHandoff.layer.pipe(
        Layer.provide(
          Layer.mergeAll(ProjectionStore.layer, UpdateFence.layer, UpdatePlanStore.layer),
        ),
      ),
    ),
    Layer.provide(UpdatePlanStore.layer),
    Layer.provide(UpdateRuntime.layer),
  ),
  AttentionRetry.layer.pipe(Layer.provide(RuntimeLayer.layerThreadManagementProvided)),
  SkillRegistry.layer.pipe(
    Layer.provide(SkillStore.layer),
    Layer.provide(RuntimeLayer.layerProjectService),
    Layer.provide(ProcessRunner.layer),
  ),
  Layer.empty,
  LibraryPublishingCredential.layer,
  layerAccountEnrollment,
  layerAccountWorkloads,
  layerAccountVaultAuthority,
  layerAccountVaultMachineAuthority,
  layerAccountVaultClient,
  layerAccountVaultSsh,
  layerAccountJoin,
  layerComputerJoin,
  // A retired Connect build drops stale Connect secrets before upstream relay code reads them.
  StaleConnectLink.layer,
  layerProjectProfiles,
  layerSessionToolPolicy,
  ProfileBudgets.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        RuntimeLayer.layerEventSink,
        ProjectionStore.layer,
        ThreadCommandExecutor.layer,
      ),
    ),
  ),
  VaultMigrationInventory.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        layerVaultStore,
        layerVaultCore,
        layerVaultSsh,
        layerVaultGitHub,
        ProjectStore.layer,
        MigrationGitMetadata.layer,
      ),
    ),
  ),
  VaultMigration.layer.pipe(
    Layer.provide(Layer.mergeAll(layerVaultStore, layerVaultCore, SshCrypto.layer)),
  ),
  layerVaultHealth,
  layerVaultHealthContext,
  VaultHealthChecks.reactor.pipe(Layer.provideMerge(layerVaultHealthChecks)),
  layerVaultGitHub,
  UpstreamSupervisor.layer.pipe(Layer.provide(layerVaultGitHub)),
  VaultPromptContext.layer.pipe(
    Layer.provide(Layer.merge(layerVaultProfiles, layerVaultReferences)),
  ),
  layerVaultAccessInspector,
  layerVaultConnections,
  layerVaultReadiness,
  layerVaultProfiles,
  layerVaultReferences,
  layerVaultLaunch,
  layerVaultSsh,
  layerVaultBrokers,
  layerVaultWorkloads,
  layerVaultTestAccountWorkloads,
  VaultTestAccountWorkloads.reactor.pipe(Layer.provide(layerVaultTestAccountWorkloads)),
  layerVaultTestAccounts,
  layerVaultCore,
  layerVaultAccess,
  layerVaultOwnerLink,
  layerVaultJournal,
  layerOperationAdmission,
  ApprovalCards.reactor.pipe(
    Layer.provide(Layer.merge(layerApprovalCards, layerApprovalNotifications)),
  ),
  VaultAccess.reactor.pipe(Layer.provide(layerVaultAccess)),
  VaultSecretRequests.layer.pipe(Layer.provide(Layer.merge(layerVaultCore, layerVaultAccess))),
  VaultPrivateInput.layer.pipe(Layer.provide(Layer.merge(layerVaultCore, layerVaultAccess))),
  layerSites,
  layerLibraryService,
  layerLibraryManagement,
  LibraryMaintenance.retentionLayer.pipe(Layer.provide(layerLibraryService)),
  layerProjectWorkflows,
  ProjectOperations.layer.pipe(
    Layer.provide(layerVaultGitHub),
    Layer.provide(layerLibraryPublisher),
    Layer.provide(layerLibraryManagement),
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(layerProjectWorkflows),
    Layer.provide(layerLibraryService),
    Layer.provide(layerLibraryWorkspace),
    Layer.provide(RuntimeLayer.layerThreadManagementProvided),
  ),
  layerLibraryPublisher,
  LibraryTimeline.layer,
  LibraryLaunchCandidates.layer.pipe(Layer.provide(layerLibraryService)),
  LibraryReplication.layer.pipe(
    Layer.provide(LibraryDocumentPublication.layerSource.pipe(Layer.provide(ProcessRunner.layer))),
    Layer.provide(layerLibraryWorkspace),
    Layer.provide(layerLibraryPublisher),
    Layer.provide(layerLibraryHistorySource),
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(
      LibraryCopyHealthPublication.layerSource.pipe(Layer.provide(ProcessRunner.layer)),
    ),
  ),
  layerLibraryAssets,
  layerLibraryRecovery,
  layerLibraryHistorySource,
  DeletedThreadHistory.layer.pipe(
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(ProjectionStore.layer),
    Layer.provide(layerLibraryPublisher),
  ),
  layerLibraryWorkspace,
  ProjectCheckoutManagement.layer.pipe(
    Layer.provide(ProcessRunner.layer),
    Layer.provide(StorageCleanup.layer.pipe(Layer.provide(RuntimeLayer.layerLibraryGitFetch))),
    Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
  ),
  GitHubSetupFlow.layer.pipe(
    Layer.provide(GitHubHostSetup.layer.pipe(Layer.provide(FetchHttpClient.layer))),
  ),
  layerMiniOffload,
  LibraryActivityPublication.layer.pipe(
    Layer.provide(layerLibraryPublisher),
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(
      LibraryActivityPublication.layerSource.pipe(
        Layer.provide(layerMiniOffload),
        Layer.provide(ProjectionStore.layer),
      ),
    ),
  ),
  SwitchboardLive,
  SwitchboardStatus.layer,
  WorkspaceHandoff.layer.pipe(
    Layer.provide(CommandReceiptStore.layer),
    Layer.provide(layerProjectLifecycle),
    Layer.provide(ProjectionStore.layer),
  ),
  PcbPreview.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
  ModelPreview.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
  // Apple builds run in L19 lanes, so both share the one ProjectLifecycle instance.
  AppleBuild.layer.pipe(
    Layer.provideMerge(layerProjectLifecycle),
    Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
  ),
  // The cleanup reactor shares the Device QA service it cleans for.
  DeviceQaCleanupLive.pipe(
    Layer.provideMerge(
      DeviceQa.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
    ),
  ),
  // Batches, pipelines, triggers and replays feed runs through the one BotsService instance.
  Layer.mergeAll(
    BotTriggerReactorLive,
    BotCompletions.BotCompletionsRecoveryLive.pipe(
      Layer.provideMerge(BotCompletions.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    ),
    BotTriggerScheduleLive,
    BotVersions.BotVersionsRecoveryLive.pipe(Layer.provideMerge(BotVersions.layer)),
    BotSharing.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          LibraryWorkspaceStore.layer,
          layerVaultReferences,
          layerVaultCore,
          layerLibraryWorkspace,
          layerDirectory,
        ),
      ),
    ),
  ).pipe(
    Layer.provideMerge(BotOperations.layer),
    Layer.provideMerge(BotTriggers.layer),
    Layer.provideMerge(
      BotPipelines.BotPipelinesRecoveryLive.pipe(Layer.provideMerge(BotPipelines.layer)),
    ),
    Layer.provideMerge(
      BotBatches.BotBatchesRecoveryLive.pipe(
        Layer.provideMerge(BotBatches.layer.pipe(Layer.provide(ProjectStore.layer))),
        Layer.provideMerge(Bots.BotsRecoveryLive.pipe(Layer.provideMerge(Bots.layer))),
      ),
    ),
    // The Library routes and this computer's client share one store and its wake-up signals.
    Layer.provideMerge(BotLibraryClient.layer.pipe(Layer.provide(FetchHttpClient.layer))),
    Layer.provideMerge(BotLibraryService.layer),
  ),
  BotDrafts.BotSuggestionsReactorLive.pipe(Layer.provideMerge(BotDrafts.layer)),
  CodeGraphReactorLive.pipe(
    Layer.provideMerge(
      CodeGraph.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
    ),
  ),
  // RPC, MCP and the reactor share one receipts service.
  AgentReceiptsLive.pipe(
    Layer.provide(AgentReceiptsReactor),
    Layer.provideMerge(AgentReceipts.layer.pipe(Layer.provide(ProjectionStore.layer))),
  ),
  // Agent links end with their lane, so this watches the one ProjectLifecycle instance too.
  PreviewLinks.layer.pipe(
    Layer.provide(layerProjectLifecycle),
    Layer.provide(layerLibraryPublisher),
    // The reach connector's metrics port is this server's own, not a lane's.
    Layer.provide(
      Layer.effect(
        CloudflaredExtraPorts,
        Effect.map(ReachService.ReachService, (reach) => ({ ports: reach.ownPorts })),
      ).pipe(Layer.provide(ReachService.layer)),
    ),
  ),
  // The pages host serves the pages the Library routes store and checks tickets with the same
  // key the Library signs them with, so it shares both instances.
  PagesHostLive.pipe(Layer.provideMerge(Layer.merge(PageLibrary.layer, PreviewAccess.layer))),
  PreviewPages.layer.pipe(Layer.provide(ProjectStore.layer), Layer.provide(layerLibraryPublisher)),
  // The reactor runs suggestions for the service MCP and RPC also call.
  LibraryBriefSuggestions.BriefSuggestionsReactorLive.pipe(
    Layer.provideMerge(
      LibraryBriefSuggestions.layer.pipe(
        Layer.provide(layerLibraryPublisher),
        Layer.provide(layerLibraryService),
        Layer.provide(LibraryWorkspaceStore.layer),
      ),
    ),
  ),
  layerReachLibrary,
  layerAccountGateway,
  layerAccountHost,
  // The same instance the preview port check reads, so RPC, MCP and the guard see one connector.
  ReachService.layer,
  // On the Library, alerts for its own threads go straight to this one push service instance.
  AgentAlertsLive.pipe(
    Layer.provideMerge(LibraryPushLive),
    Layer.provide(layerUnheardAlertNotices),
    Layer.provide(FetchHttpClient.layer),
  ),
  ScheduledFailureAlertsLive.pipe(
    Layer.provide(LibraryPushLive),
    Layer.provide(FetchHttpClient.layer),
  ),
  // `loom_push_status` reads the Library's push here, or asks the Library from another computer.
  LibraryPushReadiness.layer.pipe(
    Layer.provide(Layer.merge(LibraryPushLive, LibraryConnection.layer)),
    Layer.provide(FetchHttpClient.layer),
  ),
  // Reads the worker identities the one Mini instance keeps from its readiness checks.
  DirectoryReporter.DirectoryReporterLive.pipe(Layer.provideMerge(layerDirectoryReporter)),
);

/**
 * Merged at the head of RuntimeCoreDependenciesLive (apps/server/src/server.ts,
 * fork: ext-core). Fork migrations run first, then packet services, then the
 * services' context is published as ForkRuntime.
 */
export const ForkLayer = Layer.effect(ForkRuntime, Effect.context<ForkServices>()).pipe(
  Layer.provideMerge(ForkServicesLive),
  Layer.provideMerge(ForkMigrationsLive),
);

/** Fork HTTP routes, all under /api/loom/. One line per packet. Keep `Layer.empty` first. */
export const ForkRoutesLayer = Layer.mergeAll(
  UpdateHttpRoutes,
  Layer.empty,
  SessionToolContextRoutes,
  VaultBrokerHttpRoutes,
  VaultWorkloadHttpRoutes,
  AccountVaultHttpRoutes,
  VaultOwnerLinkHttpRoutes,
  LibraryAssetHttpRoutes,
  LibraryRecoveryHttpRoutes,
  LibraryHttpRoutes,
  ModelPreviewHttpRoutes,
  PcbPreviewHttpRoutes,
  PreviewAccessHttpRoutes,
  PageLibraryHttpRoutes,
  DirectoryHttpRoutes,
  AccountAccessRoutes,
  BotLibraryHttpRoutes,
  ReachHttpRoutes,
  LibraryPushHttpRoutes,
  // Global, so it also covers upstream routes such as /mcp and requests no route matches.
  ReachGuardLayer,
  CloudflareAccess.guardLayer.pipe(
    Layer.provide(CloudflareAccess.layer),
    Layer.provide(FetchHttpClient.layer),
  ),
);
