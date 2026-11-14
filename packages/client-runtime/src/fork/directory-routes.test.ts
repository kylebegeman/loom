import { expect, it } from "@effect/vitest";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { BearerConnectionTarget, type NetworkStatus } from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import { learnDirectoryRoutes } from "./directory-routes.ts";
import { BOOK, DESK, listing, reported } from "./directory-test-fixtures.ts";

const saved = (
  environmentId: EnvironmentId,
  unsupportedReason?: string,
): ConnectionCatalogEntry => ({
  target: new BearerConnectionTarget({
    environmentId,
    label: environmentId,
    connectionId: `${environmentId}-saved`,
  }),
  profile: Option.none(),
  enabled: true,
  ...(unsupportedReason === undefined ? {} : { unsupportedReason }),
});

it.effect("retries a paused computer once for each version the directory reports", () =>
  Effect.gen(function* () {
    const tooOld = "This client requires a newer server. Update Loom on book to connect.";
    const entries = yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
      new Map([
        [BOOK, saved(BOOK, tooOld)],
        [DESK, saved(DESK)],
      ]),
    );
    const retried: EnvironmentId[] = [];
    const layer = Layer.mock(EnvironmentRegistry.EnvironmentRegistry)({
      entries,
      networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
      start: Effect.void,
      setCompatibility: (environmentId, error) => {
        expect(error).toBeNull();
        retried.push(environmentId);
        // The retry reaches the same old server, which pauses it again.
        return Effect.void;
      },
      learnDirectoryRoutes: () => Effect.void,
    });
    const read = (version: string) =>
      learnDirectoryRoutes(
        listing([reported(BOOK, { serverVersion: version }), reported(DESK)]),
      ).pipe(Effect.provide(layer));

    yield* read("1.4.0");
    yield* read("1.4.0");
    expect(retried).toEqual([BOOK]);
    yield* read("1.5.0");
    expect(retried).toEqual([BOOK, BOOK]);
  }),
);
