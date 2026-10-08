import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ModelPreview from "./model-preview-3d/ModelPreviewService.ts";
import { ModelPreviewHttpRoutes } from "./model-preview-3d/http.ts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ForkRuntime, type ForkServices } from "./ForkRuntime.ts";
import { ForkMigrationsLive } from "./persistence/migrations.ts";
import { SwitchboardLive } from "./switchboard/switchboard.ts";

/** Packet service layers, one line each. Keep `Layer.empty` first. */
const ForkServicesLive = Layer.mergeAll(
  Layer.empty,
  SwitchboardLive,
  ModelPreview.layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, ProjectStore.layer))),
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
export const ForkRoutesLayer = Layer.mergeAll(Layer.empty, ModelPreviewHttpRoutes);
