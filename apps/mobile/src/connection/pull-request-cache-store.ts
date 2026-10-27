import { EnvironmentQueryStore } from "@t3tools/client-runtime/state/query-persistence";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { MobileDatabase } from "../persistence/mobile-database";

// fork: library
/** Library history has its own cache kind; PR retention and existing keys stay compatible. */
export function persistedQueryCacheKind(key: string) {
  try {
    const value: unknown = JSON.parse(key);
    if (
      Array.isArray(value) &&
      typeof value[0] === "string" &&
      value[0].startsWith("loom:library:")
    )
      return "project-library" as const;
  } catch {
    /* Legacy or malformed keys retain the existing PR cache behavior. */
  }
  return "pull-request" as const;
}

export const layer = Layer.effect(
  EnvironmentQueryStore,
  Effect.gen(function* () {
    const database = yield* MobileDatabase;
    return {
      load: (environmentId, key) =>
        database
          // fork: library
          .loadCache(environmentId, persistedQueryCacheKind(key), `v1:${key}`)
          .pipe(Effect.catch(() => Effect.succeedNone)),
      save: (environmentId, key, payload) =>
        database
          // fork: library
          .saveCache(environmentId, persistedQueryCacheKind(key), `v1:${key}`, 1, payload)
          .pipe(Effect.catch(() => Effect.logWarning("Offline query database save failed"))),
    } satisfies NonNullable<typeof EnvironmentQueryStore.Service>;
  }),
);
