import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import { LOOM_IDENTITY_SESSION_PATH } from "@t3tools/contracts/fork";
import * as Base64Url from "effect/encoding/Base64Url";

import {
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  IDENTITY_RESOURCE_MISMATCH_TEXT,
  type IdentityGrant,
  type IdentityGrantFetch,
  IdentityGrantTransientError,
  identityGrantKey,
  identityMetadataResource,
  identityResourceRefusal,
  makeKeyedSingleFlight,
  renewIdentityGrant,
  savedIdentitySignInPin,
} from "./identityGrant.ts";

const NOW = 1_800_000_000_000;
const TOKEN_ENDPOINT = "https://id.example.test/api/oidc/token";
const COMPUTER = "https://computer.example.test";
const environmentId = EnvironmentId.make("env-renewal");

const grant: IdentityGrant = {
  version: 1,
  issuer: "https://id.example.test",
  subject: "subject-1",
  environmentId,
  httpBaseUrl: COMPUTER,
  clientId: "native-client",
  tokenEndpoint: TOKEN_ENDPOINT,
  resource: "https://computer.example.test/api",
  refreshToken: "refresh-old",
  idToken: "id-old",
  grantedAt: NOW - 60_000,
  updatedAt: NOW - 60_000,
};

const jwt = (claims: Record<string, unknown>) =>
  `e30.${Base64Url.encode(JSON.stringify(claims))}.sig`;
const accessToken = jwt({ sub: grant.subject, exp: NOW / 1000 + 600 });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const tokenReply = () =>
  json(200, {
    token_type: "Bearer",
    access_token: accessToken,
    id_token: "id-new",
    refresh_token: "refresh-new",
  });

const sessionReply = () =>
  json(200, {
    access_token: "computer-session",
    issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    token_type: "Bearer",
    expires_in: 3600,
    scope: "orchestration:read",
    environmentId,
    identity: { issuer: grant.issuer, subject: grant.subject },
  });

interface Sent {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(
  log: Array<string>,
  replies: {
    token: () => Response | Promise<Response>;
    session: () => Response | Promise<Response>;
  },
) {
  const sent: Array<Sent> = [];
  const fetch: IdentityGrantFetch = async (url, init) => {
    sent.push({ url, init });
    if (url === TOKEN_ENDPOINT) {
      log.push("refresh");
      return replies.token();
    }
    if (url === `${COMPUTER}${LOOM_IDENTITY_SESSION_PATH}`) {
      log.push("exchange");
      return replies.session();
    }
    throw new Error(`unexpected request to ${url}`);
  };
  return { fetch, sent };
}

const renew = (fetch: IdentityGrantFetch, log: Array<string> = [], currentToken?: string) =>
  renewIdentityGrant(grant, {
    fetch,
    now: () => NOW,
    currentToken: currentToken ?? null,
    onRotated: async (rotated) => {
      log.push(`persist:${rotated.refreshToken}`);
    },
  });

describe("renewIdentityGrant", () => {
  it("persists the rotated grant before sending the exchange", async () => {
    const log: Array<string> = [];
    const { fetch, sent } = fakeFetch(log, { token: tokenReply, session: sessionReply });

    const result = await renew(fetch, log, "computer-session-old");

    expect(log).toEqual(["refresh", "persist:refresh-new", "exchange"]);
    expect(result).toMatchObject({
      _tag: "Renewed",
      grant: { refreshToken: "refresh-new", idToken: "id-new", updatedAt: NOW },
      session: {
        httpBaseUrl: COMPUTER,
        environmentId,
        accessToken: "computer-session",
        identity: { issuer: grant.issuer, subject: grant.subject },
        // The Identity access token expires before the computer's one-hour cap.
        expiresAt: NOW + 600_000,
      },
    });
    const refreshBody = new URLSearchParams(String(sent[0]?.init.body));
    expect(Object.fromEntries(refreshBody)).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-old",
      client_id: "native-client",
      resource: "https://computer.example.test/api",
    });
    expect(sent[1]?.init.headers).toMatchObject({ authorization: "Bearer computer-session-old" });
    expect(sent[1]?.init.credentials).toBe("omit");
    expect(JSON.parse(String(sent[1]?.init.body))).toEqual({
      type: "native",
      accessToken,
      idToken: "id-new",
      environmentId,
      expectedIdentity: { issuer: grant.issuer, subject: grant.subject },
    });
  });

  it("keeps the previous refresh token when the issuer does not rotate it", async () => {
    const log: Array<string> = [];
    const { fetch } = fakeFetch(log, {
      token: () =>
        json(200, { token_type: "bearer", access_token: accessToken, id_token: "id-new" }),
      session: sessionReply,
    });

    const result = await renew(fetch, log);

    expect(log).toEqual(["refresh", "persist:refresh-old", "exchange"]);
    expect(result._tag).toBe("Renewed");
  });

  it("never sends the refresh token to the computer", async () => {
    const { fetch, sent } = fakeFetch([], { token: tokenReply, session: sessionReply });

    await renew(fetch, [], "computer-session-old");

    const toComputer = sent.filter((request) => request.url.startsWith(COMPUTER));
    expect(toComputer).toHaveLength(1);
    const serialized = JSON.stringify(toComputer);
    expect(serialized).not.toContain("refresh-old");
    expect(serialized).not.toContain("refresh-new");
  });

  it("asks for a sign-in when the issuer rejects the grant", async () => {
    const log: Array<string> = [];
    const { fetch } = fakeFetch(log, {
      token: () => json(400, { error: "invalid_grant" }),
      session: sessionReply,
    });

    const result = await renew(fetch, log);

    expect(result._tag).toBe("SignInRequired");
    expect(log).toEqual(["refresh"]);
  });

  it("asks for a sign-in when the refreshed reply has no ID token", async () => {
    const { fetch } = fakeFetch([], {
      token: () => json(200, { token_type: "Bearer", access_token: accessToken }),
      session: sessionReply,
    });

    expect((await renew(fetch))._tag).toBe("SignInRequired");
  });

  it("asks for a sign-in when the computer says the sign-in reached its age limit", async () => {
    const { fetch } = fakeFetch([], {
      token: tokenReply,
      session: () => json(401, { error: "sign_in_expired", message: "Sign in again." }),
    });

    const result = await renew(fetch);

    expect(result).toEqual({
      _tag: "SignInRequired",
      reason: "Your Loom sign-in reached its time limit. Sign in again.",
    });
  });

  it("keeps the rotated grant and asks for a passkey sign-in when the computer requires one", async () => {
    const log: Array<string> = [];
    const { fetch } = fakeFetch(log, {
      token: tokenReply,
      session: () => json(401, { error: "passkey_required", message: "Use a passkey." }),
    });

    const result = await renew(fetch, log);

    expect(result).toEqual({ _tag: "SignInRequired", reason: IDENTITY_PASSKEY_REQUIRED_TEXT });
    expect(log).toEqual(["refresh", "persist:refresh-new", "exchange"]);
  });

  it("asks for a sign-in when the computer refuses the account", async () => {
    const { fetch } = fakeFetch([], {
      token: tokenReply,
      session: () => json(401, { error: "sign_in_failed" }),
    });

    expect(await renew(fetch)).toEqual({
      _tag: "SignInRequired",
      reason: "This computer did not accept the Loom sign-in. Sign in again.",
    });
  });

  it("exchanges at another address of the same computer", async () => {
    const urls: Array<string> = [];
    const fetch: IdentityGrantFetch = async (url) => {
      urls.push(url);
      return url === TOKEN_ENDPOINT ? tokenReply() : sessionReply();
    };

    const result = await renewIdentityGrant(grant, {
      httpBaseUrl: "https://computer.tailnet.test",
      fetch,
      now: () => NOW,
      onRotated: async () => {},
    });

    expect(urls).toEqual([
      TOKEN_ENDPOINT,
      `https://computer.tailnet.test${LOOM_IDENTITY_SESSION_PATH}`,
    ]);
    expect(result).toMatchObject({
      _tag: "Renewed",
      session: { httpBaseUrl: "https://computer.tailnet.test" },
    });
  });

  it("keeps the grant when an address answers with something other than Loom", async () => {
    const { fetch } = fakeFetch([], {
      token: tokenReply,
      session: () => new Response("<html>Not Found</html>", { status: 404 }),
    });

    await expect(renew(fetch)).rejects.toBeInstanceOf(IdentityGrantTransientError);
  });

  it("treats an unavailable issuer as transient", async () => {
    const { fetch } = fakeFetch([], {
      token: () => json(503, { error: "temporarily_unavailable" }),
      session: sessionReply,
    });

    await expect(renew(fetch)).rejects.toBeInstanceOf(IdentityGrantTransientError);
  });

  it("treats an unreachable computer as transient after persisting the rotation", async () => {
    const log: Array<string> = [];
    const { fetch } = fakeFetch(log, {
      token: tokenReply,
      session: () => Promise.reject(new TypeError("fetch failed")),
    });

    await expect(renew(fetch, log)).rejects.toBeInstanceOf(IdentityGrantTransientError);
    expect(log).toEqual(["refresh", "persist:refresh-new", "exchange"]);
  });

  it("treats a failed save as transient and never exchanges an unsaved rotation", async () => {
    const log: Array<string> = [];
    const { fetch } = fakeFetch(log, { token: tokenReply, session: sessionReply });

    await expect(
      renewIdentityGrant(grant, {
        fetch,
        now: () => NOW,
        onRotated: () => Promise.reject(new Error("disk full")),
      }),
    ).rejects.toBeInstanceOf(IdentityGrantTransientError);
    expect(log).toEqual(["refresh"]);
  });
});

describe("makeKeyedSingleFlight", () => {
  it("shares one refresh among concurrent callers for a grant", async () => {
    const log: Array<string> = [];
    let releaseToken!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    const { fetch } = fakeFetch(log, {
      token: () => tokenGate.then(tokenReply),
      session: sessionReply,
    });
    const singleFlight = makeKeyedSingleFlight<Awaited<ReturnType<typeof renew>>>();
    const key = identityGrantKey(grant);

    const first = singleFlight(key, () => renew(fetch, log));
    const second = singleFlight(key, () => renew(fetch, log));
    releaseToken();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toBe(b);
    expect(log.filter((entry) => entry === "refresh")).toHaveLength(1);

    await singleFlight(key, () => renew(fetch, log));
    expect(log.filter((entry) => entry === "refresh")).toHaveLength(2);
  });

  it("clears a failed flight so the next caller retries", async () => {
    const singleFlight = makeKeyedSingleFlight<string>();

    await expect(singleFlight("k", () => Promise.reject(new Error("offline")))).rejects.toThrow(
      "offline",
    );
    await expect(singleFlight("k", async () => "ok")).resolves.toBe("ok");
  });
});

describe("identityGrantKey", () => {
  it("is stable per account and computer and safe as a keychain item name", () => {
    const key = identityGrantKey(grant);

    expect(identityGrantKey({ ...grant })).toBe(key);
    expect(identityGrantKey({ ...grant, environmentId: EnvironmentId.make("env-other") })).not.toBe(
      key,
    );
    expect(key).toMatch(/^[a-z0-9.-]+$/u);
  });
});

describe("identity resource pin", () => {
  const metadata = {
    audience: "https://computer.example.test",
    resource: "https://lib/computers/a",
  };

  it("pins the resource indicator, else the audience", () => {
    expect(identityMetadataResource(metadata)).toBe("https://lib/computers/a");
    expect(identityMetadataResource({ audience: "https://computer.example.test" })).toBe(
      "https://computer.example.test",
    );
  });

  it("refuses metadata naming another resource, and nothing when no pin is set", () => {
    expect(identityResourceRefusal("https://lib/computers/a", metadata)).toBeNull();
    expect(identityResourceRefusal(undefined, metadata)).toBeNull();
    expect(identityResourceRefusal("https://lib/computers/b", metadata)).toBe(
      IDENTITY_RESOURCE_MISMATCH_TEXT,
    );
    expect(
      identityResourceRefusal("https://lib/computers/a", { audience: "https://lib/computers/b" }),
    ).toBe(IDENTITY_RESOURCE_MISMATCH_TEXT);
  });

  it("pins a saved connection's account, and its resource once one was recorded", () => {
    const identity = { issuer: grant.issuer, subject: grant.subject };
    expect(savedIdentitySignInPin({ identity })).toEqual({ expectedIdentity: identity });
    expect(
      savedIdentitySignInPin({ identity, identityResource: "https://lib/computers/a" }),
    ).toEqual({ expectedIdentity: identity, expectedResource: "https://lib/computers/a" });
    expect(savedIdentitySignInPin({})).toEqual({});
  });
});
