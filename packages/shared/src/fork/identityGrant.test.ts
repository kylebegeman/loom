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
  identityAddressOrigin,
  identityAddressRefusal,
  identityGrantKey,
  identityResourceEnvironment,
  identityResourceRefusal,
  makeKeyedSingleFlight,
  renewIdentityGrant,
} from "./identityGrant.ts";
import { reachResource } from "./reach.ts";

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

  it("asks for a sign-in when the computer's resource is gone or the grant was revoked", async () => {
    // Retire with "Also end Loom sign-in" deletes the resource; removing access revokes the grant.
    for (const [status, error, reason] of [
      [400, "invalid_target", "This computer's Loom sign-in changed. Sign in again."],
      [
        403,
        "access_denied",
        "Loom Identity no longer accepts this device's sign-in. Sign in again.",
      ],
    ] as const) {
      const log: Array<string> = [];
      const { fetch } = fakeFetch(log, {
        token: () => json(status, { error }),
        session: sessionReply,
      });

      expect(await renew(fetch, log)).toEqual({ _tag: "SignInRequired", reason });
      expect(log).toEqual(["refresh"]);
    }
  });

  it("retries a refusal it does not recognize", async () => {
    const { fetch } = fakeFetch([], {
      token: () => json(403, { error: "forbidden_by_proxy" }),
      session: sessionReply,
    });

    await expect(renew(fetch)).rejects.toBeInstanceOf(IdentityGrantTransientError);
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

describe("identityResourceRefusal", () => {
  const LIBRARY = "https://library.example.test";
  const BOOK = EnvironmentId.make("book");
  const DESK = EnvironmentId.make("desk");
  const own = reachResource(LIBRARY, BOOK)!;
  const other = reachResource(LIBRARY, DESK)!;
  const book = (fields: { readonly audience: string; readonly resource?: string }) => ({
    environmentId: BOOK,
    ...fields,
  });

  it("reads the environment from the resource the Library derives for each computer", () => {
    expect(identityResourceEnvironment(own)).toBe(BOOK);
    expect(identityResourceEnvironment(`${own}/`)).toBe(BOOK);
  });

  it("accepts a computer before, during and after it moves to its own resource", () => {
    // Before reach, while copied settings name both, after adoption, and after a revert.
    expect(identityResourceRefusal(book({ audience: "loom" }))).toBeNull();
    expect(identityResourceRefusal(book({ audience: "https://loom.example.test/api" }))).toBeNull();
    expect(identityResourceRefusal(book({ audience: "loom", resource: own }))).toBeNull();
    expect(identityResourceRefusal(book({ audience: own, resource: own }))).toBeNull();
    expect(identityResourceRefusal(book({ audience: own }))).toBeNull();
  });

  it("refuses a computer naming another computer's resource", () => {
    expect(identityResourceRefusal(book({ audience: other, resource: other }))).toBe(
      IDENTITY_RESOURCE_MISMATCH_TEXT,
    );
    expect(identityResourceRefusal(book({ audience: "loom", resource: other }))).toBe(
      IDENTITY_RESOURCE_MISMATCH_TEXT,
    );
    // Pocket ID strips trailing slashes before its lookup, so this still reaches DESK's resource.
    expect(identityResourceRefusal(book({ audience: `${other}//` }))).toBe(
      IDENTITY_RESOURCE_MISMATCH_TEXT,
    );
    expect(
      identityResourceRefusal(book({ audience: "https://elsewhere.example.test/computers/desk" })),
    ).toBe(IDENTITY_RESOURCE_MISMATCH_TEXT);
  });

  it("treats values that are not a per-computer resource as shared", () => {
    for (const audience of [
      "",
      "not a url",
      "http://library.example.test/computers/desk",
      "https://library.example.test/computers/",
      "https://library.example.test/computers/desk/api",
      "https://library.example.test/library/computers/desk",
    ]) {
      expect(identityResourceEnvironment(audience)).toBeNull();
      expect(identityResourceRefusal(book({ audience }))).toBeNull();
    }
  });
});

describe("identityAddressRefusal", () => {
  const LIBRARY = EnvironmentId.make("library");
  const BOOK = EnvironmentId.make("book");
  const DESK = EnvironmentId.make("desk");
  const directory = {
    library: {
      environmentId: LIBRARY,
      label: "Helios",
      addresses: ["https://library.example.test/", "http://192.168.1.4:3773"],
    },
    computers: [
      {
        environmentId: BOOK,
        label: "Book",
        addresses: ["https://book.example.test", "https://book.tail1234.ts.net:8443/"],
      },
      { environmentId: DESK, label: "Desk", addresses: [] },
    ],
  };
  const refusal = (httpBaseUrl: string, environmentId: string, within = directory) =>
    identityAddressRefusal({ httpBaseUrl, environmentId, directory: within });

  it("lets a listed computer sign in at any address the directory reports for it", () => {
    expect(refusal("https://book.example.test", BOOK)).toBeNull();
    // Tailnet routes count as much as public ones.
    expect(refusal("https://book.tail1234.ts.net:8443", BOOK)).toBeNull();
  });

  it("refuses a server claiming a listed computer at an address the directory does not report", () => {
    expect(refusal("https://evil.example.test", BOOK)).toBe(
      "This address says it is Book, but your Library lists Book at other addresses. Sign in from your Library's computer list, or use a pairing link.",
    );
    // Another computer's own route is still not this computer's.
    expect(refusal("https://book.example.test", DESK)).toContain("This address says it is Desk");
    // Same host, other scheme or port, is another server.
    expect(refusal("http://book.example.test", BOOK)).not.toBeNull();
    expect(refusal("https://book.tail1234.ts.net", BOOK)).not.toBeNull();
    expect(refusal("https://book.example.test:8443", BOOK)).not.toBeNull();
  });

  it("refuses a listed computer the directory has no address for", () => {
    expect(refusal("https://desk.example.test", DESK)).toBe(
      "This address says it is Desk, but your Library has no address for Desk. Use a pairing link.",
    );
  });

  it("keeps today's sign-in for a computer the Library does not list, or with no directory", () => {
    expect(refusal("https://studio.example.test", "studio")).toBeNull();
    expect(
      identityAddressRefusal({
        httpBaseUrl: "https://evil.example.test",
        environmentId: BOOK,
        directory: undefined,
      }),
    ).toBeNull();
    expect(
      identityAddressRefusal({
        httpBaseUrl: "https://evil.example.test",
        environmentId: BOOK,
        directory: null,
      }),
    ).toBeNull();
  });

  it("holds the Library to the addresses this device knows it at", () => {
    expect(refusal("https://library.example.test", LIBRARY)).toBeNull();
    expect(refusal("http://192.168.1.4:3773/", LIBRARY)).toBeNull();
    expect(refusal("https://evil.example.test", LIBRARY)).toBe(
      "This address says it is your Library, Helios, but this device knows Helios at other addresses. Sign in at its saved address, or use a pairing link.",
    );
    // A Library its own directory lists may also use the routes it reports.
    const listed = {
      ...directory,
      computers: [
        ...directory.computers,
        { environmentId: LIBRARY, label: "library", addresses: ["https://helios.example.test"] },
      ],
    };
    expect(refusal("https://helios.example.test", LIBRARY, listed)).toBeNull();
    expect(refusal("https://evil.example.test", LIBRARY, listed)).toContain("your Library, Helios");
    // With no address for it on this device or in the directory, nothing says where it should be.
    const unknown = { ...directory, library: { ...directory.library, addresses: [] } };
    expect(refusal("https://evil.example.test", LIBRARY, unknown)).toBeNull();
  });

  it("compares addresses as origins", () => {
    for (const typed of [
      "https://BOOK.Example.TEST",
      "https://book.example.test/",
      "https://book.example.test:443",
      "https://book.example.test./",
      "https://book.example.test/some/path",
      "  https://book.example.test  ",
    ])
      expect(refusal(typed, BOOK), typed).toBeNull();
    const v6 = {
      library: { environmentId: LIBRARY, label: "Helios", addresses: [] },
      computers: [
        {
          environmentId: BOOK,
          label: "Book",
          addresses: ["http://[fd7a:115c:a1e0::1]:3773", "http://book.local:80"],
        },
      ],
    };
    expect(refusal("http://[FD7A:115C:A1E0:0:0:0:0:1]:3773/", BOOK, v6)).toBeNull();
    expect(refusal("http://[fd7a:115c:a1e0::2]:3773", BOOK, v6)).not.toBeNull();
    expect(refusal("http://book.local", BOOK, v6)).toBeNull();
    // An address that does not parse is not one of the computer's.
    expect(refusal("not a url", BOOK)).not.toBeNull();
    expect(refusal("ftp://book.example.test", BOOK)).not.toBeNull();
  });

  it("normalizes an address to its comparable origin", () => {
    expect(identityAddressOrigin("HTTPS://Book.Example.Test.:443/x?y#z")).toBe(
      "https://book.example.test",
    );
    expect(identityAddressOrigin("http://[::1]:80/")).toBe("http://[::1]");
    expect(identityAddressOrigin("http://book.example.test:8080")).toBe(
      "http://book.example.test:8080",
    );
    expect(identityAddressOrigin("book.example.test")).toBeNull();
    expect(identityAddressOrigin("")).toBeNull();
  });
});
