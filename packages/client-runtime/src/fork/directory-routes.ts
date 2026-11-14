import type { EnvironmentId } from "@t3tools/contracts";
import type { DirectoryListing } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as EnvironmentRegistry from "../connection/registry.ts";
import { directoryEnvironments } from "./directory.ts";

// Per registry, the reported version each held "needs a newer server" verdict was last retried at.
const retriedVersions = new WeakMap<object, Map<EnvironmentId, string>>();

/**
 * Offers saved computers a live listing's routes, and retries one paused as incompatible once per
 * reported version. Never pass a kept listing: an old report can name dropped addresses.
 */
export const learnDirectoryRoutes = Effect.fn("DirectoryRoutes.learn")(function* (
  listing: DirectoryListing,
) {
  const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
  const saved = yield* SubscriptionRef.get(registry.entries);
  const listed = directoryEnvironments(listing).filter((environment) =>
    saved.has(environment.environmentId),
  );
  const retried = retriedVersions.get(registry) ?? new Map<EnvironmentId, string>();
  retriedVersions.set(registry, retried);
  yield* Effect.forEach(
    listed,
    (environment) => {
      const { environmentId, serverVersion } = environment;
      if (
        saved.get(environmentId)?.unsupportedReason === undefined ||
        retried.get(environmentId) === serverVersion
      )
        return Effect.void;
      retried.set(environmentId, serverVersion);
      return registry
        .setCompatibility(environmentId, null)
        .pipe(
          Effect.catch(() =>
            Effect.logWarning("Loom could not retry a paused computer.", { environmentId }),
          ),
        );
    },
    { discard: true },
  );
  const learn = registry.learnDirectoryRoutes;
  if (learn === undefined) return;
  yield* Effect.forEach(
    // An empty list still counts: it drops a retired address this device learned from the directory.
    listed,
    (environment) =>
      learn(
        environment.environmentId,
        environment.routes.map((route) => ({ httpBaseUrl: route.url, kind: route.kind })),
      ),
    { discard: true },
  );
});
