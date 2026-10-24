import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import type { IdentityRenewalRequest } from "@t3tools/client-runtime/fork";
import { EnvironmentId } from "@t3tools/contracts";
import { LOOM_IDENTITY_SESSION_PATH } from "@t3tools/contracts/fork";
import {
  type IdentityGrant,
  type IdentityGrantFetch,
  identityGrantKey,
} from "@t3tools/shared/fork/identity-grant";
import { describe, expect, it } from "@effect/vitest";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { makeIdentityGrantStore } from "./grantStore";
import { makeIdentityRenewal } from "./renewal";

const NOW = 1_800_000_000_000;
const TOKEN_ENDPOINT = "https://id.example.test/api/oidc/token";
const END_SESSION_ENDPOINT = "https://id.example.test/api/oidc/end-session";
const COMPUTER = "https://computer.example.test";
const SESSION_URL = `${COMPUTER}${LOOM_IDENTITY_SESSION_PATH}`;
const TAILNET = "https://computer.tailnet.test";
const environmentId = EnvironmentId.make("env-renewal");
const identity = { issuer: "https://id.example.test", subject: "subject-1" };

const signedIn: IdentityGrant = {
  version: 1,
  ...identity,
  environmentId,
  httpBaseUrl: COMPUTER,
  clientId: "native-client",
  tokenEndpoint: TOKEN_ENDPOINT,
  endSessionEndpoint: END_SESSION_ENDPOINT,
  refreshToken: "refresh-1",
  idToken: "id-1",
  grantedAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
};
const key = identityGrantKey(signedIn);

const request: IdentityRenewalRequest = {
  httpBaseUrl: COMPUTER,
  environmentId,
  identity,
  currentToken: "computer-session-1",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const jwt = (claims: Record<string, unknown>) =>
  `e30.${Base64Url.encode(JSON.stringify(claims))}.sig`;

const tokenReply = () =>
  json(200, {
    token_type: "Bearer",
    access_token: jwt({ sub: identity.subject, exp: NOW / 1000 + 600 }),
    id_token: "id-2",
    refresh_token: "refresh-2",
  });
const sessionReply = () =>
  json(200, {
    access_token: "computer-session-2",
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "orchestration:read",
    environmentId,
    identity,
  });

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

function setup(
  options: {
    readonly token?: () => Response | Promise<Response>;
    readonly grant?: IdentityGrant | null;
  } = {},
) {
  const items = new Map<string, string>();
  const store = makeIdentityGrantStore({
    getItem: async (name) => items.get(name) ?? null,
    setItem: async (name, value) => void items.set(name, value),
    removeItem: async (name) => void items.delete(name),
  });
  const tokenRequested = gate();
  const sent: Array<{ readonly url: string; readonly refreshAtSend?: string | undefined }> = [];
  const fetch: IdentityGrantFetch = async (url) => {
    if (url === TOKEN_ENDPOINT) {
      sent.push({ url });
      tokenRequested.open();
      return (options.token ?? tokenReply)();
    }
    if (url === SESSION_URL || url === `${TAILNET}${LOOM_IDENTITY_SESSION_PATH}`) {
      sent.push({ url, refreshAtSend: (await store.get(key))?.refreshToken });
      return sessionReply();
    }
    sent.push({ url });
    if (url.startsWith(END_SESSION_ENDPOINT)) return new Response(null, { status: 302 });
    throw new Error(`unexpected request to ${url}`);
  };
  const renewal = makeIdentityRenewal({ store, fetch, now: () => NOW });
  const seeded = options.grant === null ? null : (options.grant ?? signedIn);
  return {
    store,
    sent,
    renewal,
    tokenRequested: tokenRequested.opened,
    seed: Effect.promise(() => (seeded ? store.put(seeded) : Promise.resolve())),
  };
}

describe("mobile Identity renewal", () => {
  it.effect("saves the rotated grant before the exchange and returns the new session", () =>
    Effect.gen(function* () {
      const { store, sent, renewal, seed } = setup();
      yield* seed;
      expect(yield* renewal.renew(request)).toEqual({
        _tag: "Renewed",
        token: "computer-session-2",
        expiresAt: NOW + 600_000,
      });
      expect(sent).toEqual([
        { url: TOKEN_ENDPOINT },
        { url: SESSION_URL, refreshAtSend: "refresh-2" },
      ]);
      expect(yield* Effect.promise(() => store.get(key))).toMatchObject({
        refreshToken: "refresh-2",
        idToken: "id-2",
      });
    }),
  );

  it.effect("shares one refresh between concurrent renewals of the same grant", () =>
    Effect.gen(function* () {
      const reply = gate();
      const { sent, renewal, seed, tokenRequested } = setup({
        token: () => reply.opened.then(tokenReply),
      });
      yield* seed;
      // The grant key is read synchronously on entry, so this marks the second caller as waiting.
      const secondEntered = gate();
      const second = {
        ...request,
        currentToken: null,
        get identity() {
          secondEntered.open();
          return identity;
        },
      };
      const both = yield* Effect.all([renewal.renew(request), renewal.renew(second)], {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild);
      yield* Effect.promise(() => Promise.all([tokenRequested, secondEntered.opened]));
      reply.open();
      const [first, again] = yield* Fiber.join(both);
      expect(first._tag).toBe("Renewed");
      expect(again).toEqual(first);
      expect(sent.filter((entry) => entry.url === TOKEN_ENDPOINT)).toHaveLength(1);
    }),
  );

  it.effect("forgets the grant when Loom Identity ends the sign-in", () =>
    Effect.gen(function* () {
      const { store, sent, renewal, seed } = setup({
        token: () => json(400, { error: "invalid_grant" }),
      });
      yield* seed;
      expect((yield* renewal.renew(request))._tag).toBe("SignInRequired");
      expect(sent.map((entry) => entry.url)).toEqual([TOKEN_ENDPOINT]);
      expect(yield* Effect.promise(() => store.get(key))).toBeNull();
    }),
  );

  it.effect("keeps the grant and fails transiently when Loom Identity is unavailable", () =>
    Effect.gen(function* () {
      const { store, renewal, seed } = setup({ token: () => json(503, {}) });
      yield* seed;
      const error = yield* Effect.flip(renewal.renew(request));
      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.reason).toBe("network");
      expect(yield* Effect.promise(() => store.get(key))).toEqual(signedIn);
    }),
  );

  it.effect("asks for a sign-in without sending anything when no grant fits", () =>
    Effect.gen(function* () {
      const missing = setup({ grant: null });
      expect((yield* missing.renewal.renew(request))._tag).toBe("SignInRequired");
      expect(missing.sent).toEqual([]);
    }),
  );

  it.effect("renews over another address of the same computer", () =>
    Effect.gen(function* () {
      const { sent, renewal, seed } = setup();
      yield* seed;
      expect((yield* renewal.renew({ ...request, httpBaseUrl: TAILNET }))._tag).toBe("Renewed");
      expect(sent.map((entry) => entry.url)).toEqual([
        TOKEN_ENDPOINT,
        `${TAILNET}${LOOM_IDENTITY_SESSION_PATH}`,
      ]);
    }),
  );

  it.effect("removes the grant and ends it at Loom Identity when the connection goes", () =>
    Effect.gen(function* () {
      const { store, sent, renewal, seed } = setup();
      yield* seed;
      yield* renewal.forget({ ...request, httpBaseUrl: TAILNET });
      expect(yield* Effect.promise(() => store.get(key))).toBeNull();
      expect(sent).toHaveLength(1);
      const ended = new URL(sent[0]!.url);
      expect(ended.origin + ended.pathname).toBe(END_SESSION_ENDPOINT);
      expect(ended.searchParams.get("id_token_hint")).toBe("id-1");
    }),
  );

  it.effect("does not bring a forgotten grant back when a renewal finishes afterwards", () =>
    Effect.gen(function* () {
      const reply = gate();
      const { store, renewal, seed, tokenRequested } = setup({
        token: () => reply.opened.then(tokenReply),
      });
      yield* seed;
      const renewing = yield* renewal.renew(request).pipe(Effect.forkChild);
      yield* Effect.promise(() => tokenRequested);
      yield* renewal.forget(request);
      reply.open();
      yield* Fiber.join(renewing);
      expect(yield* Effect.promise(() => store.get(key))).toBeNull();
    }),
  );
});
