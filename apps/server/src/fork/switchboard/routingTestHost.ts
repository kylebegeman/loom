import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@t3tools/contracts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";

/**
 * A provider host whose `switchboardEnabled` setting a test flips, for driver
 * tests that watch a provider probe again when routing turns on or off.
 */
export const makeRoutingTestHost = Effect.gen(function* () {
  const server = yield* ServerConfig.ServerConfig;
  const current = yield* Ref.make<ServerSettings>({
    ...DEFAULT_SERVER_SETTINGS,
    enableProviderUpdateChecks: false,
    switchboardEnabled: false,
  });
  const changes = yield* PubSub.unbounded<ServerSettings>();
  const listening = yield* Deferred.make<void>();
  const subscribe = PubSub.subscribe(changes).pipe(
    Effect.map((subscription) => Stream.fromSubscription(subscription)),
  );
  const host = ProviderHost.ProviderHost.of({
    paths: {
      cwd: server.cwd,
      baseDir: server.baseDir,
      stateDir: server.stateDir,
      providerStatusCacheDir: server.providerStatusCacheDir,
      attachmentsDir: server.attachmentsDir,
    },
    settings: {
      get: Ref.get(current),
      withSnapshot: (use) => Ref.get(current).pipe(Effect.flatMap(use)),
      changes: Stream.unwrap(
        subscribe.pipe(Effect.tap(() => Deferred.succeed(listening, undefined))),
      ),
      subscribe,
    },
    shouldRunBackgroundWork: () => Effect.succeed(false),
    resolveAttachmentPath: () => null,
    credentials: () => Effect.die("Readiness must not read stored provider credentials"),
  });
  return {
    host,
    routed: Ref.get(current).pipe(Effect.map((settings) => settings.switchboardEnabled)),
    /** Resolves once the provider's snapshot follows settings changes. */
    listening: Deferred.await(listening),
    setRouted: (switchboardEnabled: boolean) =>
      Ref.updateAndGet(current, (settings) => ({ ...settings, switchboardEnabled })).pipe(
        Effect.flatMap((settings) => PubSub.publish(changes, settings)),
      ),
  };
});
