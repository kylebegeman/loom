import { expect, it } from "@effect/vitest";
import { ACCOUNT_ACCESS_FEATURE, type AccountComputerStatus } from "@t3tools/contracts/fork";
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
import { accountComputerEnrollmentReady, syncAccountComputers } from "./account-computers.ts";
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

it("requires approved account membership beyond existing publishing and remote access", () => {
  const membership: AccountComputerStatus = {
    environmentId: BOOK,
    label: "Book",
    membershipRevision: 1,
    state: "active",
    publishingEnded: false,
    routeRemoved: false,
    directoryRemoved: false,
    detail: null,
  };
  const input = {
    libraryEnvironmentId: LIBRARY,
    sourceLibraryEnvironmentId: LIBRARY,
    signedIn: true,
    remoteEnabled: true,
    membership,
  };
  expect(accountComputerEnrollmentReady(input)).toBe(true);
  for (const change of [
    { membership: null },
    { membership: { ...membership, membershipRevision: null } },
    { membership: { ...membership, state: "removed" as const } },
    { membership: { ...membership, state: "removing" as const } },
    { sourceLibraryEnvironmentId: DESK },
    { libraryEnvironmentId: null },
    { signedIn: false },
    { remoteEnabled: false },
  ])
    expect(accountComputerEnrollmentReady({ ...input, ...change })).toBe(false);
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
  "discovers account routes for new and saved computers while preserving disabled connections",
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
      const connectionId = "studio-lan";
      yield* SubscriptionRef.update(f.entries, (current) =>
        new Map(current).set(STUDIO, {
          target: new BearerConnectionTarget({
            environmentId: STUDIO,
            label: "Studio",
            connectionId,
          }),
          profile: Option.some(
            new BearerConnectionProfile({
              environmentId: STUDIO,
              label: "Studio",
              connectionId,
              httpBaseUrl: "http://192.168.1.20:3773/",
              wsBaseUrl: "ws://192.168.1.20:3773/ws",
            }),
          ),
          enabled: true,
        }),
      );
      const updated = computers.map((computer) =>
        computer.environmentId === STUDIO
          ? { ...computer, loomFeatures: [ACCOUNT_ACCESS_FEATURE] }
          : computer,
      );
      yield* f.sync(updated);
      yield* f.sync(updated);
      expect(f.writes).toHaveLength(2);
      expect(f.writes[0]).toMatchObject({
        _tag: "AccountConnectionRegistration",
        target: { environmentId: BOOK },
        profile: { account: { libraryEnvironmentId: LIBRARY, connectionId: "library-login" } },
      });
      expect(f.writes[0]).not.toHaveProperty("credential");
      expect(f.writes[1]).toMatchObject({
        _tag: "AccountConnectionRegistration",
        target: { environmentId: STUDIO },
        profile: {
          httpBaseUrl: "https://library.example.test/api/loom/account/computers/studio/",
          account: { libraryEnvironmentId: LIBRARY, connectionId: "library-login" },
        },
      });
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
