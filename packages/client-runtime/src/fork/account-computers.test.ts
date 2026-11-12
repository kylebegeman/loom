import { expect, it } from "@effect/vitest";
import { ACCOUNT_ACCESS_FEATURE } from "@t3tools/contracts/fork";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  BearerConnectionProfile,
  connectionRegistrationCatalogEntry,
  type ConnectionRegistration,
  type ConnectionCatalogEntry,
} from "../connection/catalog.ts";
import {
  BearerConnectionTarget,
  ConnectionBlockedError,
  type NetworkStatus,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import { syncAccountComputers } from "./account-computers.ts";
import { BOOK, DESK, LIBRARY, STUDIO, listing, reported } from "./directory-test-fixtures.ts";

const source = (identity = true): ConnectionCatalogEntry => ({
  target: new BearerConnectionTarget({
    environmentId: LIBRARY,
    label: "Library",
    connectionId: "library-login",
  }),
  profile: Option.some(
    new BearerConnectionProfile({
      environmentId: LIBRARY,
      label: "Library",
      connectionId: "library-login",
      httpBaseUrl: "https://library.example.test/",
      wsBaseUrl: "wss://library.example.test/ws",
      ...(identity ? { identity: { issuer: "https://id.example.test", subject: "owner" } } : {}),
    }),
  ),
  enabled: true,
});
const fixture = Effect.gen(function* () {
  const entries = yield* SubscriptionRef.make<ReadonlyMap<typeof LIBRARY, ConnectionCatalogEntry>>(
    new Map([[LIBRARY, source()]]),
  );
  const writes: ConnectionRegistration[] = [];
  let refused = false;
  const layer = Layer.mock(EnvironmentRegistry.EnvironmentRegistry)({
    entries,
    networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
    start: Effect.void,
    register: (registration) => {
      if (refused && registration.target.environmentId === BOOK)
        return Effect.fail(
          new ConnectionBlockedError({
            reason: "configuration",
            detail: "Connection storage unavailable",
          }),
        );
      writes.push(registration);
      return SubscriptionRef.update(entries, (current) =>
        new Map(current).set(
          registration.target.environmentId,
          connectionRegistrationCatalogEntry(registration),
        ),
      ).pipe(Effect.as(true));
    },
  });
  const sync = (computers = [reported(BOOK, { loomFeatures: [ACCOUNT_ACCESS_FEATURE] })]) =>
    syncAccountComputers(LIBRARY, listing(computers)).pipe(Effect.provide(layer));
  return {
    entries,
    writes,
    sync,
    refuse: () => {
      refused = true;
    },
  };
});

it.effect(
  "discovers compatible account computers once and preserves existing and disabled connections",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture;
      const disabled = {
        ...source(),
        target: new BearerConnectionTarget({
          environmentId: DESK,
          label: "Desk",
          connectionId: "desk-direct",
        }),
        enabled: false,
      };
      yield* SubscriptionRef.update(f.entries, (current) => new Map(current).set(DESK, disabled));
      const computers = [
        reported(LIBRARY, { loomFeatures: [ACCOUNT_ACCESS_FEATURE] }),
        reported(BOOK, { loomFeatures: [ACCOUNT_ACCESS_FEATURE] }),
        reported(DESK, { loomFeatures: [ACCOUNT_ACCESS_FEATURE] }),
        reported(STUDIO),
      ];
      yield* f.sync(computers);
      yield* f.sync(computers);
      expect(f.writes).toHaveLength(1);
      expect(f.writes[0]).toMatchObject({
        _tag: "AccountConnectionRegistration",
        target: { environmentId: BOOK },
        profile: { account: { libraryEnvironmentId: LIBRARY, connectionId: "library-login" } },
      });
      expect(f.writes[0]).not.toHaveProperty("credential");
      expect((yield* SubscriptionRef.get(f.entries)).get(DESK)).toEqual(disabled);
    }),
);

it.effect("does not create account access from a disabled or non-Identity remote Library", () =>
  Effect.gen(function* () {
    for (const library of [{ ...source(), enabled: false }, source(false)]) {
      const f = yield* fixture;
      yield* SubscriptionRef.set(f.entries, new Map([[LIBRARY, library]]));
      yield* f.sync();
      expect(f.writes).toEqual([]);
    }
  }),
);

it.effect("continues discovering other computers when one local registration fails", () =>
  Effect.gen(function* () {
    const f = yield* fixture;
    f.refuse();
    yield* f.sync([
      reported(BOOK, { loomFeatures: [ACCOUNT_ACCESS_FEATURE] }),
      reported(DESK, { loomFeatures: [ACCOUNT_ACCESS_FEATURE] }),
    ]);
    expect(f.writes.map((registration) => registration.target.environmentId)).toEqual([DESK]);
  }),
);
