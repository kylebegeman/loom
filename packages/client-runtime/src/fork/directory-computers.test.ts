import { describe, expect, it } from "@effect/vitest";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { EnvironmentQueryStore } from "../state/queryPersistence.ts";
import { storedDirectoryListing } from "./directory-cache.ts";
import { loadStoredDirectoryListing, saveStoredDirectoryListing } from "./directory-computers.ts";
import { BOOK, LIBRARY, NOW, STUDIO, listing, reported } from "./directory-test-fixtures.ts";

function memoryStore() {
  const rows = new Map<string, string>();
  const key = (environmentId: EnvironmentId, name: string) => `${environmentId}:${name}`;
  return {
    rows,
    store: {
      load: (environmentId: EnvironmentId, name: string) =>
        Effect.succeed(Option.fromNullishOr(rows.get(key(environmentId, name)))),
      save: (environmentId: EnvironmentId, name: string, payload: string) =>
        Effect.sync(() => void rows.set(key(environmentId, name), payload)),
    },
  };
}

describe("stored directory listing", () => {
  it.effect("keeps the last listing under its Library for the next offline read", () => {
    const { store, rows } = memoryStore();
    const kept = storedDirectoryListing(LIBRARY, listing([reported(BOOK)]), NOW);
    return Effect.gen(function* () {
      expect(yield* loadStoredDirectoryListing(LIBRARY)).toBeNull();
      yield* saveStoredDirectoryListing(kept);
      expect(yield* loadStoredDirectoryListing(LIBRARY)).toEqual(kept);
      expect(yield* loadStoredDirectoryListing(STUDIO)).toBeNull();
      // The phone files keys under `loom:library:` with the Library's offline cache.
      expect([...rows.keys()]).toEqual([`${LIBRARY}:["loom:library:directory-computers:v1",{}]`]);
    }).pipe(Effect.provideService(EnvironmentQueryStore, store));
  });

  it.effect("reads nothing on a client without an offline cache", () =>
    Effect.gen(function* () {
      yield* saveStoredDirectoryListing(storedDirectoryListing(LIBRARY, listing([]), NOW));
      expect(yield* loadStoredDirectoryListing(LIBRARY)).toBeNull();
    }),
  );
});
