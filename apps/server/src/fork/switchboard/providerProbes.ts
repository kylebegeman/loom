import type { Settings as ClaudeSdkSettings } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeSettings, ServerSettings } from "@t3tools/contracts";
import * as ProviderHost from "@t3tools/provider-core/server/ProviderHost";
import type { ProviderSnapshotSettings } from "@t3tools/provider-core/server/snapshotSettings";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { probeClaudeCapabilities } from "../../provider/ClaudeProvider.ts";
import { probeSwitchboardCredential, resolveSwitchboardClaudeProbeRouting } from "./switchboard.ts";

export type SwitchboardSnapshotSettings<Settings> = ProviderSnapshotSettings<Settings> & {
  readonly switchboardEnabled: boolean;
};

/**
 * Snapshot settings for a provider Switchboard can route. They carry
 * `switchboardEnabled`, so turning routing on or off probes the provider again in
 * place, and `routed` reads the current mode for that probe.
 */
export const makeSwitchboardSnapshotSettingsSource = <Settings>(provider: Settings) =>
  Effect.gen(function* () {
    const { settings } = yield* ProviderHost.ProviderHost;
    const mapSettings = (current: ServerSettings): SwitchboardSnapshotSettings<Settings> => ({
      provider,
      enableProviderUpdateChecks: current.enableProviderUpdateChecks,
      switchboardEnabled: current.switchboardEnabled,
    });
    return {
      getSettings: settings.get.pipe(Effect.map(mapSettings)),
      streamSettings: settings.changes.pipe(Stream.map(mapSettings)),
      routed: settings.get.pipe(Effect.map((current) => current.switchboardEnabled)),
    };
  });

const ROUTED_PROBE_TTL = Duration.minutes(5);
const ROUTED_PROBE_KEY = "switchboard";

/**
 * Claude readiness while routed. The capability probe runs with the hub settings
 * resolved from the owning server's environment, never the instance's, and the
 * key helper runs on its own because initialization only reads its cache. The
 * routed result is cached apart from the native probe, so neither mode reuses the
 * other's login, and invalid hub configuration stays unverified instead of falling
 * back to native auth.
 */
export const makeSwitchboardClaudeProbes = (
  claudeSettings: ClaudeSettings,
  environment: NodeJS.ProcessEnv,
  cwd: string,
) =>
  Effect.gen(function* () {
    const { settings } = yield* ProviderHost.ProviderHost;
    const hostEnvironment = yield* HostProcess.Environment;
    const platform = yield* HostProcess.Platform;
    const routing = Effect.try(() =>
      resolveSwitchboardClaudeProbeRouting(hostEnvironment, platform),
    );
    const cache = yield* Cache.make({
      capacity: 1,
      timeToLive: ROUTED_PROBE_TTL,
      lookup: () =>
        routing.pipe(
          Effect.flatMap((route) =>
            Effect.all(
              {
                capabilities: probeClaudeCapabilities(
                  claudeSettings,
                  environment,
                  cwd,
                  true,
                  route.settings,
                ),
                credentialAvailable: probeSwitchboardCredential(route.keyCommand, hostEnvironment),
              },
              { concurrency: "unbounded" },
            ),
          ),
          Effect.map(({ capabilities, credentialAvailable }) =>
            capabilities
              ? { ...capabilities, switchboardCredentialAvailable: credentialAvailable }
              : undefined,
          ),
          Effect.orElseSucceed(() => undefined),
        ),
    });
    const routed = settings.get.pipe(Effect.map((current) => current.switchboardEnabled));
    return {
      routed,
      capabilities: Cache.get(cache, ROUTED_PROBE_KEY),
      invalidate: Cache.invalidateAll(cache),
      /** Runs a workspace probe with the hub settings when routed; any failure keeps `fallback`. */
      withWorkspaceSettings: <A, R>(
        fallback: A,
        probe: (switchboardSettings: ClaudeSdkSettings | undefined) => Effect.Effect<A, never, R>,
      ) =>
        routed.pipe(
          Effect.flatMap((on) =>
            on ? routing.pipe(Effect.flatMap((route) => probe(route.settings))) : probe(undefined),
          ),
          Effect.orElseSucceed(() => fallback),
        ),
    };
  });
