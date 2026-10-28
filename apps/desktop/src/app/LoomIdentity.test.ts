// @effect-diagnostics nodeBuiltinImport:off globalFetch:off globalDate:off - Native-boundary tests exercise real loopback callbacks and abort cleanup.
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { EnvironmentId, AuthAccessTokenType } from "@t3tools/contracts";
import { LOOM_IDENTITY_PASSKEY_REQUIRED } from "@t3tools/contracts/fork";
import {
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  IDENTITY_RESOURCE_MISMATCH_TEXT,
} from "@t3tools/shared/fork/identity-grant";
import {
  signInToLoom,
  cancelLoomSignIn,
  loomHostOrigin,
  loomLoopbackRedirect,
  loomNativeAuthorization,
  loomCallbackCode,
  verifyLoomIdToken,
} from "./LoomIdentity.ts";

const servers = new Set<NodeHttp.Server>();
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  servers.clear();
  vi.useRealTimers();
});
// Whole seconds, so the token's 5 minute expiry lands exactly on SIGNED_IN_AT + 300_000.
const SIGNED_IN_AT = Date.UTC(2026, 9, 13, 12);
async function serve(handler: NodeHttp.RequestListener) {
  const server = NodeHttp.createServer(handler);
  servers.add(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed");
  return `http://127.0.0.1:${address.port}`;
}

describe("Loom native OAuth enrollment", () => {
  it("creates S256 authorization with fixed state, nonce, resource and redirect", () => {
    const url = new URL(
      loomNativeAuthorization({
        authorizationEndpoint: "https://id.example/authorize?discard=old",
        clientId: "native",
        redirectUri: "http://127.0.0.1:5001/loom/callback",
        state: "state",
        nonce: "nonce",
        verifier: "verifier",
        scopes: ["profile", "offline_access"],
        resource: "https://library.example.com",
      }),
    );
    expect(url.searchParams.get("code_challenge")).toBe(
      NodeCrypto.createHash("sha256").update("verifier").digest("base64url"),
    );
    expect(url.searchParams.get("resource")).toBe("https://library.example.com");
    expect(url.searchParams.has("audience")).toBe(false);
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    // Without a sign-in age limit a refresh grant would never end, so none is asked for.
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.has("max_age")).toBe(false);
    expect(url.searchParams.has("discard")).toBe(false);
  });
  it("asks for a refresh grant and a fresh sign-in only where the computer caps sign-in age", () => {
    const url = new URL(
      loomNativeAuthorization({
        authorizationEndpoint: "https://id.example/authorize",
        clientId: "native",
        redirectUri: "http://127.0.0.1:5001/loom/callback",
        state: "state",
        nonce: "nonce",
        verifier: "verifier",
        scopes: ["profile", "offline_access"],
        maxSessionAgeSeconds: 7 * 86_400,
      }),
    );
    expect(url.searchParams.get("scope")).toBe("openid profile offline_access");
    expect(url.searchParams.get("max_age")).toBe(String(7 * 86_400 - 3600));
  });
  it("rejects foreign and repeated callback parameters", () => {
    const redirect = "http://127.0.0.1:5001/loom/callback";
    expect(loomCallbackCode("/loom/callback?state=one&code=valid", redirect, "one")).toBe("valid");
    for (const url of [
      "/other?state=one&code=x",
      "/loom/callback?state=wrong&code=x",
      "/loom/callback?state=one&state=one&code=x",
      "/loom/callback?state=one&code=x&code=y",
      "https://other.example/loom/callback?state=one&code=x",
    ])
      expect(() => loomCallbackCode(url, redirect, "one")).toThrow();
    expect(() => loomLoopbackRedirect("https://external.example/callback")).toThrow();
    expect(() => loomHostOrigin("https://user:secret@host.example")).toThrow();
  });
  it("verifies signed ID-token issuer, audience, expiry and nonce", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
    const origin = await serve((_request, response) =>
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ keys: [jwk] })),
    );
    const token = await new SignJWT({ nonce: "expected" })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setIssuer(origin)
      .setAudience("native")
      .setSubject("user")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const input = {
      issuer: origin,
      clientId: "native",
      jwksUri: `${origin}/jwks`,
      nonce: "expected",
    };
    expect(await verifyLoomIdToken(token, input)).toBe("user");
    await expect(verifyLoomIdToken(token, { ...input, nonce: "wrong" })).rejects.toThrow();
    await expect(verifyLoomIdToken(token, { ...input, clientId: "other" })).rejects.toThrow();
    await expect(
      verifyLoomIdToken(token, { ...input, issuer: "https://other.example" }),
    ).rejects.toThrow();
  });
  it.each([
    ...[false, true].flatMap((modern) =>
      [3600, 0, -1].map((expiresIn) => ({ modern, expiresIn, refusal: null })),
    ),
    { modern: true, expiresIn: 3600, refusal: LOOM_IDENTITY_PASSKEY_REQUIRED },
  ])(
    "accepts only live bound host sessions (modern: $modern, expires_in: $expiresIn, refusal: $refusal)",
    async ({ modern, expiresIn, refusal }) => {
      vi.useFakeTimers({ toFake: ["Date"], now: SIGNED_IN_AT });
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
      let nonce = "";
      let challenge = "";
      let redirect = "";
      let exchanged = false;
      let sentIdToken: unknown;
      let origin = "";
      origin = await serve((request, response) => {
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of request) chunks.push(Buffer.from(chunk));
          const body = new URLSearchParams(Buffer.concat(chunks).toString());
          let result: unknown;
          if (request.url === "/api/loom/identity")
            result = {
              enabled: true,
              sessionExchangeEnabled: modern,
              browserLoginEnabled: false,
              issuer: `${origin}/idp`,
              clientId: null,
              nativeClientId: "native",
              authorizationEndpoint: `${origin}/authorize`,
              tokenEndpoint: `${origin}/idp/token`,
              scopes: ["openid"],
              audience: "loom",
              environmentId: EnvironmentId.make("central"),
              ...(modern ? { resource: `${origin}/loom`, maxSessionAgeSeconds: 7 * 86_400 } : {}),
            };
          else if (request.url === "/idp/.well-known/openid-configuration")
            result = {
              issuer: `${origin}/idp`,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/idp/token`,
              jwks_uri: `${origin}/idp/jwks`,
              end_session_endpoint: `${origin}/idp/end-session`,
            };
          else if (request.url === "/idp/jwks") result = { keys: [jwk] };
          else if (request.url === "/idp/token") {
            expect(body.get("redirect_uri")).toBe(redirect);
            expect(
              NodeCrypto.createHash("sha256")
                .update(body.get("code_verifier")!)
                .digest("base64url"),
            ).toBe(challenge);
            const id = await new SignJWT({ nonce })
              .setProtectedHeader({ alg: "RS256", kid: "test" })
              .setIssuer(`${origin}/idp`)
              .setAudience("native")
              .setSubject("user")
              .setIssuedAt()
              .setExpirationTime("5m")
              .sign(privateKey);
            const access = await new SignJWT({})
              .setProtectedHeader({ alg: "RS256", kid: "test", typ: "at+jwt" })
              .setIssuer(`${origin}/idp`)
              .setAudience("loom")
              .setSubject("user")
              .setIssuedAt()
              .setExpirationTime("5m")
              .sign(privateKey);
            result = {
              id_token: id,
              access_token: access,
              token_type: "Bearer",
              refresh_token: "refresh-1",
            };
          } else if (request.url === (modern ? "/api/loom/identity/session" : "/oauth/token")) {
            if (modern) {
              const input = JSON.parse(Buffer.concat(chunks).toString());
              expect(input).toMatchObject({ type: "native", environmentId: "central" });
              expect(input.accessToken).toBeTruthy();
              expect(input).not.toHaveProperty("refreshToken");
              sentIdToken = input.idToken;
            } else expect(body.get("subject_token_type")).toBe(AuthAccessTokenType);
            exchanged = true;
            if (refusal !== null) {
              response
                .writeHead(401, { "content-type": "application/json" })
                .end(JSON.stringify({ error: refusal, message: "Passkey sign-in required." }));
              return;
            }
            result = {
              access_token: "host-session",
              issued_token_type: AuthAccessTokenType,
              token_type: "Bearer",
              expires_in: expiresIn,
              scope: "orchestration:read",
              ...(modern
                ? {
                    environmentId: "central",
                    identity: { issuer: `${origin}/idp`, subject: "user" },
                  }
                : {}),
            };
          } else {
            response.writeHead(404).end();
            return;
          }
          response
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify(result));
        })().catch(() => response.writeHead(500).end());
      });
      // Pinned to the computer's own issuer, as a Library directory sign-in is, and typed at an
      // address the Library lists for it.
      const pending = signInToLoom(
        origin,
        async (authorizationUrl) => {
          const url = new URL(authorizationUrl);
          nonce = url.searchParams.get("nonce")!;
          challenge = url.searchParams.get("code_challenge")!;
          expect(url.searchParams.has("max_age")).toBe(modern);
          redirect = url.searchParams.get("redirect_uri")!;
          const wrong = new URL(redirect);
          wrong.search = "state=wrong&code=bad";
          expect((await fetch(wrong)).status).toBe(400);
          const callback = new URL(redirect);
          callback.search = new URLSearchParams({
            state: url.searchParams.get("state")!,
            code: "valid",
          }).toString();
          expect((await fetch(callback)).status).toBe(200);
          return true;
        },
        undefined,
        {
          expectedIssuer: `${origin}/idp`,
          directory: {
            library: {
              environmentId: EnvironmentId.make("library"),
              label: "Helios",
              addresses: [],
            },
            computers: [
              {
                environmentId: EnvironmentId.make("central"),
                label: "Central",
                addresses: [`${origin}/`],
              },
            ],
          },
        },
      );
      if (refusal !== null) {
        await expect(pending).rejects.toThrow(IDENTITY_PASSKEY_REQUIRED_TEXT);
        expect(exchanged).toBe(true);
        await expect(fetch(redirect)).rejects.toThrow();
        return;
      }
      if (expiresIn <= 0) {
        await expect(pending).rejects.toThrow();
        expect(exchanged).toBe(true);
        await expect(fetch(redirect)).rejects.toThrow();
        return;
      }
      const { session, grant } = await pending;
      expect(session).toEqual({
        httpBaseUrl: origin,
        environmentId: "central",
        accessToken: "host-session",
        identity: { issuer: `${origin}/idp`, subject: "user" },
        expiresAt: SIGNED_IN_AT + 300_000,
      });
      expect(exchanged).toBe(true);
      if (modern) {
        // The computer reads auth_time from the ID token to cap renewable sign-ins.
        expect(sentIdToken).toEqual(expect.any(String));
        expect(grant).toMatchObject({
          issuer: `${origin}/idp`,
          subject: "user",
          environmentId: "central",
          httpBaseUrl: origin,
          clientId: "native",
          tokenEndpoint: `${origin}/idp/token`,
          endSessionEndpoint: `${origin}/idp/end-session`,
          refreshToken: "refresh-1",
          idToken: sentIdToken,
        });
      } else expect(grant).toBeNull();
      await expect(fetch(redirect)).rejects.toThrow();
    },
  );
  it("rejects saved environment, issuer and resource changes before opening the provider", async () => {
    let origin = "";
    let resource: string | undefined;
    origin = await serve((_request, response) =>
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          enabled: true,
          browserLoginEnabled: false,
          issuer: "https://id.example.test",
          clientId: null,
          nativeClientId: "native",
          authorizationEndpoint: "https://id.example.test/authorize",
          tokenEndpoint: "https://id.example.test/token",
          scopes: ["openid"],
          audience: "computer",
          environmentId: "computer",
          ...(resource === undefined ? {} : { resource }),
        }),
      ),
    );
    const open = vi.fn(async () => true);
    await expect(
      signInToLoom(origin, open, undefined, { expectedEnvironmentId: EnvironmentId.make("other") }),
    ).rejects.toThrow("another computer");
    await expect(
      signInToLoom(origin, open, undefined, {
        expectedIdentity: { issuer: "https://other.test", subject: "user" },
      }),
    ).rejects.toThrow("provider changed");
    // A directory computer is pinned to the Library's issuer even when no account is saved.
    await expect(
      signInToLoom(origin, open, undefined, { expectedIssuer: "https://library-id.test" }),
    ).rejects.toThrow("different sign-in provider than your Library");
    // Copied metadata cannot make a typed address pass for a computer the Library lists elsewhere.
    const computer = EnvironmentId.make("computer");
    const library = {
      environmentId: EnvironmentId.make("library"),
      label: "Helios",
      addresses: [],
    };
    await expect(
      signInToLoom(origin, open, undefined, {
        directory: {
          library,
          computers: [
            {
              environmentId: computer,
              label: "Studio",
              addresses: ["https://studio.example.test"],
            },
          ],
        },
      }),
    ).rejects.toThrow("This address says it is Studio, but your Library lists Studio");
    await expect(
      signInToLoom(origin, open, undefined, {
        directory: {
          library: {
            ...library,
            environmentId: computer,
            addresses: ["https://library.example.test"],
          },
          computers: [],
        },
      }),
    ).rejects.toThrow("This address says it is your Library, Helios");
    // A computer naming another computer's resource would collect a sign-in that one accepts.
    resource = "https://library.example.test/computers/other";
    await expect(signInToLoom(origin, open)).rejects.toThrow(IDENTITY_RESOURCE_MISMATCH_TEXT);
    expect(open).not.toHaveBeenCalled();
  });

  it("cancels a sign-in and closes the owned loopback listener", async () => {
    let origin = "";
    let redirect = "";
    origin = await serve((request, response) => {
      const result =
        request.url === "/api/loom/identity"
          ? {
              enabled: true,
              browserLoginEnabled: false,
              issuer: `${origin}/idp`,
              clientId: null,
              nativeClientId: "native",
              authorizationEndpoint: `${origin}/authorize`,
              tokenEndpoint: `${origin}/token`,
              scopes: ["openid"],
              audience: "loom",
              environmentId: "central",
            }
          : {
              issuer: `${origin}/idp`,
              authorization_endpoint: `${origin}/authorize`,
              token_endpoint: `${origin}/token`,
              jwks_uri: `${origin}/jwks`,
            };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
    });
    await expect(
      signInToLoom(origin, async (url) => {
        redirect = new URL(url).searchParams.get("redirect_uri")!;
        cancelLoomSignIn(origin);
        return true;
      }),
    ).rejects.toThrow(/cancelled/);
    await expect(fetch(redirect)).rejects.toThrow();
  });
});
