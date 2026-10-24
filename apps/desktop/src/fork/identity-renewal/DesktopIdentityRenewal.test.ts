import { assert, describe, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { LOOM_IDENTITY_SESSION_PATH } from "@t3tools/contracts/fork";
import {
  type IdentityGrant,
  type IdentityGrantFetch,
  identityGrantKey,
} from "@t3tools/shared/fork/identity-grant";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopIdentityGrantStore from "./DesktopIdentityGrantStore.ts";
import * as DesktopIdentityRenewal from "./DesktopIdentityRenewal.ts";

const TOKEN_ENDPOINT = "https://id.example.test/api/oidc/token";
const END_SESSION_ENDPOINT = "https://id.example.test/api/oidc/end-session";
const COMPUTER = "https://computer.example.test";
const TAILNET = "https://computer.tailnet.test";
const environmentId = EnvironmentId.make("env-renewal");
const identity = { issuer: "https://id.example.test", subject: "subject-1" };

const grant: IdentityGrant = {
  version: 1,
  ...identity,
  environmentId,
  httpBaseUrl: COMPUTER,
  clientId: "native-client",
  tokenEndpoint: TOKEN_ENDPOINT,
  endSessionEndpoint: END_SESSION_ENDPOINT,
  refreshToken: "refresh-old",
  idToken: "id-old",
  grantedAt: 0,
  updatedAt: 0,
};
const key = identityGrantKey(grant);
const request = {
  httpBaseUrl: `${COMPUTER}/`,
  environmentId,
  identity,
  currentToken: "session-old",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
// The test clock starts at zero, so any positive expiry is still live.
const accessToken = `e30.${Base64Url.encode(JSON.stringify({ sub: identity.subject, exp: 600 }))}.sig`;
const tokenReply = () =>
  json(200, {
    token_type: "Bearer",
    access_token: accessToken,
    id_token: "id-new",
    refresh_token: "refresh-new",
  });
const sessionReply = () =>
  json(200, {
    access_token: "session-new",
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "orchestration:read",
    environmentId,
    identity,
  });

type ReplyToken = (afterReads: (count: number) => Promise<void>) => Response | Promise<Response>;

function harness(replies: { readonly token?: ReplyToken } = {}) {
  const grants = new Map([[key, grant]]);
  let reads = 0;
  const readCount = new Map<number, PromiseWithResolvers<void>>();
  const afterReads = (count: number) => {
    const waiter = readCount.get(count) ?? Promise.withResolvers<void>();
    readCount.set(count, waiter);
    if (reads >= count) waiter.resolve();
    return waiter.promise;
  };
  const sent: Array<{ readonly url: string; readonly body: string; readonly stored: string }> = [];
  const fetch: IdentityGrantFetch = async (url, init) => {
    sent.push({
      url,
      body: typeof init.body === "string" ? init.body : "",
      stored: grants.get(key)?.refreshToken ?? "none",
    });
    if (url === TOKEN_ENDPOINT) return (replies.token ?? tokenReply)(afterReads);
    if (
      url === `${COMPUTER}${LOOM_IDENTITY_SESSION_PATH}` ||
      url === `${TAILNET}${LOOM_IDENTITY_SESSION_PATH}`
    )
      return sessionReply();
    if (url.startsWith(END_SESSION_ENDPOINT)) return new Response(null, { status: 302 });
    return new Response(null, { status: 404 });
  };
  const store = Layer.succeed(
    DesktopIdentityGrantStore.DesktopIdentityGrantStore,
    DesktopIdentityGrantStore.DesktopIdentityGrantStore.of({
      get: (lookup) =>
        Effect.sync(() => {
          reads += 1;
          readCount.get(reads)?.resolve();
          return Option.fromNullishOr(grants.get(lookup));
        }),
      put: (next) =>
        Effect.sync(() => {
          grants.set(identityGrantKey(next), next);
          return true;
        }),
      remove: (lookup) =>
        Effect.sync(() => {
          grants.delete(lookup);
        }),
    }),
  );
  const layer = Layer.effect(
    DesktopIdentityRenewal.DesktopIdentityRenewal,
    DesktopIdentityRenewal.make({ fetch }),
  ).pipe(Layer.provide(store));
  return { grants, sent, layer };
}

describe("DesktopIdentityRenewal", () => {
  it.effect("shares one refresh between concurrent renewals and saves the rotation first", () => {
    const test = harness({
      // Two pre-checks plus the flight's own read: both callers have joined before it settles.
      token: (afterReads) => afterReads(3).then(tokenReply),
    });
    return Effect.gen(function* () {
      const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
      const [first, second] = yield* Effect.all([renewal.renew(request), renewal.renew(request)], {
        concurrency: "unbounded",
      });

      assert.deepStrictEqual(first, second);
      assert.deepStrictEqual(first, {
        _tag: "Renewed",
        session: {
          httpBaseUrl: COMPUTER,
          environmentId,
          accessToken: "session-new",
          identity,
          expiresAt: 600_000,
        },
      });
      assert.deepStrictEqual(
        test.sent.map(({ url }) => url),
        [TOKEN_ENDPOINT, `${COMPUTER}${LOOM_IDENTITY_SESSION_PATH}`],
      );
      const [refresh, exchange] = test.sent;
      assert.include(refresh?.body, "refresh_token=refresh-old");
      assert.strictEqual(exchange?.stored, "refresh-new");
      assert.notInclude(exchange?.body, "refresh-");
      assert.strictEqual(test.grants.get(key)?.refreshToken, "refresh-new");
      assert.strictEqual(test.grants.get(key)?.idToken, "id-new");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("forgets a grant the provider refuses", () => {
    const test = harness({ token: () => json(400, { error: "invalid_grant" }) });
    return Effect.gen(function* () {
      const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
      const result = yield* renewal.renew(request);

      assert.strictEqual(result._tag, "SignInRequired");
      assert.isFalse(test.grants.has(key));
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("keeps the grant when renewal fails for a reason worth retrying", () => {
    const test = harness({ token: () => json(503, {}) });
    return Effect.gen(function* () {
      const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
      const exit = yield* Effect.exit(renewal.renew(request));

      assert.isTrue(Exit.isFailure(exit));
      assert.strictEqual(test.grants.get(key)?.refreshToken, "refresh-old");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("renews over another address of the same computer", () => {
    const test = harness();
    return Effect.gen(function* () {
      const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
      const result = yield* renewal.renew({ ...request, httpBaseUrl: TAILNET });

      assert.strictEqual(result._tag, "Renewed");
      assert.deepStrictEqual(
        test.sent.map(({ url }) => url),
        [TOKEN_ENDPOINT, `${TAILNET}${LOOM_IDENTITY_SESSION_PATH}`],
      );
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("forgets the grant and ends it at the provider from any of its addresses", () => {
    const test = harness();
    return Effect.gen(function* () {
      const renewal = yield* DesktopIdentityRenewal.DesktopIdentityRenewal;
      yield* renewal.forget({ ...request, httpBaseUrl: TAILNET });

      assert.isFalse(test.grants.has(key));
      assert.strictEqual(test.sent.length, 1);
      const ended = new URL(test.sent[0]!.url);
      assert.strictEqual(`${ended.origin}${ended.pathname}`, END_SESSION_ENDPOINT);
      assert.strictEqual(ended.searchParams.get("id_token_hint"), "id-old");
      assert.strictEqual((yield* renewal.renew(request))._tag, "SignInRequired");
    }).pipe(Effect.provide(test.layer));
  });
});
