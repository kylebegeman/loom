import * as SitesService from "./sites/SitesService.ts";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as LibraryRecoveryPublisher from "./project-library/LibraryRecoveryPublisher.ts";
import * as LibraryRecoveryStore from "./project-library/assets/LibraryRecoveryStore.ts";
import { LibraryRecoveryHttpRoutes } from "./project-library/assets/recoveryHttp.ts";
import * as LibraryPublisher from "./project-library/LibraryPublisher.ts";
import * as LibraryBriefSuggestions from "./project-library/LibraryBriefSuggestions.ts";
import * as LibraryReplication from "./project-library/LibraryReplication.ts";
import * as LibraryActivityPublication from "./project-library/LibraryActivityPublication.ts";
import * as LibraryCopyHealthPublication from "./project-library/LibraryCopyHealthPublication.ts";
import { LibraryHttpRoutes } from "./project-library/http.ts";
import * as LibraryHistorySource from "./project-library/LibraryHistorySource.ts";
import * as LibraryAssetService from "./project-library/assets/LibraryAssetService.ts";
import { LibraryAssetHttpRoutes } from "./project-library/assets/http.ts";
import * as LibraryService from "./project-library/LibraryService.ts";
import * as LibraryTimeline from "./project-library/LibraryTimeline.ts";
import * as LibraryLaunchCandidates from "./project-library/LibraryLaunchCandidates.ts";
import * as LibraryWorkspace from "./project-library/LibraryWorkspace.ts";
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
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ForkRuntime, type ForkServices } from "./ForkRuntime.ts";
import { ForkMigrationsLive } from "./persistence/migrations.ts";
import { SwitchboardLive } from "./switchboard/switchboard.ts";
import * as SwitchboardStatus from "./switchboard/SwitchboardStatus.ts";

const layerLibraryRecovery = LibraryRecoveryStore.layer.pipe(
  Layer.provide(NodeHttpClient.layerNodeHttp),
);
const layerLibraryAssets = LibraryAssetService.layer.pipe(Layer.provide(FetchHttpClient.layer));
const layerLibraryPublisher = LibraryPublisher.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(LibraryService.layer.pipe(Layer.provide(layerLibraryAssets))),
  Layer.provide(layerLibraryAssets),
);
const layerMiniOffload = MiniOffload.layer.pipe(
  Layer.provide(
    Layer.mergeAll(ProjectionStore.layer, ProjectStore.layer, MiniSsh.layer, ProcessRunner.layer),
  ),
);

/** Packet service layers, one line each. Keep `Layer.empty` first. */
const ForkServicesLive = Layer.mergeAll(
  Layer.empty,
  SitesService.layer.pipe(Layer.provide(FetchHttpClient.layer)),
  LibraryService.layer.pipe(Layer.provide(layerLibraryAssets)),
  LibraryTimeline.layer,
  LibraryLaunchCandidates.layer.pipe(
    Layer.provide(LibraryService.layer.pipe(Layer.provide(layerLibraryAssets))),
  ),
  LibraryReplication.layer.pipe(
    Layer.provide(layerLibraryPublisher),
    Layer.provide(
      LibraryHistorySource.layer.pipe(
        Layer.provide(LibraryWorkspaceStore.layer),
        Layer.provide(ProjectionStore.layer),
      ),
    ),
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(
      LibraryCopyHealthPublication.layerSource.pipe(Layer.provide(ProcessRunner.layer)),
    ),
  ),
  layerLibraryAssets,
  layerLibraryRecovery,
  LibraryHistorySource.layer.pipe(
    Layer.provide(LibraryWorkspaceStore.layer),
    Layer.provide(ProjectionStore.layer),
  ),
  LibraryWorkspace.layer.pipe(
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
  ),
  ProjectCheckoutManagement.layer.pipe(
    Layer.provide(ProcessRunner.layer),
    Layer.provide(StorageCleanup.layer),
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
    Layer.provide(ProjectLifecycle.layer.pipe(Layer.provide(ProjectStore.layer))),
    Layer.provide(ProjectionStore.layer),
  ),
  PcbPreview.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
  ModelPreview.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
  // Apple builds run in L19 lanes, so both share the one ProjectLifecycle instance.
  AppleBuild.layer.pipe(
    Layer.provideMerge(ProjectLifecycle.layer.pipe(Layer.provide(ProjectStore.layer))),
    Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer)),
  ),
  // The cleanup reactor shares the Device QA service it cleans for.
  DeviceQaCleanupLive.pipe(
    Layer.provideMerge(
      DeviceQa.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
    ),
  ),
  CodeGraphReactorLive.pipe(
    Layer.provideMerge(
      CodeGraph.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
    ),
  ),
  // The reactor runs suggestions for the service MCP and RPC also call.
  LibraryBriefSuggestions.BriefSuggestionsReactorLive.pipe(
    Layer.provideMerge(
      LibraryBriefSuggestions.layer.pipe(
        Layer.provide(
          LibraryPublisher.layer.pipe(
            Layer.provide(FetchHttpClient.layer),
            Layer.provide(LibraryService.layer.pipe(Layer.provide(layerLibraryAssets))),
            Layer.provide(layerLibraryAssets),
          ),
        ),
        Layer.provide(LibraryService.layer.pipe(Layer.provide(layerLibraryAssets))),
        Layer.provide(LibraryWorkspaceStore.layer),
      ),
    ),
  ),
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
  Layer.empty,
  LibraryAssetHttpRoutes,
  LibraryRecoveryHttpRoutes,
  LibraryHttpRoutes,
  ModelPreviewHttpRoutes,
  PcbPreviewHttpRoutes,
);
