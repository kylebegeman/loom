import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import { CLOUD_CLI_DESIRED_LINK_SECRET } from "../../cloud/CliState.ts";
import * as CliTokenManager from "../../cloud/CliTokenManager.ts";
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
import { ConnectRetired } from "./connectRetired.ts";

/**
 * Every Connect secret a link leaves behind except the CLI sign-in, which only its token manager
 * names. The key pair stays so a later re-link proves the same identity, and replay markers
 * expire on their own.
 */
const STALE_CONNECT_SECRETS = [
  CLOUD_CLI_DESIRED_LINK_SECRET,
  CLOUD_LINKED_USER_ID,
  RELAY_URL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  CLOUD_MINT_PUBLIC_KEY,
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_ENDPOINT_CONFIRMED_ORIGIN,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  HOLD_WEBHOOKS_WHILE_OFFLINE_SECRET,
  CLOUD_LINK_REVOKED,
] as const;

const relayHost = (bytes: Uint8Array) => URL.parse(new TextDecoder().decode(bytes))?.host;

/**
 * Upstream's tunnel fiber, agent activity publishing and webhook waking read these secrets without
 * checking the build's Connect config, so a computer linked under an earlier build keeps calling
 * T3 until they are gone.
 */
const clearStaleConnectLink = Effect.fn("ConnectOff.clearStaleConnectLink")(
  function* () {
    if (!(yield* ConnectRetired)) return;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const tokens = yield* CliTokenManager.CloudCliTokenManager;
    // A secret that cannot be read, or a token that cannot be decoded, is still state at rest.
    const stored = yield* Effect.filter(
      STALE_CONNECT_SECRETS,
      (name) =>
        secrets.get(name).pipe(
          Effect.map(Option.isSome),
          Effect.orElseSucceed(() => true),
        ),
      { concurrency: "unbounded" },
    );
    const signedIn = yield* tokens.hasCredential.pipe(Effect.orElseSucceed(() => true));
    if (stored.length === 0 && !signedIn) return;

    const relay = yield* secrets.get(RELAY_URL_SECRET).pipe(
      Effect.map(Option.flatMap((bytes) => Option.fromNullishOr(relayHost(bytes)))),
      Effect.orElseSucceed(() => Option.none<string>()),
    );
    const removals: ReadonlyArray<
      Effect.Effect<
        void,
        ServerSecretStore.SecretStoreError | CliTokenManager.CloudCliTokenManagerError
      >
    > = [...STALE_CONNECT_SECRETS.map((name) => secrets.remove(name)), tokens.clear];
    const [, failures] = yield* Effect.partition(removals, (removal) => removal, {
      concurrency: "unbounded",
    });
    if (failures.length > 0) {
      return yield* Effect.logWarning(
        "Could not clear every stored T3 Connect secret on this retired Connect build; the next start tries again.",
        { failures },
      );
    }
    yield* Effect.logWarning(
      "Cleared this computer's stored T3 Connect link and sign-in because this Loom build retires Connect. A later re-link is refused while Connect is retired. T3 keeps its record of this computer until it is removed from the T3 Connect account.",
      {
        cleared: signedIn ? [...stored, "cloud-cli-oauth-token"] : stored,
        ...(Option.isSome(relay) ? { relayHost: relay.value } : {}),
      },
    );
  },
  Effect.catchCause((cause) =>
    Effect.logWarning("Could not clear stale T3 Connect state; startup continues.", { cause }),
  ),
);

/** Built inside ForkLayer, which finishes before AgentAwarenessRelay and the Connect startup fiber. */
export const layer = Layer.effectDiscard(clearStaleConnectLink());
