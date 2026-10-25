import { AuthAccessTokenType, AuthTokenExchangeGrantType, EnvironmentId } from "@t3tools/contracts";
import type { LoomIdentityMetadata } from "@t3tools/contracts/fork";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  IDENTITY_PASSKEY_REQUIRED_TEXT,
  IDENTITY_RESOURCE_MISMATCH_TEXT,
  identityGrantKey,
} from "@t3tools/shared/fork/identity-grant";
import {
  completeNativeIdentitySignIn,
  exchangeLibraryIdentityToken,
  libraryIdentityAddress,
  libraryIdentityResourceParameters,
  loadLibraryIdentity,
  loadNativeIdentityDiscovery,
  assertNativeIdentityUnchanged,
  nativeIdentityAuthorizationParameters,
  nativeIdentityScopes,
  type IdentityOptions,
} from "./libraryIdentity";
const environmentId = EnvironmentId.make("selected-library");
const metadata: LoomIdentityMetadata = {
  enabled: true,
  browserLoginEnabled: true,
  issuer: "https://identity.example",
  clientId: "web-client",
  nativeClientId: "native-client",
  authorizationEndpoint: "https://identity.example/authorize",
  tokenEndpoint: "https://identity.example/token",
  scopes: ["openid", "profile"],
  audience: "loom",
  environmentId,
};
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
describe("native library identity", () => {
  it("requests Pocket ID custom API access with the RFC 8707 resource parameter", () => {
    expect(
      libraryIdentityResourceParameters({ ...metadata, resource: "https://loom.begam.in" }),
    ).toEqual({ resource: "https://loom.begam.in" });
    expect(libraryIdentityResourceParameters(metadata)).toEqual({});
  });
  it("uses the explicitly entered address and verifies the saved destination", async () => {
    const request = vi.fn<typeof fetch>(async () => response(metadata));
    expect(libraryIdentityAddress("https://library.example:9443/")).toEqual({
      httpBaseUrl: "https://library.example:9443",
      wsBaseUrl: "wss://library.example:9443/ws",
    });
    await expect(
      loadLibraryIdentity("https://library.example:9443", environmentId, request),
    ).resolves.toMatchObject({ nativeClientId: "native-client", environmentId });
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://library.example:9443/api/loom/identity",
    );
    await expect(
      loadLibraryIdentity(
        "https://library.example:9443",
        EnvironmentId.make("different-library"),
        request,
      ),
    ).rejects.toThrow("another computer");
  });
  it("requires native PKCE configuration and rejects embedded credentials", async () => {
    expect(() => libraryIdentityAddress("https://user:password@library.example")).toThrow(
      "without a path or credentials",
    );
    const request = vi.fn<typeof fetch>(async () =>
      response({ ...metadata, nativeClientId: undefined }),
    );
    await expect(
      loadLibraryIdentity("https://library.example", environmentId, request),
    ).rejects.toThrow("Native Identity sign-in is not configured");
  });
  it("exchanges the identity access token for a bearer on the exact library address", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({
        access_token: "test-host-session",
        issued_token_type: AuthAccessTokenType,
        token_type: "Bearer",
        expires_in: 300,
        scope: "orchestration:read",
      }),
    );
    expect(
      await exchangeLibraryIdentityToken(
        "https://library.example",
        "test-identity-access",
        request,
      ),
    ).toMatchObject({ access_token: "test-host-session", token_type: "Bearer" });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe("https://library.example/oauth/token");
    expect(init?.redirect).toBe("error");
    expect(init?.headers).not.toHaveProperty("DPoP");
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: AuthTokenExchangeGrantType,
      subject_token_type: AuthAccessTokenType,
      requested_token_type: AuthAccessTokenType,
      subject_token: "test-identity-access",
    });
  });
  it("does not accept a DPoP or expired result as a saved bearer", async () => {
    const request = vi.fn<typeof fetch>(async () =>
      response({
        access_token: "test-session",
        issued_token_type: AuthAccessTokenType,
        token_type: "DPoP",
        expires_in: 300,
        scope: "orchestration:read",
      }),
    );
    await expect(
      exchangeLibraryIdentityToken("https://library.example", "test-identity", request),
    ).rejects.toThrow("unsupported or expired");
    request.mockResolvedValueOnce(
      response({
        access_token: "test-session",
        issued_token_type: AuthAccessTokenType,
        token_type: "Bearer",
        expires_in: 0,
        scope: "orchestration:read",
      }),
    );
    await expect(
      exchangeLibraryIdentityToken("https://library.example", "test-identity", request),
    ).rejects.toThrow("unsupported or expired");
  });
});

describe("ordinary computer Identity", () => {
  const modern = { ...metadata, sessionExchangeEnabled: true };
  const identity = { issuer: metadata.issuer!, subject: "owner" };
  const session = {
    access_token: "computer-session",
    issued_token_type: AuthAccessTokenType,
    token_type: "Bearer",
    expires_in: 600,
    scope: "orchestration:read",
    environmentId,
    identity,
  };
  it("pins the saved issuer and requires a host that returns verified account provenance", async () => {
    const request = vi.fn<typeof fetch>(async () => response(metadata));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, {
        requireSessionExchange: true,
      }),
    ).rejects.toThrow("Update this computer");
    request.mockResolvedValueOnce(response(modern));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, {
        expectedIdentity: { ...identity, issuer: "https://other-id.test" },
      }),
    ).rejects.toThrow("provider changed");
    // A directory computer has no saved account yet, so only the Library's issuer pins it.
    request.mockResolvedValueOnce(response(modern));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, {
        expectedIssuer: "https://other-id.test",
      }),
    ).rejects.toThrow("different sign-in provider than your Library");
    request.mockResolvedValueOnce(response(modern));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, {
        expectedIssuer: identity.issuer,
      }),
    ).resolves.toMatchObject({ issuer: identity.issuer });
    // A Library-attested or saved resource pins the computer before the provider sheet opens.
    const pinned = "https://library.example/computers/selected-library";
    const pinnedOptions = { expectedResource: pinned };
    request.mockResolvedValueOnce(response({ ...modern, resource: pinned }));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, pinnedOptions),
    ).resolves.toMatchObject({ resource: pinned });
    request.mockResolvedValueOnce(
      response({ ...modern, resource: "https://library.example/computers/other" }),
    );
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, pinnedOptions),
    ).rejects.toThrow(IDENTITY_RESOURCE_MISMATCH_TEXT);
    // A computer that names no resource is issued for its audience.
    request.mockResolvedValueOnce(response(modern));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, pinnedOptions),
    ).rejects.toThrow(IDENTITY_RESOURCE_MISMATCH_TEXT);
    request.mockResolvedValueOnce(response(modern));
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, {
        expectedResource: modern.audience,
      }),
    ).resolves.toMatchObject({ audience: modern.audience });
    for (const tokenEndpoint of [
      "http://identity.example/token",
      "https://user:secret@identity.example/token",
    ]) {
      request.mockResolvedValueOnce(response({ ...modern, tokenEndpoint }));
      await expect(
        loadLibraryIdentity("https://computer.example", environmentId, request),
      ).rejects.toThrow("insecure Identity");
    }
  });
  it("checks discovery against the configured issuer and detects host changes after account sign-in", async () => {
    const discovery = {
      issuer: metadata.issuer,
      authorization_endpoint: metadata.authorizationEndpoint,
      token_endpoint: metadata.tokenEndpoint,
    };
    const request = vi.fn<typeof fetch>(async () => response(discovery));
    await expect(loadNativeIdentityDiscovery(modern, request)).resolves.toEqual({
      authorizationEndpoint: metadata.authorizationEndpoint,
      tokenEndpoint: metadata.tokenEndpoint,
    });
    request.mockResolvedValueOnce(response({ ...discovery, issuer: "https://attacker.test" }));
    await expect(loadNativeIdentityDiscovery(modern, request)).rejects.toThrow(
      "configuration changed",
    );
    for (const changed of [
      { ...modern, environmentId: EnvironmentId.make("other") },
      { ...modern, nativeClientId: "other" },
      { ...modern, audience: "library-only" },
      { ...modern, resource: "https://other-computer.test" },
      { ...modern, tokenEndpoint: "https://other-id.test/token" },
    ]) {
      expect(() => assertNativeIdentityUnchanged(modern, changed)).toThrow("configuration changed");
    }
    expect(() => assertNativeIdentityUnchanged(modern, modern)).not.toThrow();
  });
  it("exchanges in JSON at the selected computer and binds the result to the saved account", async () => {
    const request = vi.fn<typeof fetch>(async () => response(session));
    const abort = new AbortController();
    await expect(
      exchangeLibraryIdentityToken("https://computer.example", "provider-access", request, {
        metadata: modern,
        expectedIdentity: identity,
        signal: abort.signal,
      }),
    ).resolves.toMatchObject({ environmentId, identity });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe("https://computer.example/api/loom/identity/session");
    expect(String(url)).not.toContain("provider-access");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      signal: abort.signal,
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "native",
      accessToken: "provider-access",
      environmentId,
      expectedIdentity: identity,
    });
    for (const changed of [
      { ...session, environmentId: "other" },
      { ...session, identity: { ...identity, subject: "other-owner" } },
      { ...session, identity: { ...identity, issuer: "https://other-id.test" } },
    ]) {
      request.mockResolvedValueOnce(response(changed));
      await expect(
        exchangeLibraryIdentityToken("https://computer.example", "provider-access", request, {
          metadata: modern,
          expectedIdentity: identity,
        }),
      ).rejects.toThrow("another computer or Identity account");
    }
    request.mockResolvedValueOnce(response({ ...session, expires_in: 3601 }));
    await expect(
      exchangeLibraryIdentityToken("https://computer.example", "provider-access", request, {
        metadata: modern,
      }),
    ).rejects.toThrow("unsupported or expired");
  });
  it("passes cancellation to metadata and token requests", async () => {
    const abort = new AbortController();
    abort.abort();
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      if (init?.signal?.aborted) throw new Error("cancelled");
      return response(modern);
    });
    await expect(
      loadLibraryIdentity("https://computer.example", environmentId, request, {
        signal: abort.signal,
      }),
    ).rejects.toThrow("cancelled");
    await expect(
      exchangeLibraryIdentityToken("https://computer.example", "access", request, {
        metadata: modern,
        signal: abort.signal,
      }),
    ).rejects.toThrow("cancelled");
  });
});

describe("renewable native sign-in", () => {
  const modern = {
    ...metadata,
    sessionExchangeEnabled: true,
    resource: "https://computer.test",
    maxSessionAgeSeconds: 7 * 86_400,
  };
  const identity = { issuer: metadata.issuer!, subject: "owner" };
  const NOW = 1_800_000_000_000;
  const discovery = {
    authorizationEndpoint: metadata.authorizationEndpoint!,
    tokenEndpoint: metadata.tokenEndpoint!,
    endSessionEndpoint: "https://identity.example/end-session",
  };
  const tokens = {
    tokenType: "bearer",
    accessToken: "provider-access",
    idToken: "provider-id",
    refreshToken: "provider-refresh",
    issuedAt: NOW / 1000,
    expiresIn: 600,
  };
  const computer = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("/api/loom/identity/session")
      ? response({
          access_token: "computer-session",
          issued_token_type: AuthAccessTokenType,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "orchestration:read",
          environmentId,
          identity,
        })
      : response(modern),
  );
  const { maxSessionAgeSeconds: _limit, ...unlimited } = modern;
  const signIn = (
    overrides: Partial<typeof tokens> = {},
    computerMetadata: LoomIdentityMetadata = modern,
    options: IdentityOptions = { requireSessionExchange: true },
  ) =>
    completeNativeIdentitySignIn({
      destination: libraryIdentityAddress("https://computer.example"),
      metadata: {
        ...computerMetadata,
        nativeClientId: "native-client",
        issuer: identity.issuer,
        authorizationEndpoint: discovery.authorizationEndpoint,
        tokenEndpoint: discovery.tokenEndpoint,
      },
      discovery,
      tokens: { ...tokens, ...overrides },
      label: "computer.example",
      options,
      request: computer,
      now: () => NOW,
    });

  it("asks for a refresh grant and a fresh sign-in only where the computer caps sign-in age", () => {
    expect(nativeIdentityScopes(modern)).toEqual(["openid", "profile", "offline_access"]);
    expect(nativeIdentityAuthorizationParameters(modern)).toEqual({
      resource: "https://computer.test",
      max_age: String(7 * 86_400 - 3600),
    });
    expect(
      nativeIdentityScopes({ ...unlimited, scopes: ["openid", "profile", "offline_access"] }),
    ).toEqual(["openid", "profile"]);
    expect(nativeIdentityAuthorizationParameters(unlimited)).toEqual({
      resource: "https://computer.test",
    });
  });

  it("keeps a secure end-session endpoint from discovery and drops an insecure one", async () => {
    const reply = {
      issuer: metadata.issuer,
      authorization_endpoint: metadata.authorizationEndpoint,
      token_endpoint: metadata.tokenEndpoint,
    };
    const request = vi.fn<typeof fetch>(async () =>
      response({ ...reply, end_session_endpoint: "https://identity.example/end-session" }),
    );
    await expect(loadNativeIdentityDiscovery(modern, request)).resolves.toMatchObject({
      endSessionEndpoint: "https://identity.example/end-session",
    });
    request.mockResolvedValueOnce(
      response({ ...reply, end_session_endpoint: "http://identity.example/end-session" }),
    );
    expect(await loadNativeIdentityDiscovery(modern, request)).not.toHaveProperty(
      "endSessionEndpoint",
    );
  });

  it("sends the ID token to the computer and keeps the refresh grant on the device", async () => {
    computer.mockClear();
    const signedIn = await signIn();
    const exchange = computer.mock.calls.find(([url]) =>
      String(url).endsWith("/api/loom/identity/session"),
    );
    expect(JSON.parse(String(exchange?.[1]?.body))).toMatchObject({
      type: "native",
      accessToken: "provider-access",
      idToken: "provider-id",
    });
    for (const [, init] of computer.mock.calls)
      expect(String(init?.body ?? "")).not.toContain("provider-refresh");
    expect(signedIn.grant).toEqual({
      version: 1,
      ...identity,
      environmentId,
      httpBaseUrl: "https://computer.example",
      clientId: "native-client",
      tokenEndpoint: discovery.tokenEndpoint,
      endSessionEndpoint: discovery.endSessionEndpoint,
      resource: "https://computer.test",
      refreshToken: "provider-refresh",
      idToken: "provider-id",
      grantedAt: NOW,
      updatedAt: NOW,
    });
    expect(signedIn.grantKey).toBe(identityGrantKey(signedIn.grant!));
    expect(signedIn.registration.credential).toMatchObject({
      token: "computer-session",
      identity: { ...identity, environmentId, expiresAt: NOW + 600_000 },
    });
  });

  it("keeps no refresh grant where the computer sets no sign-in limit", async () => {
    const signedIn = await signIn({}, unlimited);
    expect(signedIn.grant).toBeNull();
    expect(signedIn.registration.credential).toMatchObject({ token: "computer-session" });
  });

  it("explains a sign-in the computer refuses for its age", async () => {
    const refusing = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: "sign_in_expired" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      exchangeLibraryIdentityToken("https://computer.example", "access", refusing, {
        metadata: modern,
      }),
    ).rejects.toThrow("This computer needs a fresh Loom sign-in.");
  });

  it("explains a sign-in the computer refuses because it needs a passkey", async () => {
    const refusing = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ error: "passkey_required" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      exchangeLibraryIdentityToken("https://computer.example", "access", refusing, {
        metadata: modern,
      }),
    ).rejects.toThrow(IDENTITY_PASSKEY_REQUIRED_TEXT);
  });

  it("never sends the account token to a computer naming another resource than the pin", async () => {
    computer.mockClear();
    await expect(
      signIn({}, modern, {
        requireSessionExchange: true,
        expectedResource: "https://library.example/computers/other",
      }),
    ).rejects.toThrow(IDENTITY_RESOURCE_MISMATCH_TEXT);
    expect(
      computer.mock.calls.some(([url]) => String(url).endsWith("/api/loom/identity/session")),
    ).toBe(false);
    await expect(
      signIn({}, modern, { requireSessionExchange: true, expectedResource: modern.resource }),
    ).resolves.toMatchObject({ registration: { profile: { environmentId } } });
  });

  it("saves the resource a connection signed in with, so later sign-ins refuse another", async () => {
    expect((await signIn()).registration.profile.identityResource).toBe(modern.resource);
  });

  it("still signs in when the provider issues no refresh grant", async () => {
    const signedIn = await signIn({ refreshToken: undefined });
    expect(signedIn.grant).toBeNull();
    expect(signedIn.grantKey).toBe(identityGrantKey({ ...identity, environmentId }));
    expect(signedIn.registration.profile).toMatchObject({ identity, environmentId });
  });
});
