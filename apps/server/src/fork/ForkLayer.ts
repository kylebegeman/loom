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

/** Packet service layers, one line each. Keep `Layer.empty` first. */
const ForkServicesLive = Layer.mergeAll(
  Layer.empty,
  SwitchboardLive,
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
  ModelPreviewHttpRoutes,
  PcbPreviewHttpRoutes,
);
