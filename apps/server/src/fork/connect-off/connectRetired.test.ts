import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthSessionId,
  EnvironmentAuthenticatedAuth,
  EnvironmentAuthenticatedPrincipal,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import type {
  RelayEnvironmentConfigRequest,
  RelayLinkProofRequest,
} from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as CloudLink from "../../cloud/CloudLink.ts";
import * as ConnectReachability from "../../cloud/ConnectReachability.ts";
import * as ConnectHttp from "../../cloud/http.ts";
import { ConnectRetired } from "./connectRetired.ts";

const proofRequest: RelayLinkProofRequest = {
  challenge: "challenge",
  relayIssuer: "https://relay.example.test",
  endpoint: {
    providerKind: "cloudflare_tunnel",
    httpBaseUrl: "https://environment.example.test",
    wsBaseUrl: "wss://environment.example.test",
  },
  origin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
};
const relayConfig: RelayEnvironmentConfigRequest = {
  relayUrl: "https://relay.example.test",
  cloudUserId: "user",
  environmentCredential: "credential",
  cloudMintPublicKey: "mint-key",
  endpointRuntime: null,
};

class ConnectTestApi extends HttpApi.make("environment").add(EnvironmentHttpApi.groups.connect) {}

const relayClient = Layer.succeed(EnvironmentAuthenticatedAuth, (effect) =>
  effect.pipe(
    Effect.provideService(EnvironmentAuthenticatedPrincipal, {
      sessionId: AuthSessionId.make("connect-off-test"),
      subject: "connect-off-test",
      method: "browser-session-cookie",
      scopes: new Set([AuthRelayReadScope, AuthRelayWriteScope]),
    }),
  ),
);

type Post = (path: string, payload?: unknown) => Promise<Response>;

// CloudLink is mocked: these tests cover the route gate, not linking itself.
const withConnectRoutes = (retired: boolean, body: (post: Post) => Promise<void>) => {
  const routes = HttpApiBuilder.layer(ConnectTestApi).pipe(
    Layer.provide(ConnectHttp.layer),
    Layer.provide(relayClient),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(CloudLink.CloudLink)({
          linkProof: () => Effect.succeed("signed-proof"),
          applyRelayConfig: () => Effect.succeed({ ok: true, endpointRuntimeStatus: null }),
          unlink: () => Effect.succeed({ ok: true, endpointRuntimeStatus: null }),
        }),
        Layer.mock(ConnectReachability.ConnectReachability)({}),
        Layer.succeed(ConnectRetired, retired),
      ),
    ),
    Layer.provideMerge(HttpPlatform.layer.pipe(Layer.provideMerge(Etag.layerWeak))),
    Layer.provideMerge(NodeServices.layer),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  const post: Post = (path, payload) =>
    handler(
      new Request(`http://127.0.0.1:3773${path}`, {
        method: "POST",
        ...(payload === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }),
      }),
    );
  return Effect.promise(() => body(post).finally(dispose));
};

describe("Connect link routes on a retired Connect build", () => {
  it.effect("refuses a new link proof and relay config", () =>
    withConnectRoutes(true, async (post) => {
      for (const [path, payload] of [
        ["/api/connect/link-proof", proofRequest],
        ["/api/connect/relay-config", relayConfig],
      ] as const) {
        const response = await post(path, payload);
        assert.strictEqual(response.status, 403, path);
        const body = (await response.json()) as { _tag: string; message: string };
        assert.strictEqual(body._tag, "EnvironmentHttpForbiddenError");
        assert.include(body.message, "does not include T3 Connect");
      }
    }),
  );

  it.effect("still unlinks", () =>
    withConnectRoutes(true, async (post) => {
      const response = await post("/api/connect/unlink");
      assert.strictEqual(response.status, 200);
    }),
  );

  it.effect("links normally when the build keeps Connect", () =>
    withConnectRoutes(false, async (post) => {
      const proof = await post("/api/connect/link-proof", proofRequest);
      assert.strictEqual(proof.status, 200);
      assert.strictEqual(await proof.json(), "signed-proof");
      const config = await post("/api/connect/relay-config", relayConfig);
      assert.strictEqual(config.status, 200);
    }),
  );
});
