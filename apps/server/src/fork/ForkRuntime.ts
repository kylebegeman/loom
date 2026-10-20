import type { OperationJournal } from "./vault/OperationJournal.ts";
import type { VaultMigrationInventory } from "./vault/VaultMigrationInventory.ts";
import type { VaultMigration } from "./vault/VaultMigration.ts";
import type { VaultHealthContext } from "./vault/VaultHealthContext.ts";
import type { VaultHealth } from "./vault/VaultHealth.ts";
import type { VaultHealthChecks } from "./vault/VaultHealthChecks.ts";
import type { VaultGitHub } from "./vault/VaultGitHub.ts";
import type { VaultProfiles } from "./vault/VaultProfiles.ts";
import type { VaultReferences } from "./vault/VaultReferences.ts";
import type { VaultLaunch } from "./vault/VaultLaunch.ts";
import type { VaultSsh } from "./vault/VaultSsh.ts";
import type { VaultWorkloads } from "./vault/VaultWorkloads.ts";
import type { VaultBrokers } from "./vault/VaultBrokers.ts";
import type { VaultAccess } from "./vault/VaultAccess.ts";
import type { VaultPrivateInput } from "./vault/VaultPrivateInput.ts";
import type { VaultCore } from "./vault/VaultCore.ts";
import type { SitesService } from "./sites/SitesService.ts";
import type { LibraryRecoveryStore } from "./project-library/assets/LibraryRecoveryStore.ts";
import type { LibraryReplication } from "./project-library/LibraryReplication.ts";
import type { LibraryHistorySource } from "./project-library/LibraryHistorySource.ts";
import type { LibraryAssetService } from "./project-library/assets/LibraryAssetService.ts";
import type { LibraryBriefSuggestions } from "./project-library/LibraryBriefSuggestions.ts";
import type { LibraryService } from "./project-library/LibraryService.ts";
import type { LibraryTimeline } from "./project-library/LibraryTimeline.ts";
import type { LibraryLaunchCandidates } from "./project-library/LibraryLaunchCandidates.ts";
import type { LibraryWorkspace } from "./project-library/LibraryWorkspace.ts";
import type { ProjectCheckoutManagement } from "../project/ProjectCheckoutManagement.ts";
import type { ComputerNaming } from "./computer-naming/ComputerNaming.ts";
import type { GitHubSetupFlow } from "../sourceControl/GitHubSetupFlow.ts";
import type { WorkspaceHandoffService } from "./workspace-handoff/WorkspaceHandoffService.ts";
import type { MiniOffloadService } from "./mini-offload/MiniOffloadService.ts";
import type { PcbPreviewService } from "./pcb-preview/PcbPreviewService.ts";
import type { ModelPreviewService } from "./model-preview-3d/ModelPreviewService.ts";
import type { ProjectLifecycleService } from "./project-lifecycle/ProjectLifecycleService.ts";
import type { AppleBuildService } from "./apple-build-tooling/AppleBuildService.ts";
import type { DeviceQaService } from "./device-qa/DeviceQaService.ts";
import type { CodeGraphService } from "./code-graph/CodeGraphService.ts";
import type { BotBatches } from "./bots/BotBatches.ts";
import type { BotsService } from "./bots/BotsService.ts";
import type { BotLibraryClient } from "./bots/BotLibraryClient.ts";
import type { BotLibraryService } from "./bots/BotLibraryService.ts";
import type { BotSharing } from "./bots/BotSharing.ts";
import type { BotDrafts } from "./bots/fromThread/BotDrafts.ts";
import type { BotTriggers } from "./bots/triggers/BotTriggers.ts";
import type { BotPipelines } from "./bots/pipelines/BotPipelines.ts";
import type { BotVersions } from "./bots/versions/BotVersions.ts";
import type { SwitchboardStatus } from "./switchboard/SwitchboardStatus.ts";
import type { PreviewLinksService } from "./preview-links/PreviewLinksService.ts";
import type { PreviewAccessService } from "./preview-access/PreviewAccessService.ts";
import type { PageLibraryService } from "./preview-pages/PageLibraryService.ts";
import type { PreviewPagesService } from "./preview-pages/PreviewPagesService.ts";
import type { DirectoryReporter } from "./directory/DirectoryReporter.ts";
import type { DirectoryService } from "./directory/DirectoryService.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** Every service a packet adds to ForkLayer. Packets append `| TheirService`. */
export type ForkServices =
  | OperationJournal
  | VaultMigrationInventory
  | VaultMigration
  | VaultHealth
  | VaultHealthContext
  | VaultHealthChecks
  | VaultGitHub
  | VaultProfiles
  | VaultReferences
  | VaultLaunch
  | VaultSsh
  | VaultWorkloads
  | VaultBrokers
  | VaultAccess
  | VaultCore
  | VaultPrivateInput
  | SitesService
  | LibraryRecoveryStore
  | LibraryReplication
  | LibraryHistorySource
  | LibraryAssetService
  | LibraryService
  | LibraryTimeline
  | LibraryLaunchCandidates
  | LibraryWorkspace
  | ProjectCheckoutManagement
  | ComputerNaming
  | GitHubSetupFlow
  | MiniOffloadService
  | ModelPreviewService
  | PcbPreviewService
  | ProjectLifecycleService
  | AppleBuildService
  | DeviceQaService
  | CodeGraphService
  | BotsService
  | BotBatches
  | BotDrafts
  | BotTriggers
  | BotVersions
  | BotPipelines
  | BotLibraryService
  | BotLibraryClient
  | BotSharing
  | WorkspaceHandoffService
  | SwitchboardStatus
  | LibraryBriefSuggestions
  | PreviewLinksService
  | PreviewAccessService
  | PageLibraryService
  | PreviewPagesService
  | DirectoryService
  | DirectoryReporter;

/** ForkLayer publishes its services without adding requirements to upstream transports. */
export class ForkRuntime extends Context.Reference<Context.Context<ForkServices> | undefined>(
  "loom/ForkRuntime",
  { defaultValue: () => undefined },
) {}

/** The caller's context wins, keeping request resources in the request's scope. */
export const withForkRuntime = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, ForkServices>> =>
  Effect.flatMap(ForkRuntime, (context) =>
    context === undefined
      ? Effect.die(new Error("The Loom server runtime is not installed."))
      : Effect.updateContext(
          effect,
          (current) => Context.merge(context, current) as Context.Context<R>,
        ),
  );
