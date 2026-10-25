import { describe, expect, it } from "@effect/vitest";
import type { EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityDirectoryAddresses } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { TestClock } from "effect/testing";

import { BearerConnectionProfile, type ConnectionCatalogEntry } from "../connection/catalog.ts";
import { BearerConnectionTarget } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import { EnvironmentQueryStore } from "../state/queryPersistence.ts";
import { storedDirectoryListing, type StoredDirectoryListing } from "./directory-cache.ts";
import {
  loadIdentityDirectoryAddresses,
  loadStoredDirectoryListing,
  saveStoredDirectoryListing,
} from "./directory-computers.ts";
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

describe("loadIdentityDirectoryAddresses", () => {
  const LIBRARY_URL = "https://library.example.com/";
  const libraryEntry = (enabled: boolean): ConnectionCatalogEntry => ({
    target: new BearerConnectionTarget({
      environmentId: LIBRARY,
      label: "Helios",
      connectionId: "bearer:library",
    }),
    profile: Option.some(
      new BearerConnectionProfile({
        connectionId: "bearer:library",
        environmentId: LIBRARY,
        label: "Helios",
        httpBaseUrl: LIBRARY_URL,
        wsBaseUrl: "wss://library.example.com/ws",
      }),
    ),
    enabled,
  });
  const kept = storedDirectoryListing(
    LIBRARY,
    listing([reported(BOOK, { routes: [{ kind: "public", url: "https://kept.example.com" }] })]),
    NOW,
  );
  const answered = storedDirectoryListing(
    LIBRARY,
    listing([reported(BOOK, { routes: [{ kind: "public", url: "https://live.example.com" }] })]),
    NOW,
  );

  /** The Library's answer stands in for the directory read it would run on that connection. */
  const withLibrary = <A, E>(
    entry: ConnectionCatalogEntry | null,
    answer: Effect.Effect<
      StoredDirectoryListing,
      EnvironmentRegistry.EnvironmentNotRegisteredError
    >,
    effect: Effect.Effect<A, E, EnvironmentRegistry.EnvironmentRegistry>,
  ) =>
    Effect.gen(function* () {
      const { store } = memoryStore();
      yield* saveStoredDirectoryListing(kept).pipe(
        Effect.provideService(EnvironmentQueryStore, store),
      );
      const entries = yield* SubscriptionRef.make(
        new Map(entry === null ? [] : [[LIBRARY, entry] as const]),
      );
      const run = () => answer;
      return yield* effect.pipe(
        Effect.provideService(EnvironmentRegistry.EnvironmentRegistry, {
          entries,
          run,
        } as unknown as EnvironmentRegistry.EnvironmentRegistry["Service"]),
        Effect.provideService(EnvironmentQueryStore, store),
      );
    });

  const bookAddresses = (result: LoomIdentityDirectoryAddresses | null) =>
    result?.computers.find((computer) => computer.environmentId === BOOK)?.addresses;

  it.effect("checks nothing when no Library is chosen", () =>
    withLibrary(
      libraryEntry(true),
      Effect.succeed(answered),
      loadIdentityDirectoryAddresses(null),
    ).pipe(Effect.map((result) => expect(result).toBeNull())),
  );

  it.effect("uses the Library's answer and the addresses this device keeps for it", () =>
    Effect.gen(function* () {
      const result = yield* withLibrary(
        libraryEntry(true),
        Effect.succeed(answered),
        loadIdentityDirectoryAddresses(LIBRARY),
      );
      expect(result?.library).toEqual({
        environmentId: LIBRARY,
        label: "Helios",
        addresses: [LIBRARY_URL],
      });
      expect(bookAddresses(result)).toEqual(["https://live.example.com"]);
    }),
  );

  it.effect("uses the kept listing when the Library cannot answer", () =>
    Effect.gen(function* () {
      const result = yield* withLibrary(
        libraryEntry(true),
        Effect.fail(
          new EnvironmentRegistry.EnvironmentNotRegisteredError({ environmentId: LIBRARY }),
        ),
        loadIdentityDirectoryAddresses(LIBRARY),
      );
      expect(bookAddresses(result)).toEqual(["https://kept.example.com"]);
    }),
  );

  it.effect("uses the kept listing when an older Library has no directory to read", () =>
    Effect.gen(function* () {
      // The RPC server answers a method it lacks with a defect, not a typed failure.
      const result = yield* withLibrary(
        libraryEntry(true),
        Effect.die("Unknown request tag: directory.list"),
        loadIdentityDirectoryAddresses(LIBRARY),
      );
      expect(result?.library.addresses).toEqual([LIBRARY_URL]);
      expect(bookAddresses(result)).toEqual(["https://kept.example.com"]);
    }),
  );

  it.effect("stops waiting for a slow Library and uses the kept listing", () =>
    Effect.gen(function* () {
      const fiber = yield* withLibrary(
        libraryEntry(true),
        Effect.never,
        loadIdentityDirectoryAddresses(LIBRARY),
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("5 seconds");
      expect(bookAddresses(yield* Fiber.join(fiber))).toEqual(["https://kept.example.com"]);
    }),
  );

  it.effect("reads nothing from a switched-off Library and keeps its listing", () =>
    Effect.gen(function* () {
      const result = yield* withLibrary(
        libraryEntry(false),
        Effect.die("a switched-off Library is never asked"),
        loadIdentityDirectoryAddresses(LIBRARY),
      );
      expect(result?.library.addresses).toEqual([LIBRARY_URL]);
      expect(bookAddresses(result)).toEqual(["https://kept.example.com"]);
    }),
  );

  it.effect("still knows the kept listing for a Library this device no longer saves", () =>
    Effect.gen(function* () {
      const result = yield* withLibrary(
        null,
        Effect.die("an unsaved Library is never asked"),
        loadIdentityDirectoryAddresses(LIBRARY),
      );
      expect(result?.library).toEqual({ environmentId: LIBRARY, label: "", addresses: [] });
      expect(bookAddresses(result)).toEqual(["https://kept.example.com"]);
    }),
  );
});
