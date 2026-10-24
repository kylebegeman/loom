import type { EnvironmentId } from "@t3tools/contracts";
import { DIRECTORY_WS_METHODS } from "@t3tools/contracts/fork";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as HttpClient from "effect/http/HttpClient";
import { AsyncResult, Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { request } from "../rpc/client.ts";
import { EnvironmentQueryStore } from "../state/queryPersistence.ts";
import { createEnvironmentQueryAtomFamily, createRuntimeCommand } from "../state/runtime.ts";
import {
  decodeStoredDirectoryListing,
  storedDirectoryListing,
  StoredDirectoryListingJson,
  type StoredDirectoryListing,
} from "./directory-cache.ts";
import {
  planDirectoryConnect,
  type DirectoryPlanConnectInput,
} from "./directory-computers-connect.ts";

/**
 * Kept in each client's offline query cache under the Library: web IndexedDB, the phone's
 * SQLite. The `loom:library:` prefix gives it the Library cache's retention on the phone.
 */
const STORED_LISTING_KEY = JSON.stringify(["loom:library:directory-computers:v1", {}]);
/** Opening the list again after this long reads it again. Nothing reads it on a timer. */
const LISTING_STALE_MS = 15_000;
const IDLE_TTL_MS = 5 * 60_000;
const encodeStored = Schema.encodeEffect(StoredDirectoryListingJson);

/** The listing this device last kept for a Library, or null. Never another Library's. */
export const loadStoredDirectoryListing = Effect.fn("DirectoryComputers.loadStored")(function* (
  authorityEnvironmentId: EnvironmentId,
) {
  const store = yield* EnvironmentQueryStore;
  if (store === null) return null;
  const text = yield* store.load(authorityEnvironmentId, STORED_LISTING_KEY);
  const stored = decodeStoredDirectoryListing(Option.getOrNull(text));
  return stored?.authorityEnvironmentId === authorityEnvironmentId ? stored : null;
});

export const saveStoredDirectoryListing = Effect.fn("DirectoryComputers.saveStored")(
  function* (stored: StoredDirectoryListing) {
    const store = yield* EnvironmentQueryStore;
    if (store === null) return;
    const text = yield* encodeStored(stored);
    yield* store.save(stored.authorityEnvironmentId, STORED_LISTING_KEY, text);
  },
  Effect.catch(() => Effect.logWarning("The Library's computer list could not be kept offline")),
);

/** Runs on the Library authority's connection; the RPC fails `not-authority` anywhere else. */
const readDirectoryListing = Effect.fn("DirectoryComputers.read")(function* () {
  const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
  const listing = yield* request(DIRECTORY_WS_METHODS.list, {});
  const stored = storedDirectoryListing(
    supervisor.target.environmentId,
    listing,
    yield* Clock.currentTimeMillis,
  );
  yield* saveStoredDirectoryListing(stored);
  return stored;
});

/** Stands in while no Library is chosen or it lacks `directory`, so nothing is read. */
const IDLE_LISTING = Atom.make(AsyncResult.initial<StoredDirectoryListing, never>(false)).pipe(
  Atom.withLabel("loom:directory-computers:listing:idle"),
);
const NO_STORED_LISTING = Atom.make<StoredDirectoryListing | null>(null).pipe(
  Atom.withLabel("loom:directory-computers:stored:none"),
);

/**
 * The Library computer list, shared by web, desktop and mobile. `listing` reads the directory on
 * the Library's connection when it mounts (if older than a few seconds) and when refreshed, never
 * on a timer; pass null while no Library is chosen or it lacks `directory`. `stored` needs no
 * connection, so the last listing shows while the Library is loading or unreachable. Feed both
 * to `directoryComputersView`.
 */
export function createDirectoryComputersAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const listing = createEnvironmentQueryAtomFamily(runtime, {
    label: "loom:directory-computers:listing",
    staleTimeMs: LISTING_STALE_MS,
    idleTtlMs: IDLE_TTL_MS,
    execute: (_input: Record<string, never>) => readDirectoryListing(),
  });
  const storedFamily = Atom.family((authorityEnvironmentId: EnvironmentId) =>
    runtime.atom(loadStoredDirectoryListing(authorityEnvironmentId)).pipe(
      Atom.map((result) => Option.getOrNull(AsyncResult.value(result))),
      Atom.setIdleTTL(IDLE_TTL_MS),
      Atom.withLabel(`loom:directory-computers:stored:${authorityEnvironmentId}`),
    ),
  );
  return {
    /** Refresh this atom for an explicit refresh. */
    listing: (
      authorityEnvironmentId: EnvironmentId | null,
    ): Atom.Atom<AsyncResult.AsyncResult<StoredDirectoryListing, unknown>> =>
      authorityEnvironmentId === null
        ? IDLE_LISTING
        : listing({ environmentId: authorityEnvironmentId, input: {} }),
    stored: (
      authorityEnvironmentId: EnvironmentId | null,
    ): Atom.Atom<StoredDirectoryListing | null> =>
      authorityEnvironmentId === null ? NO_STORED_LISTING : storedFamily(authorityEnvironmentId),
    /** Resolves to a `DirectoryConnectStep`, or null for a row with nothing to connect. */
    planConnect: createRuntimeCommand(runtime, {
      label: "loom:directory-computers:plan-connect",
      concurrency: {
        mode: "singleFlight",
        key: (input: DirectoryPlanConnectInput) => input.row.environmentId,
      },
      execute: (input: DirectoryPlanConnectInput) => planDirectoryConnect(input),
    }),
  };
}
