import type { DirectoryListing } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as EnvironmentRegistry from "../connection/registry.ts";
import { directoryEnvironments } from "./directory.ts";

/**
 * Offers each saved computer the routes a live listing has for it. Only one this device cannot
 * reach takes them, so a newly published address is tried with no new UI. Never pass a kept
 * listing: an old report can name addresses the computer has since dropped.
 */
export const learnDirectoryRoutes = Effect.fn("DirectoryRoutes.learn")(function* (
  listing: DirectoryListing,
) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const learn = registry.learnDirectoryRoutes;
  if (learn === undefined) return;
  const saved = yield* SubscriptionRef.get(registry.entries);
  yield* Effect.forEach(
    // An empty list still counts: it drops a retired address this device learned from the directory.
    directoryEnvironments(listing).filter((environment) => saved.has(environment.environmentId)),
    (environment) =>
      learn(
        environment.environmentId,
        environment.routes.map((route) => ({ httpBaseUrl: route.url, kind: route.kind })),
      ),
    { discard: true },
  );
});
