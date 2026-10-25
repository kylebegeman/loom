import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import { HttpClient } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { CLOUD_CLI_DESIRED_LINK_SECRET } from "../../cloud/CliState.ts";
import * as CliTokenManager from "../../cloud/CliTokenManager.ts";
import { CLOUD_REPLAY_MARKER_PREFIXES } from "../../cloud/CloudLink.ts";
import {
  CLOUD_ENDPOINT_CONFIRMED_ORIGIN,
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_LINK_REVOKED,
  CLOUD_LINKED_USER_ID,
  CLOUD_MINT_PUBLIC_KEY,
  HOLD_WEBHOOKS_WHILE_OFFLINE_SECRET,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "../../cloud/config.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "../../cloud/environmentKeys.ts";
import * as ServerConfig from "../../config.ts";
import * as ExternalLauncher from "../../process/externalLauncher.ts";
import { ConnectRetired } from "./connectRetired.ts";
import * as StaleConnectLink from "./staleConnectLink.ts";

const linkSecrets = [
  CLOUD_CLI_DESIRED_LINK_SECRET,
  CLOUD_LINKED_USER_ID,
  RELAY_ISSUER_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  CLOUD_MINT_PUBLIC_KEY,
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_ENDPOINT_CONFIRMED_ORIGIN,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  HOLD_WEBHOOKS_WHILE_OFFLINE_SECRET,
  CLOUD_LINK_REVOKED,
] as const;
const replayMarker = `${CLOUD_REPLAY_MARKER_PREFIXES[0]}stale-connect-test`;
const signIn = { accessToken: "access", refreshToken: "refresh", expiresAtEpochMs: 0 };
const bytes = (value: string) => new TextEncoder().encode(value);

// The real secret store and token manager on a temporary home; any network call fails the test.
const layerHost = () =>
  CliTokenManager.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected network call")),
        ),
        Layer.mock(ExternalLauncher.ExternalLauncher)({}),
      ),
    ),
    Layer.provideMerge(ServerSecretStore.layer),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "loom-connect-off-test-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const startUp = (retired: boolean) =>
  Effect.gen(function* () {
    const warnings: Array<ReadonlyArray<unknown>> = [];
    const capture = Logger.make(({ message }) => {
      warnings.push(Array.isArray(message) ? message : [message]);
    });
    yield* Effect.scoped(Layer.build(StaleConnectLink.layer)).pipe(
      Effect.provideService(ConnectRetired, retired),
      Effect.provide(Logger.layer([capture], { mergeWithExisting: false })),
    );
    return warnings;
  });

const isStored = (name: string) =>
  ServerSecretStore.ServerSecretStore.pipe(
    Effect.flatMap((secrets) => secrets.get(name)),
    Effect.map(Option.isSome),
  );

const seedFullLink = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const tokens = yield* CliTokenManager.CloudCliTokenManager;
  yield* secrets.set(RELAY_URL_SECRET, bytes("https://relay.example.test"));
  for (const name of linkSecrets) {
    yield* secrets.set(name, bytes(name));
  }
  yield* tokens.store(signIn);
  yield* secrets.set(replayMarker, bytes("1"));
  return yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
});

describe("stale Connect link cleanup", () => {
  it.effect("clears every Connect secret on a retired build and keeps the key pair", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const tokens = yield* CliTokenManager.CloudCliTokenManager;
      const keyPair = yield* seedFullLink;

      const warnings = yield* startUp(true);

      for (const name of [RELAY_URL_SECRET, ...linkSecrets]) {
        assert.isFalse(yield* isStored(name), name);
      }
      assert.isFalse(yield* tokens.hasCredential);
      assert.isTrue(yield* isStored(replayMarker));
      const kept = yield* getOrCreateEnvironmentKeyPairFromSecretStore(secrets);
      assert.strictEqual(kept.publicKey, keyPair.publicKey);
      assert.lengthOf(warnings, 1);
      assert.include(String(warnings[0]?.[0]), "re-link is refused");
      assert.include(String(warnings[0]?.[0]), "T3 keeps its record");
      assert.deepInclude(warnings[0]?.[1], { relayHost: "relay.example.test" });
    }).pipe(Effect.provide(layerHost())),
  );

  it.effect.each([
    { name: "a CLI sign-in", pendingLink: false },
    { name: "a `connect link` that never finished", pendingLink: true },
  ] as const)("clears $name without claiming T3 holds a linked computer", ({ pendingLink }) =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const tokens = yield* CliTokenManager.CloudCliTokenManager;
      yield* tokens.store(signIn);
      if (pendingLink) yield* secrets.set(CLOUD_CLI_DESIRED_LINK_SECRET, bytes("managed"));

      const warnings = yield* startUp(true);

      assert.isFalse(yield* tokens.hasCredential);
      assert.isFalse(yield* isStored(CLOUD_CLI_DESIRED_LINK_SECRET));
      assert.lengthOf(warnings, 1);
      assert.include(String(warnings[0]?.[0]), "held no Connect link");
      assert.notInclude(String(warnings[0]?.[0]), "T3 keeps its record");
      assert.deepInclude(warnings[0]?.[1], {
        cleared: pendingLink
          ? [CLOUD_CLI_DESIRED_LINK_SECRET, "cloud-cli-oauth-token"]
          : ["cloud-cli-oauth-token"],
      });
    }).pipe(Effect.provide(layerHost())),
  );

  it.effect("changes nothing when the build keeps Connect", () =>
    Effect.gen(function* () {
      const tokens = yield* CliTokenManager.CloudCliTokenManager;
      yield* seedFullLink;

      const warnings = yield* startUp(false);

      for (const name of [RELAY_URL_SECRET, ...linkSecrets]) {
        assert.isTrue(yield* isStored(name), name);
      }
      assert.isTrue(yield* tokens.hasCredential);
      assert.lengthOf(warnings, 0);
    }).pipe(Effect.provide(layerHost())),
  );

  it.effect("stays silent on a retired build with nothing stored", () =>
    Effect.gen(function* () {
      const warnings = yield* startUp(true);
      assert.lengthOf(warnings, 0);
    }).pipe(Effect.provide(layerHost())),
  );

  it.effect("lets startup continue when a removal fails", () =>
    Effect.gen(function* () {
      const warnings = yield* startUp(true);
      assert.lengthOf(warnings, 1);
      assert.include(String(warnings[0]?.[0]), "next start tries again");
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(ServerSecretStore.ServerSecretStore)({
            get: (name) =>
              Effect.succeed(name === RELAY_URL_SECRET ? Option.some(bytes("x")) : Option.none()),
            remove: (name) =>
              Effect.fail(
                new ServerSecretStore.SecretStoreRemoveError({
                  resource: `secret ${name}`,
                  cause: new Error("read-only file system"),
                }),
              ),
          }),
          Layer.mock(CliTokenManager.CloudCliTokenManager)({
            hasCredential: Effect.succeed(false),
            clear: Effect.void,
          }),
        ),
      ),
    ),
  );
});
