// @effect-diagnostics nodeBuiltinImport:off globalFetch:off - Native-boundary tests exercise real loopback callbacks and abort cleanup.
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { EnvironmentId, AuthAccessTokenType } from "@t3tools/contracts";
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
});
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
        scopes: ["profile"],
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
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.has("discard")).toBe(false);
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
  it("exchanges a verified loopback response into an ordinary host bearer session", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
    let nonce = "";
    let challenge = "";
    let redirect = "";
    let exchanged = false;
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
            browserLoginEnabled: false,
            issuer: `${origin}/idp`,
            clientId: null,
            nativeClientId: "native",
            authorizationEndpoint: `${origin}/authorize`,
            tokenEndpoint: `${origin}/idp/token`,
            scopes: ["openid"],
            audience: "loom",
            environmentId: EnvironmentId.make("central"),
          };
        else if (request.url === "/idp/.well-known/openid-configuration")
          result = {
            issuer: `${origin}/idp`,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/idp/token`,
            jwks_uri: `${origin}/idp/jwks`,
          };
        else if (request.url === "/idp/jwks") result = { keys: [jwk] };
        else if (request.url === "/idp/token") {
          expect(body.get("redirect_uri")).toBe(redirect);
          expect(
            NodeCrypto.createHash("sha256").update(body.get("code_verifier")!).digest("base64url"),
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
          result = { id_token: id, access_token: access, token_type: "Bearer" };
        } else if (request.url === "/oauth/token") {
          expect(body.get("subject_token_type")).toBe(AuthAccessTokenType);
          exchanged = true;
          result = {
            access_token: "host-session",
            issued_token_type: AuthAccessTokenType,
            token_type: "Bearer",
            expires_in: 3600,
            scope: "orchestration:read",
          };
        } else {
          response.writeHead(404).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      })().catch(() => response.writeHead(500).end());
    });
    const result = await signInToLoom(origin, async (authorizationUrl) => {
      const url = new URL(authorizationUrl);
      nonce = url.searchParams.get("nonce")!;
      challenge = url.searchParams.get("code_challenge")!;
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
    });
    expect(result).toEqual({
      httpBaseUrl: origin,
      environmentId: "central",
      accessToken: "host-session",
    });
    expect(exchanged).toBe(true);
    await expect(fetch(redirect)).rejects.toThrow();
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
